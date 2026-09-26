import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createIntentSchema, experienceSpecSchema, idSchema, nodeSchema, rendererPayloadSchemas,
  type Artifact, type CapabilityDescriptor, type Experience, type ExperienceNode, type ExperienceSpec,
  type GenerativeProvider, type RendererName,
} from '../../src/shared/spec.js';
import { ApplicationError, type ArtifactStorage, type Repository } from '../domain/ports.js';
import { FilesystemStorage } from '../infrastructure/filesystem-storage.js';
import { SqliteRepository } from '../infrastructure/sqlite-repository.js';
import { validateGeneratedExplanation } from '../domain/generated-explanation.js';

const contentTypeSchema = z.string().min(3).max(200).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+(?:;\s*charset=[a-zA-Z0-9-]+)?$/);
const artifactInputSchema = z.object({
  id: idSchema.optional(), contentType: contentTypeSchema,
  metadata: z.record(z.unknown()).default({}), provenance: z.record(z.unknown()).default({}),
}).strict();
export type ArtifactInput = z.input<typeof artifactInputSchema>;
export type ArtifactStoreInput = ArtifactInput & { data: Uint8Array };

export interface ApplicationOptions {
  databasePath: string;
  storageDirectory: string;
  provider: GenerativeProvider;
  capabilities?: () => CapabilityDescriptor[];
  repository?: Repository;
  storage?: ArtifactStorage;
}

