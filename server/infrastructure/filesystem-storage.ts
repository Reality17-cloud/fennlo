import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ArtifactStorage } from '../domain/ports.js';
import { ApplicationError } from '../domain/ports.js';

export class FilesystemStorage implements ArtifactStorage {
  private readonly root: string;
  constructor(directory: string) { this.root = resolve(directory); }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.path(key);
    await mkdir(this.root, { recursive: true });
    const temporary = this.path(`${key}-${randomUUID()}.tmp`);
    try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, target); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  }
  async read(key: string): Promise<Uint8Array> { return readFile(this.path(key)); }
  async delete(key: string): Promise<void> {
    await unlink(this.path(key)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
  private path(key: string): string {
    if (!/^[a-zA-Z0-9_-]+(?:\.tmp)?$/.test(key)) throw new ApplicationError('INVALID_INPUT', 'Invalid artifact storage key.');
    const target = resolve(this.root, key);
    if (!target.startsWith(`${this.root}${sep}`)) throw new ApplicationError('INVALID_INPUT', 'Invalid artifact storage key.');
    return target;
  }
}
