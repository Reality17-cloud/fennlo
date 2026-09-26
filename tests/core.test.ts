import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApplication, type Application } from '../server/application/index.js';
import { createHttpApp } from '../server/http/app.js';
import { FilesystemStorage } from '../server/infrastructure/filesystem-storage.js';
import type { Experience, ExperienceSpec, GenerativeProvider } from '../src/shared/spec.js';

const spec: ExperienceSpec = {
  version: 1, title: 'A test experience', composition: 'editorial', palette: 'paper', summary: 'A readable test answer.',
  nodes: [{ id: 'text-1', renderer: 'text', slot: 'body', startMs: 0, payload: { text: 'A readable test answer.', role: 'body' } }],
};
const provider: GenerativeProvider = { name: 'test-provider', async generate() { return structuredClone(spec); } };

async function fixture(t: TestContext, selectedProvider = provider) {
  const directory = await mkdtemp(join(tmpdir(), 'fennlo-core-'));
  const options = { databasePath: join(directory, 'fennlo.sqlite'), storageDirectory: join(directory, 'artifacts'), provider: selectedProvider };
  let application: Application = createApplication(options);
  t.after(async () => {
    application.close();
    const absolute = resolve(directory);
    if (!absolute.startsWith(`${resolve(tmpdir())}${sep}fennlo-core-`)) throw new Error('Unsafe test cleanup path');
    await rm(absolute, { recursive: true, force: true });
  });
  return { get application() { return application; }, options, restart() { application.close(); application = createApplication(options); return application; } };
}

async function httpFixture(t: TestContext) {
  const fixtureState = await fixture(t);
  const app = createHttpApp(fixtureState.application, { ownerToken: 'a-test-owner-token' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { ...fixtureState, base };
}

test('SQLite owner, sessions, artifacts and ordered experience nodes survive a restart', async t => {
  const state = await fixture(t);
  const app = state.application;
  const owner = app.owner.get();
  const visitor = app.session.identify();
  const binary = Uint8Array.from([0, 12, 255, 4, 99]);
  const resource = await app.artifact.store({ contentType: 'application/x-future-representation', data: binary, metadata: { title: 'Generic binary' } });
  const pending = app.experience.create(visitor.id, 'Explain this idea');
  app.experience.appendNode(pending.id, spec.nodes[0]);
  app.experience.complete(pending.id, { ...spec, nodes: [...spec.nodes, { id: 'text-2', renderer: 'text', slot: 'aside', startMs: 10, payload: { text: 'Second', role: 'caption' } }] });
  const restarted = state.restart();
  assert.deepEqual(restarted.owner.get(), owner);
  assert.deepEqual(restarted.session.identify(visitor.id), visitor);
  assert.deepEqual(Array.from((await restarted.artifact.read(resource.id)).data), Array.from(binary));
  assert.equal(restarted.artifact.query({ contentType: 'application/x-future-representation' }).length, 1);
  const saved = restarted.experience.get(pending.id, visitor.id);
  assert.equal(saved.status, 'complete');
  assert.deepEqual(saved.spec?.nodes.map(node => node.id), ['text-1', 'text-2']);
  await restarted.artifact.delete(resource.id);
  assert.throws(() => restarted.artifact.get(resource.id), /not found/);
});

test('Application validates renderers, artifacts and state transitions before persistence', async t => {
  const { application: app, options } = await fixture(t);
  const visitor = app.session.identify();
  const pending = app.experience.create(visitor.id, 'Validate an experience');
  assert.throws(() => app.experience.appendNode(pending.id, { ...spec.nodes[0], renderer: 'constructor' }), /Unsupported renderer/);
  assert.throws(() => app.experience.complete(pending.id, { ...spec, nodes: [{ ...spec.nodes[0], renderer: 'javascript', payload: { code: 'alert(1)' } }] }));
  assert.throws(() => app.experience.complete(pending.id, { ...spec, nodes: [{ ...spec.nodes[0], renderer: 'image', payload: { artifactId: 'missing', alt: 'Unavailable' } }] }), /unavailable artifact/);
  assert.throws(() => app.experience.complete(pending.id, { ...spec, nodes: [spec.nodes[0], spec.nodes[0]] }));
  app.experience.complete(pending.id, spec);
  assert.throws(() => app.experience.fail(pending.id), /already finished/);
  const storage = new FilesystemStorage(options.storageDirectory);
  await assert.rejects(storage.put('../escape', Buffer.from('no')), /Invalid artifact storage key/);
  await assert.rejects(storage.read('..\\escape'), /Invalid artifact storage key/);
});

test('Provider output is validated and provider errors never become saved public errors', async t => {
  const invalid: GenerativeProvider = { name: 'invalid-provider', async generate() { throw new Error('SECRET_TOKEN=this-must-not-leak'); } };
  const { application: app } = await fixture(t, invalid);
  const visitor = app.session.identify();
  const failed = await app.experience.generate(visitor.id, 'Test failure');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.spec, null);
  assert.doesNotMatch(JSON.stringify(failed), /SECRET_TOKEN/);
  const unknown: GenerativeProvider = { name: 'unknown-renderer', async generate() { return { ...spec, nodes: [{ ...spec.nodes[0], renderer: 'unknown' }] }; } };
  assert.equal((await app.experience.generate(visitor.id, 'Test unsafe output', unknown)).status, 'failed');
});

test('HTTP intent flow validates requests, isolates visitor sessions and blocks cross-origin writes', async t => {
  const { base } = await httpFixture(t);
  const response = await fetch(`${base}/api/experiences`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent: 'Explain seasons' }) });
  assert.equal(response.status, 201);
  const cookieHeader = response.headers.get('set-cookie')!;
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);
  const cookie = cookieHeader.split(';')[0];
  const { experience } = await response.json() as { experience: Experience };
  const own = await fetch(`${base}/api/experiences/${experience.id}`, { headers: { cookie } });
  assert.equal(own.status, 200);
  assert.equal((await own.json() as { experience: Experience }).experience.spec?.title, spec.title);
  assert.equal((await fetch(`${base}/api/experiences/${experience.id}`)).status, 404);
  assert.equal((await fetch(`${base}/api/experiences`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.example' }, body: JSON.stringify({ intent: 'Bad origin' }) })).status, 403);
  assert.equal((await fetch(`${base}/api/experiences`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent: ' ' }) })).status, 400);
  assert.equal((await fetch(`${base}/api/experiences`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken' })).status, 400);
  assert.equal((await fetch(`${base}/api/experiences`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent: 'Hello', javascript: 'unsafe' }) })).status, 400);
});

