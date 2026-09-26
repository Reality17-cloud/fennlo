import express, { type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import { createIntentSchema, idSchema, type GenerativeProvider } from '../../src/shared/spec.js';
import type { Application } from '../application/index.js';
import { ApplicationError } from '../domain/ports.js';

const artifactUploadSchema = z.object({
  contentType: z.string().max(200), content: z.string().max(35_000_000),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
  metadata: z.record(z.unknown()).optional(), provenance: z.record(z.unknown()).optional(),
}).strict();

export interface HttpOptions { ownerToken?: string; production?: boolean; referenceProvider?: GenerativeProvider }

/** Only transport, request policy and serialization live here. */
export function createHttpApp(application: Application, options: HttpOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', options.production ? 1 : false);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (options.production) res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    if (!options.production && !['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) return res.status(403).json({ error: 'This application is available locally.' });
    next();
  });

  app.use('/api', rateLimit(240, 60_000));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `${req.protocol}://${req.get('host')}`)) {
      return res.status(403).json({ error: 'This request must come from Fennlo.' });
    }
    next();
  });

  const identify = (req: Request, res: Response, next: NextFunction) => {
    const candidate = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('fennlo_session='))?.slice('fennlo_session='.length);
    const session = application.session.identify(candidate);
    res.locals.visitorSessionId = session.id;
    if (candidate !== session.id) res.cookie('fennlo_session', session.id, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 30 * 24 * 60 * 60 * 1000, secure: req.secure });
    next();
  };

  const hasOwnerAccess = (req: Request): boolean => {
    const token = options.ownerToken;
    if (!token) return false;
    const supplied = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    const actual = Buffer.from(supplied);
    const expected = Buffer.from(token);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  const requireOwner = (req: Request, res: Response, next: NextFunction) => {
    if (!hasOwnerAccess(req)) return res.status(403).json({ error: 'Owner access is required.' });
    next();
  };

  app.get('/api/status', (_req, res) => res.json({ provider: application.provider.name, capabilities: application.capabilities() }));
  app.get('/api/owner', (_req, res) => res.json({ owner: application.owner.get() }));

  app.post('/api/experiences', rateLimit(30, 60_000), express.json({ limit: '16kb' }), identify, async (req, res) => {
    const { intent, reference } = createIntentSchema.parse(req.body);
    const experience = await application.experience.generate(res.locals.visitorSessionId as string, intent, reference ? options.referenceProvider : undefined);
    res.status(experience.status === 'failed' ? 502 : 201).json({ experience });
  });
  app.get('/api/experiences/:id', identify, (req, res) => {
    const id = idSchema.parse(req.params.id);
    res.json({ experience: application.experience.get(id, res.locals.visitorSessionId as string) });
  });

  app.get('/api/artifacts', (req, res) => {
    const query = z.object({ contentType: z.string().max(200).optional() }).strict().parse(req.query);
    const artifacts = application.artifact.query({ publicOnly: !hasOwnerAccess(req), contentType: query.contentType });
    res.json({ artifacts: artifacts.map(({ storageKey: _storage, ...resource }) => resource) });
  });
  app.post('/api/artifacts', requireOwner, express.json({ limit: '35mb' }), async (req, res) => {
    const input = artifactUploadSchema.parse(req.body);
    if (input.encoding === 'base64' && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content)) {
      throw new ApplicationError('INVALID_INPUT', 'Artifact content is not valid base64.');
    }
    const artifact = await application.artifact.store({
      contentType: input.contentType, data: Buffer.from(input.content, input.encoding),
      metadata: input.metadata, provenance: input.provenance,
    });
    const { storageKey: _storage, ...resource } = artifact;
    res.status(201).json({ artifact: resource });
  });
  app.delete('/api/artifacts/:id', requireOwner, async (req, res) => {
    await application.artifact.delete(idSchema.parse(req.params.id));
    res.status(204).end();
  });
  app.get('/api/artifacts/:id', identify, async (req, res) => {
    const id = idSchema.parse(req.params.id);
    if (!hasOwnerAccess(req) && !application.artifact.canRead(id, res.locals.visitorSessionId as string)) throw new ApplicationError('NOT_FOUND', 'Artifact not found.');
    const { artifact, data } = await application.artifact.read(id);
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    res.setHeader('Content-Type', artifact.contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', artifact.metadata.public === true ? 'public, max-age=3600, immutable' : 'private, no-cache');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', `${/^(image|audio|video)\//.test(artifact.contentType) ? 'inline' : 'attachment'}; filename="${artifact.id}"`);
    const etag = `"${artifact.id}-${bytes.byteLength}"`;
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      let start = 0;
      let end = bytes.byteLength - 1;
      let valid = !!match && !!(match[1] || match[2]);
      if (match && valid) {
        if (!match[1]) start = Math.max(0, bytes.byteLength - Number(match[2]));
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
        valid = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start && start < bytes.byteLength;
      }
      if (!valid) { res.setHeader('Content-Range', `bytes */${bytes.byteLength}`); return res.status(416).end(); }
      res.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.byteLength}`);
      res.setHeader('Content-Length', end - start + 1);
      return res.status(206).end(bytes.subarray(start, end + 1));
    }
    res.setHeader('Content-Length', bytes.byteLength);
    res.end(bytes);
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) return res.status(400).json({ error: 'Please check the request and try again.' });
    if (error instanceof ApplicationError) {
      const status = { INVALID_INPUT: 400, NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, GENERATION_FAILED: 502 }[error.code];
      return res.status(status).json({ error: error.message });
    }
    const transportError = error as { type?: string; status?: number };
    if (transportError.type === 'entity.too.large') return res.status(413).json({ error: 'This request is too large.' });
    if (transportError.status === 400) return res.status(400).json({ error: 'The request could not be read.' });
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}

function rateLimit(maximum: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetsAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? 'local';
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetsAt <= now) {
      bucket = { count: 0, resetsAt: now + windowMs };
      buckets.set(key, bucket);
      if (buckets.size > 1000) for (const [id, item] of buckets) if (item.resetsAt <= now) buckets.delete(id);
    }
    if (++bucket.count > maximum) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetsAt - now) / 1000));
      return res.status(429).json({ error: 'Please pause a moment before trying again.' });
    }
    next();
  };
}
