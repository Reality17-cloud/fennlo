import assert from 'node:assert/strict';
import test from 'node:test';
import { experienceSpecSchema, type Artifact, type GenerationContext } from '../src/shared/spec.js';
import { createProvider, MockGenerativeProvider, OpenAIGenerativeProvider, ProviderError } from '../server/providers/index.js';
import { createCapabilityRegistry } from '../server/capabilities/index.js';

const context = (intent: string): GenerationContext => ({ intent, capabilities: [], artifacts: [] });
const testKey = `sk-${'x'.repeat(32)}`;
const response = (spec: unknown, status = 'completed'): Response => new Response(JSON.stringify({ status, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(spec) }] }] }), { status: 200 });

test('deterministic references are valid, different compositions, and freshly isolated', async () => {
  const provider = new MockGenerativeProvider();
  const intents = ['Explain why seasons happen.', 'Explain acceleration visually.', 'Explain a short poem in the most natural way.'];
  const specs = await Promise.all(intents.map(intent => provider.generate(context(intent))));
  assert.deepEqual(specs.map(spec => spec.composition), ['orbital', 'kinetic', 'lyrical']);
  for (let i = 0; i < intents.length; i++) {
    assert.equal(experienceSpecSchema.safeParse(specs[i]).success, true);
    assert.deepEqual(specs[i], await provider.generate(context(intents[i])));
    assert.ok(specs[i].summary.length > 200);
  }
  assert.match(specs[0].summary, /axis stays pointed in nearly the same direction/);
  assert.match(specs[0].summary, /distance is not the cause/);
  assert.match(specs[2].summary, /original poem/);
  specs[0].nodes[0].payload.palette = 'dusk';
  assert.equal((await provider.generate(context(intents[0]))).nodes[0].payload.palette, 'cosmos');
});

test('unknown intents transparently describe authored local limitations', async () => {
  const result = await new MockGenerativeProvider().generate(context('Plan a meal for tomorrow'));
  assert.equal(result.composition, 'editorial');
  assert.match(result.summary, /live AI provider is not connected/i);
  assert.match(result.summary, /Plan a meal for tomorrow/);
});

test('arbitrary renderer names, injected payload code, URLs, and duplicate IDs are rejected', async () => {
  const original = await new MockGenerativeProvider().generate(context('seasons'));
  for (const unsafeNode of [
    { id: 'unsafe', renderer: 'html', payload: { html: '<script>alert(1)</script>' } },
    { id: 'unsafe', renderer: 'constructor', payload: {} },
    { id: 'unsafe', renderer: 'toString', payload: {} },
    { id: 'unsafe', renderer: 'text', payload: { text: 'hello', role: 'body', code: 'alert(1)' } },
    { id: 'unsafe', renderer: 'image', payload: { artifactId: 'https://evil.example/image.png', alt: 'Unsafe' } },
    { id: 'unsafe', renderer: 'image', payload: { artifactId: 'safe', alt: 'Unsafe', src: 'javascript:alert(1)' } },
    { ...original.nodes[0] },
  ]) {
    assert.equal(experienceSpecSchema.safeParse({ ...original, nodes: [...original.nodes, unsafeNode] }).success, false);
  }
});

test('provider selection is server-controlled and credentials are never required for mock', () => {
  assert.equal(createProvider({}).name, 'development');
  assert.equal(createProvider({ OPENAI_API_KEY: 'sk-your-key-here' }).name, 'development');
  assert.equal(createProvider({ OPENAI_API_KEY: testKey, FENNLO_PROVIDER: 'mock' }).name, 'mock');
  assert.equal(createProvider({ OPENAI_API_KEY: testKey }).name, 'development');
  assert.equal(createProvider({ OPENAI_API_KEY: testKey, FENNLO_PROVIDER: 'openai-legacy' }).name, 'openai');
  assert.equal(createProvider({ GEMINI_API_KEY: 'test-key-for-selection-only' }).name, 'gemini');
});