test('Artifact HTTP supports generic storage, byte ranges, access control and protected deletion', async t => {
  const { application: app, base } = await httpFixture(t);
  const publicResource = await app.artifact.store({ contentType: 'video/mp4', data: Buffer.from('0123456789'), metadata: { public: true } });
  const privateResource = await app.artifact.store({ contentType: 'text/plain', data: Buffer.from('Private') });
  assert.equal((await fetch(`${base}/api/artifacts/${privateResource.id}`)).status, 404);
  const response = await fetch(`${base}/api/artifacts/${publicResource.id}`, { headers: { range: 'bytes=2-5' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.equal(await response.text(), '2345');
  const suffix = await fetch(`${base}/api/artifacts/${publicResource.id}`, { headers: { range: 'bytes=-3' } });
  assert.equal(await suffix.text(), '789');
  assert.equal((await fetch(`${base}/api/artifacts/${publicResource.id}`, { headers: { range: 'bytes=99-' } })).status, 416);
  assert.equal((await fetch(`${base}/api/artifacts/${publicResource.id}`, { method: 'DELETE' })).status, 403);
  const created = await fetch(`${base}/api/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer a-test-owner-token' }, body: JSON.stringify({ contentType: 'application/x-future-type', content: 'Hello, artifact', metadata: { public: true } }) });
  assert.equal(created.status, 201);
  const createdBody = await created.json() as { artifact: { id: string; storageKey?: string } };
  assert.equal(createdBody.artifact.storageKey, undefined);
  assert.equal(await (await fetch(`${base}/api/artifacts/${createdBody.artifact.id}`)).text(), 'Hello, artifact');
  assert.equal((await fetch(`${base}/api/artifacts/${createdBody.artifact.id}`, { method: 'DELETE', headers: { authorization: 'Bearer a-test-owner-token' } })).status, 204);
  assert.equal((await fetch(`${base}/api/artifacts/${createdBody.artifact.id}`)).status, 404);
});
