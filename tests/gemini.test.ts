import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GeminiGenerativeProvider, GeminiGenerationError, parseGeminiResponse } from '../server/providers/gemini.js';
import { DevelopmentGenerativeProvider } from '../server/providers/development.js';
import { createApplication } from '../server/application/index.js';
import { createHttpApp } from '../server/http/app.js';
import type { AddressInfo } from 'node:net';
import type { ArtifactStorage } from '../server/domain/ports.js';
import type { GeneratedExplanation, GenerationContext } from '../src/shared/spec.js';

const questions = ['Why do seasons happen?', 'How does a CPU execute an instruction?', 'How does DNA replication work?'];
const context = (intent: string): GenerationContext => ({ intent, artifacts: [], capabilities: [] });
const png = await readFile(resolve('server/fixtures/atmosphere.png'));
const imagePart = () => ({ inlineData: { mimeType: 'image/png', data: png.toString('base64') } });
function transportFixture(answer: GeneratedExplanation) {
  return { candidates: [{ finishReason: 'STOP', content: { parts: [
    { text: `<overview>${JSON.stringify({ title: answer.title, summary: answer.summary })}</overview>` },
    ...answer.points.flatMap(point => [{ text: `<point>${JSON.stringify({ title: point.title, text: point.text, alt: point.alt })}</point>` }, imagePart()]),
  ] } }], modelVersion: 'gemini-3.1-flash-lite-image' };
}

test('one native Gemini request pairs text and inline images for unrelated questions (mocked transport)', async () => {
  for (const question of questions) {
    const development = await new DevelopmentGenerativeProvider().generate(context(question));
    let calls = 0;
    const request: typeof fetch = async (url, init) => {
      calls++;
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-lite-image:generateContent');
      assert.ok(init?.signal);
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
      assert.deepEqual(body.generationConfig.imageConfig, { imageSize: '1K', aspectRatio: '16:9' });
      assert.equal(body.generationConfig.candidateCount, 1);
      assert.equal(body.generationConfig.maxOutputTokens, 4096);
      assert.equal(body.tools, undefined);
      assert.equal(body.generationConfig.responseSchema, undefined);
      assert.equal(body.contents[0].parts[0].text, question);
      assert.equal(String(init?.body).includes('fixture-secret'), false);
      return Response.json(transportFixture(development));
    };
    const result = await new GeminiGenerativeProvider('fixture-secret', {}, request).generate(context(question));
    assert.equal(calls, 1);
    assert.equal(result.kind, 'visual-explanation');
    assert.equal(result.development, false);
    assert.deepEqual(result.points.map(p => [p.title, p.text, p.alt]), development.points.map(p => [p.title, p.text, p.alt]));
    for (const point of result.points) {
      assert.deepEqual(Buffer.from(point.image.bytes), png);
      assert.equal(point.image.provenance.generated, true);
      assert.equal(point.image.contentType, 'image/png');
    }
  }
});

test('native parser rejects missing, extra, unsafe and unpaired images without guessing', async () => {
  const fixture = transportFixture(await new DevelopmentGenerativeProvider().generate(context(questions[0])));
  const variants: unknown[] = [];
  const mutate = (fn: (copy: typeof fixture) => void) => { const copy = structuredClone(fixture); fn(copy); variants.push(copy); };
  mutate(copy => { copy.candidates[0].finishReason = 'MAX_TOKENS'; });
  mutate(copy => { copy.candidates[0].content.parts.pop(); });
  mutate(copy => { copy.candidates[0].content.parts.splice(0, 1); });
  mutate(copy => { copy.candidates[0].content.parts.push(imagePart()); });
  mutate(copy => { copy.candidates[0].content.parts[2] = { inlineData: { mimeType: 'image/svg+xml', data: Buffer.from('<script>evil()</script>').toString('base64') } }; });
  mutate(copy => { copy.candidates[0].content.parts[2] = { inlineData: { mimeType: 'image/png', data: 'not valid bytes' } }; });
  mutate(copy => { copy.candidates[0].content.parts[1] = { text: '<point>{"title":"missing content"}</point>' }; });
  for (const value of variants) assert.throws(() => parseGeminiResponse(value));
  const thoughts = structuredClone(fixture);
  thoughts.candidates[0].content.parts.unshift({ thought: true, text: 'private reasoning discarded' } as never);
  assert.equal(parseGeminiResponse(thoughts).points.length, 3);
});