test('real adapter uses bounded Responses structured output and sends only allowed context', async () => {
  const spec = await new MockGenerativeProvider().generate(context('seasons'));
  let requestBody: Record<string, unknown> | undefined;
  const fakeFetch: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.ok(init?.signal);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(requestBody.store, false);
    assert.equal(JSON.stringify(requestBody).includes('private-storage-secret'), false);
    return response(spec);
  };
  const artifact: Artifact = { id: 'example', ownerId: 'owner', contentType: 'image/png', storageKey: 'private-storage-secret', byteLength: 10, metadata: {}, provenance: {}, createdAt: new Date().toISOString() };
  assert.deepEqual(await new OpenAIGenerativeProvider(testKey, 'gpt-4o-mini', fakeFetch).generate({ ...context('seasons'), artifacts: [artifact] }), spec);
  assert.equal((requestBody?.text as { format: { strict: boolean } }).format.strict, true);
});

test('real adapter rejects failures, incomplete output, unsupported renderers and invented artifacts', async () => {
  const spec = await new MockGenerativeProvider().generate(context('seasons'));
  const badResults = [
    new Response('secret upstream detail', { status: 401 }),
    response(spec, 'incomplete'),
    response({ ...spec, nodes: [{ id: 'bad', renderer: 'javascript', payload: {} }] }),
    response({ ...spec, nodes: [{ id: 'bad', renderer: 'image', payload: { artifactId: 'invented', alt: 'none', fit: 'cover' } }] }),
  ];
  for (const bad of badResults) {
    const provider = new OpenAIGenerativeProvider(testKey, 'gpt-4o-mini', async () => bad);
    await assert.rejects(provider.generate(context('hello')), error => error instanceof ProviderError && !error.message.includes('secret'));
  }
});

test('capabilities execute typed operations, validate payloads, and expose unavailable generation', async () => {
  let reads = 0;
  let stores = 0;
  let emitted = 0;
  const artifact: Artifact = { id: 'sample', ownerId: 'owner', contentType: 'text/plain', storageKey: 'sample', byteLength: 2, metadata: {}, provenance: {}, createdAt: '2026-01-01T00:00:00Z' };
  const registry = createCapabilityRegistry({ provider: new MockGenerativeProvider(), artifactRead: () => { reads++; return artifact; }, artifactStore: () => { stores++; return artifact; }, artifactQuery: () => [artifact], experienceEmit: () => { emitted++; return { id: 'exp', visitorSessionId: 'visitor', intent: 'sample', status: 'pending', provider: 'mock', spec: null, error: null, createdAt: '', updatedAt: '' }; } });
  assert.equal((await registry.execute('artifact.read', { id: 'sample' }))?.id, 'sample');
  assert.equal(reads, 1);
  assert.equal((await registry.execute('artifact.store', { contentType: 'text/plain', dataBase64: 'SGk=' })).id, 'sample');
  assert.equal(stores, 1);
  assert.equal((await registry.execute('artifact.query', {})).length, 1);
  const text = await registry.execute('representation.text', { payload: { text: 'hello', role: 'body' } });
  assert.equal(text.renderer, 'text');
  await registry.execute('experience.emit', { experienceId: 'exp', node: text });
  assert.equal(emitted, 1);
  const generated = await registry.execute('generation.language', { intent: 'acceleration' });
  assert.equal(generated.composition, 'kinetic');
  assert.equal(registry.list().find(entry => entry.name === 'generation.video')?.available, false);
  assert.equal(registry.list().find(entry => entry.name === 'generation.video')?.requiresProvider, true);
  await assert.rejects(registry.execute('generation.video', { prompt: 'film' }), /not connected/);
  await assert.rejects(registry.execute('unknown.capability', {}), /not registered/);
  await assert.rejects(registry.execute('artifact.read', { id: '../secret' }), /Invalid input/);
  await assert.rejects(registry.execute('representation.image', { payload: { artifactId: 'javascript:alert(1)', alt: 'x' } }), /Invalid input/);
  await assert.rejects(registry.execute('experience.emit', { experienceId: 'exp', node: { id: 'x', renderer: 'html', payload: {}, slot: 'hero', startMs: 0 } }), /Invalid input/);
  await assert.rejects(registry.execute('experience.emit', { experienceId: 'exp', node: { id: 'x', renderer: 'constructor', payload: {}, slot: 'hero', startMs: 0 } }), /Invalid input/);
  assert.equal(emitted, 1);
});
