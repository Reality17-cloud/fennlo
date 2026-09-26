import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('saved experience and artifact bytes survive a real server process restart', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fennlo-restart-'));
  let child: ChildProcess | undefined;
  const base = 'http://127.0.0.1:3002';
  async function start() {
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], { cwd: process.cwd(), env: { ...process.env, PORT: '3002', FENNLO_DATA_DIR: directory, FENNLO_PROVIDER: 'mock', OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server start timed out')), 10000);
      child!.stdout!.on('data', chunk => { if (String(chunk).includes('Fennlo is ready')) { clearTimeout(timeout); resolve(); } });
      child!.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited with ${code}`)); });
      child!.once('error', error => { clearTimeout(timeout); reject(error); });
    });
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    await new Promise<void>(resolve => { child!.once('exit', () => resolve()); child!.kill(); });
  }
  try {
    await start();
    const response = await fetch(`${base}/api/experiences`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'Explain why seasons happen.' }) });
    assert.equal(response.status, 201);
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const { experience } = await response.json() as { experience: { id: string; spec: unknown } };
    const image = Buffer.from(await (await fetch(`${base}/api/artifacts/reference-image`)).arrayBuffer());
    assert.ok(image.length > 100);
    await stop();
    await start();
    const restored = await fetch(`${base}/api/experiences/${experience.id}`, { headers: { Cookie: cookie } });
    assert.equal(restored.status, 200);
    assert.deepEqual(((await restored.json()) as { experience: { spec: unknown } }).experience.spec, experience.spec);
    const imageAgain = Buffer.from(await (await fetch(`${base}/api/artifacts/reference-image`)).arrayBuffer());
    assert.deepEqual(imageAgain, image);
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