/** Pure operation boundaries: HTTP, capability tools and tests all use this core. */
export function createApplication(options: ApplicationOptions) {
  const repository = options.repository ?? new SqliteRepository(options.databasePath);
  const storage = options.storage ?? new FilesystemStorage(options.storageDirectory);
  const provider = options.provider;

  const session = {
    identify(candidate?: string) {
      if (candidate && idSchema.safeParse(candidate).success) {
        const existing = repository.sessions.get(candidate);
        if (existing) return existing;
      }
      const created = { id: randomUUID(), createdAt: new Date().toISOString() };
      repository.sessions.create(created);
      return created;
    },
  };

  const artifact = {
    /** Allocate a valid empty digital resource; store creates a resource with binary content. */
    async create(input: ArtifactInput): Promise<Artifact> { return artifact.store({ ...input, data: new Uint8Array() }); },
    async store(input: ArtifactStoreInput): Promise<Artifact> {
      const { data, ...identity } = input;
      const parsed = artifactInputSchema.parse(identity);
      if (!(data instanceof Uint8Array) || data.byteLength > 25 * 1024 * 1024) throw new ApplicationError('INVALID_INPUT', 'Artifact content must be at most 25 MB.');
      for (const value of [parsed.metadata, parsed.provenance]) {
        try { if (JSON.stringify(value).length > 16_384) throw new Error('too large'); }
        catch { throw new ApplicationError('INVALID_INPUT', 'Artifact metadata must be valid JSON under 16 KB.'); }
      }
      const id = parsed.id ?? randomUUID();
      if (repository.artifacts.get(id)) throw new ApplicationError('CONFLICT', 'An artifact with that ID already exists.');
      const resource: Artifact = {
        id, ownerId: repository.owner.get().id, storageKey: randomUUID(), contentType: parsed.contentType,
        byteLength: data.byteLength, metadata: parsed.metadata, provenance: parsed.provenance, createdAt: new Date().toISOString(),
      };
      await storage.put(resource.storageKey, data);
      try { repository.artifacts.create(resource); }
      catch (error) { await storage.delete(resource.storageKey); throw error; }
      return resource;
    },
    get(id: string): Artifact {
      idSchema.parse(id);
      const resource = repository.artifacts.get(id);
      if (!resource) throw new ApplicationError('NOT_FOUND', 'Artifact not found.');
      return resource;
    },
    query(filter: { publicOnly?: boolean; contentType?: string } = {}): Artifact[] {
      if (filter.contentType) contentTypeSchema.parse(filter.contentType);
      return repository.artifacts.query(filter);
    },
    canRead(id: string, visitorSessionId: string): boolean {
      const resource = repository.artifacts.get(id);
      return !!resource && (resource.metadata.public === true || resource.metadata.visitorSessionId === visitorSessionId || repository.artifacts.isReferenced(id, visitorSessionId));
    },
    async read(id: string): Promise<{ artifact: Artifact; data: Uint8Array }> {
      const resource = artifact.get(id);
      try { return { artifact: resource, data: await storage.read(resource.storageKey) }; }
      catch { throw new ApplicationError('NOT_FOUND', 'Artifact content is unavailable.'); }
    },
    async delete(id: string): Promise<void> {
      const resource = artifact.get(id);
      if (repository.artifacts.isReferenced(id)) throw new ApplicationError('CONFLICT', 'This artifact belongs to a saved experience.');
      await storage.delete(resource.storageKey);
      repository.artifacts.delete(id);
    },
  };

  function requirePending(id: string): Experience {
    const result = experience.get(id);
    if (result.status !== 'pending') throw new ApplicationError('CONFLICT', 'This experience is already finished.');
    return result;
  }

  function validateNode(value: unknown): ExperienceNode {
    const node = nodeSchema.parse(value);
    const payloadSchema = Object.hasOwn(rendererPayloadSchemas, node.renderer) ? rendererPayloadSchemas[node.renderer as RendererName] : undefined;
    if (!payloadSchema) throw new ApplicationError('INVALID_INPUT', 'Unsupported renderer.');
    payloadSchema.parse(node.payload);
    return node;
  }

  function validateArtifactReferences(spec: ExperienceSpec, visitorSessionId: string): void {
    for (const node of spec.nodes) {
      for (const key of ['artifactId', 'posterArtifactId']) {
        const id = node.payload[key];
        if (typeof id !== 'string') continue;
        if (!artifact.canRead(id, visitorSessionId)) throw new ApplicationError('INVALID_INPUT', 'An experience referenced an unavailable artifact.');
        const resource = artifact.get(id);
        const family = key === 'posterArtifactId' || node.renderer === 'explanation-point' ? 'image' : node.renderer;
        if (['image', 'audio', 'video'].includes(family) && !resource.contentType.startsWith(`${family}/`)) {
          throw new ApplicationError('INVALID_INPUT', 'An artifact does not match its renderer.');
        }
      }
    }
  }

  const experience = {
    create(visitorSessionId: string, intent: string, providerName = provider.name): Experience {
      const parsed = createIntentSchema.parse({ intent });
      if (!repository.sessions.get(visitorSessionId)) throw new ApplicationError('FORBIDDEN', 'A visitor session is required.');
      const now = new Date().toISOString();
      const result: Experience = {
        id: randomUUID(), visitorSessionId, intent: parsed.intent, status: 'pending', provider: providerName,
        spec: null, error: null, createdAt: now, updatedAt: now,
      };
      repository.experiences.create(result);
      return result;
    },
    get(id: string, visitorSessionId?: string): Experience {
      idSchema.parse(id);
      const result = repository.experiences.get(id);
      if (!result || (visitorSessionId && result.visitorSessionId !== visitorSessionId)) throw new ApplicationError('NOT_FOUND', 'Experience not found.');
      return result;
    },
    appendNode(id: string, value: ExperienceNode): Experience {
      const pending = requirePending(id);
      const node = validateNode(value);
      validateArtifactReferences({ version: 1, title: 'Pending', composition: 'editorial', palette: 'paper', summary: 'Pending', nodes: [node] }, pending.visitorSessionId);
      try { repository.experiences.appendNode(id, node); }
      catch { throw new ApplicationError('CONFLICT', 'This experience already contains that node.'); }
      return experience.get(id);
    },
    complete(id: string, value: ExperienceSpec): Experience {
      const pending = requirePending(id);
      const spec = experienceSpecSchema.parse(value);
      validateArtifactReferences(spec, pending.visitorSessionId);
      repository.experiences.complete(id, spec, new Date().toISOString());
      return experience.get(id);
    },
    fail(id: string, message = 'The experience could not be created. Please try again.'): Experience {
      requirePending(id);
      repository.experiences.fail(id, message.slice(0, 300), new Date().toISOString());
      return experience.get(id);
    },
    async generate(visitorSessionId: string, intent: string, selectedProvider: GenerativeProvider = provider): Promise<Experience> {
      const pending = experience.create(visitorSessionId, intent, selectedProvider.name);
      const storedIds: string[] = [];
      try {
        const generated = await selectedProvider.generate({
          intent: pending.intent, capabilities: options.capabilities?.() ?? [], artifacts: artifact.query({ publicOnly: true }),
        });
        if ('kind' in generated && generated.kind === 'visual-explanation') {
          const answer = validateGeneratedExplanation(generated);
          const nodes: ExperienceNode[] = [];
          for (const [index, point] of answer.points.entries()) {
            const resource = await artifact.store({ contentType: point.image.contentType, data: point.image.bytes,
              metadata: { visitorSessionId, experienceId: pending.id, pointIndex: index, title: point.title, alt: point.alt },
              provenance: { ...point.image.provenance, provider: selectedProvider.name },
            });
            storedIds.push(resource.id);
            nodes.push({ id: `point-${index + 1}`, renderer: 'explanation-point', slot: index === 0 ? 'hero' : 'aside', startMs: 0,
              payload: { title: point.title, text: point.text, alt: point.alt, artifactId: resource.id, development: answer.development },
            });
          }
          return experience.complete(pending.id, { version: 1, title: answer.title, summary: `${answer.summary}\n\n${answer.points.map(p => `${p.title}\n${p.text}`).join('\n\n')}`, composition: 'explanation', palette: 'cosmos', nodes });
        }
        return experience.complete(pending.id, experienceSpecSchema.parse(generated));
      } catch {
        for (const id of storedIds) { try { await artifact.delete(id); } catch { /* Keep safe failure semantics if cleanup also fails. */ } }
        // Provider messages can contain credentials or upstream payloads. Persist only a stable public error.
        return experience.fail(pending.id);
      }
    },
  };

  return {
    owner: repository.owner, session, artifact, experience, provider, repository,
    capabilities: () => options.capabilities?.() ?? [],
    close: () => repository.close(),
  };
}

export type Application = ReturnType<typeof createApplication>;
