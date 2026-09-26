import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Application } from './index.js';

/** All reference resources use the same persistent artifact system as future generated media. */
export async function seedArtifacts(application: Application): Promise<void> {
  const seed = async (id: string, contentType: string, data: Uint8Array, title: string) => {
    if (application.repository.artifacts.get(id)) return;
    await application.artifact.store({ id, contentType, data, metadata: { public: true, title }, provenance: { source: 'fennlo-local-fixture', generated: false } });
  };
  await seed('reference-text', 'text/plain; charset=utf-8', Buffer.from('Seasons happen because Earth’s axis is tilted about 23.4°. As Earth orbits the Sun, each hemisphere takes its turn leaning toward sunlight. More direct sunlight and longer days bring summer; less direct sunlight and shorter days bring winter.'), 'Why seasons happen');
  await seed('reference-scene', 'application/json', Buffer.from(JSON.stringify({ kind: 'seasons', tilt: 23.4, labels: ['June solstice', 'December solstice'] })), 'Earth and Sun scene');
  await seed('reference-audio', 'audio/wav', createAmbientWave(), 'A quiet ambient tone');
  for (const [id, type, filename, title] of [
    ['reference-image', 'image/png', 'atmosphere.png', 'Atmospheric study'],
    ['reference-video', 'video/mp4', 'ambient.mp4', 'A moving atmospheric study'],
  ]) {
    try {
      const bytes = await readFile(fileURLToPath(new URL(`../fixtures/${filename}`, import.meta.url)));
      await seed(id, type, bytes, title);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function createAmbientWave(): Uint8Array {
  const sampleRate = 22050;
  const seconds = 6;
  const length = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + length * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const fade = Math.min(1, t / 1.5, (seconds - t) / 1.5);
    const amplitude = (Math.sin(2 * Math.PI * 130.81 * t) + 0.45 * Math.sin(2 * Math.PI * 196 * t)) * fade * 0.055;
    buffer.writeInt16LE(Math.round(amplitude * 32767), 44 + i * 2);
  }
  return buffer;
}