test('Gemini errors are safe and never trigger extra paid retries; configuration bounds cost', async () => {
  let calls = 0;
  const provider = new GeminiGenerativeProvider('fixture-secret', {}, async () => { calls++; return new Response('fixture-secret upstream details', { status: 429 }); });
  await assert.rejects(provider.generate(context('a question')), error => error instanceof GeminiGenerationError && !error.message.includes('fixture-secret'));
  assert.equal(calls, 1);
  assert.throws(() => new GeminiGenerativeProvider('x', { maxPoints: 10 }));
  assert.throws(() => new GeminiGenerativeProvider('x', { imageSize: '4K' }));
  const alternate = new GeminiGenerativeProvider('x', { model: 'gemini-3.1-flash-image', imageSize: '2K', maxPoints: 2 });
  assert.equal(alternate.options.imageSize, '2K');
});

test('development fallback is deterministic and never claims its placeholders are AI generated', async () => {
  const provider = new DevelopmentGenerativeProvider();
  for (const question of questions) {
    const answer = await provider.generate(context(question));
    assert.deepEqual(answer, await provider.generate(context(question)));
    assert.equal(answer.development, true);
    assert.ok(answer.points.every(point => point.image.provenance.generated === false));
    assert.ok(answer.points.every(point => Buffer.from(point.image.bytes).toString().includes('NOT AI GENERATED')));
  }
  const seasons = await provider.generate(context(questions[0]));
  assert.match(seasons.points.map(p => p.text).join(' '), /distance.*not.*causes/);
  const cpu = await provider.generate(context(questions[1]));
  assert.match(cpu.points.map(p => p.text).join(' '), /program counter/i);
  assert.match(cpu.points.map(p => p.text).join(' '), /ALU/);
  const dna = await provider.generate(context(questions[2]));
  assert.match(dna.points.map(p => p.text).join(' '), /5′ to 3′/);
  assert.match(dna.points.map(p => p.text).join(' '), /Okazaki/);
});

test('native image bytes use ArtifactService, remain private, and survive a database restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fennlo-native-'));
  const draft = await new DevelopmentGenerativeProvider().generate(context(questions[1]));
  const provider = new GeminiGenerativeProvider('fixture-key', {}, async () => Response.json(transportFixture(draft)));
  const options = { databasePath: join(directory, 'fennlo.sqlite'), storageDirectory: join(directory, 'artifacts'), provider };
  let app = createApplication(options);
  t.after(async () => { app.close(); await rm(directory, { recursive: true, force: true }); });
  const visitor = app.session.identify();
  const stranger = app.session.identify();
  const experience = await app.experience.generate(visitor.id, questions[1]);
  assert.equal(experience.status, 'complete');
  assert.equal(experience.spec?.composition, 'explanation');
  assert.equal(experience.spec?.nodes.length, 3);
  const ids = experience.spec!.nodes.map(node => String(node.payload.artifactId));
  assert.equal(new Set(ids).size, 3);
  assert.equal(JSON.stringify(experience).includes(png.toString('base64')), false);
  for (const id of ids) {
    const { artifact, data } = await app.artifact.read(id);
    assert.deepEqual(Buffer.from(data), png);
    assert.equal(artifact.provenance.provider, 'gemini');
    assert.equal(artifact.provenance.generated, true);
    assert.equal(app.artifact.canRead(id, visitor.id), true);
    assert.equal(app.artifact.canRead(id, stranger.id), false);
  }
  app.close(); app = createApplication(options);
  assert.deepEqual(app.experience.get(experience.id, visitor.id), experience);
  assert.deepEqual(Buffer.from((await app.artifact.read(ids[0])).data), png);
  const server = createHttpApp(app).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/api/artifacts/${ids[0]}`)).status, 404);
    assert.equal((await fetch(`${base}/api/artifacts/${ids[0]}`, { headers: { Cookie: `fennlo_session=${visitor.id}` } })).status, 200);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('partial artifact storage failures roll back image files and mark the experience failed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fennlo-rollback-'));
  const bytes = new Map<string, Uint8Array>();
  let writes = 0;
  const storage: ArtifactStorage = { async put(key, value) { if (++writes === 2) throw new Error('disk full'); bytes.set(key, value); }, async read(key) { return bytes.get(key)!; }, async delete(key) { bytes.delete(key); } };
  const app = createApplication({ databasePath: join(directory, 'fennlo.sqlite'), storageDirectory: join(directory, 'artifacts'), provider: new DevelopmentGenerativeProvider(), storage });
  t.after(async () => { app.close(); await rm(directory, { recursive: true, force: true }); });
  const experience = await app.experience.generate(app.session.identify().id, questions[0]);
  assert.equal(experience.status, 'failed');
  assert.equal(app.artifact.query().length, 0);
  assert.equal(bytes.size, 0);
  assert.doesNotMatch(experience.error!, /disk full/);
});
