import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Artifact, Experience, ExperienceNode, ExperienceSpec, Owner, VisitorSession } from '../../src/shared/spec.js';
import type { Repository } from '../domain/ports.js';

type Row = Record<string, unknown>;

export class SqliteRepository implements Repository {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS owners (
        id TEXT PRIMARY KEY CHECK (id = 'owner'), name TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS visitor_sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id),
        content_type TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
        metadata_json TEXT NOT NULL, provenance_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS experiences (
        id TEXT PRIMARY KEY, visitor_session_id TEXT NOT NULL REFERENCES visitor_sessions(id), intent TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','complete','failed')), provider TEXT NOT NULL,
        spec_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS experience_nodes (
        experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL, position INTEGER NOT NULL, node_json TEXT NOT NULL,
        PRIMARY KEY (experience_id, node_id), UNIQUE (experience_id, position)
      );
      CREATE INDEX IF NOT EXISTS experiences_session ON experiences(visitor_session_id);
    `);
    this.db.prepare('INSERT OR IGNORE INTO owners (id, name, created_at) VALUES (?, ?, ?)').run('owner', 'Fennlo', new Date().toISOString());
  }

  owner = {
    get: (): Owner => {
      const row = this.db.prepare('SELECT * FROM owners WHERE id = ?').get('owner') as Row;
      return { id: String(row.id), name: String(row.name), createdAt: String(row.created_at) };
    },
  };

  sessions = {
    get: (id: string): VisitorSession | null => {
      const row = this.db.prepare('SELECT * FROM visitor_sessions WHERE id = ?').get(id) as Row | undefined;
      return row ? { id: String(row.id), createdAt: String(row.created_at) } : null;
    },
    create: (session: VisitorSession): void => {
      this.db.prepare('INSERT INTO visitor_sessions (id, created_at) VALUES (?, ?)').run(session.id, session.createdAt);
    },
  };

  artifacts = {
    create: (artifact: Artifact): void => {
      this.db.prepare('INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        artifact.id, artifact.ownerId, artifact.contentType, artifact.storageKey, artifact.byteLength,
        JSON.stringify(artifact.metadata), JSON.stringify(artifact.provenance), artifact.createdAt,
      );
    },
    get: (id: string): Artifact | null => {
      const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Row | undefined;
      return row ? this.artifactFromRow(row) : null;
    },
    query: (filter: { publicOnly?: boolean; contentType?: string } = {}): Artifact[] => {
      const conditions: string[] = [];
      const args: string[] = [];
      if (filter.publicOnly) conditions.push("json_extract(metadata_json, '$.public') = 1");
      if (filter.contentType) { conditions.push('content_type = ?'); args.push(filter.contentType); }
      const rows = this.db.prepare(`SELECT * FROM artifacts ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at, id`).all(...args) as Row[];
      return rows.map(row => this.artifactFromRow(row));
    },
    delete: (id: string): void => { this.db.prepare('DELETE FROM artifacts WHERE id = ?').run(id); },
    isReferenced: (id: string, visitorSessionId?: string): boolean => {
      const row = this.db.prepare(`SELECT 1 FROM experience_nodes n JOIN experiences e ON e.id = n.experience_id
        WHERE (json_extract(n.node_json, '$.payload.artifactId') = ? OR json_extract(n.node_json, '$.payload.posterArtifactId') = ?)
        ${visitorSessionId ? 'AND e.visitor_session_id = ?' : ''} LIMIT 1`).get(...(visitorSessionId ? [id, id, visitorSessionId] : [id, id]));
      return Boolean(row);
    },
  };

  experiences = {
    create: (experience: Experience): void => {
      this.db.prepare('INSERT INTO experiences VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        experience.id, experience.visitorSessionId, experience.intent, experience.status, experience.provider,
        null, null, experience.createdAt, experience.updatedAt,
      );
    },
    get: (id: string): Experience | null => {
      const row = this.db.prepare('SELECT * FROM experiences WHERE id = ?').get(id) as Row | undefined;
      if (!row) return null;
      const nodes = this.db.prepare('SELECT node_json FROM experience_nodes WHERE experience_id = ? ORDER BY position').all(id) as Row[];
      const spec = row.spec_json ? { ...JSON.parse(String(row.spec_json)), nodes: nodes.map(n => JSON.parse(String(n.node_json))) } as ExperienceSpec : null;
      return {
        id: String(row.id), visitorSessionId: String(row.visitor_session_id), intent: String(row.intent),
        status: row.status as Experience['status'], provider: String(row.provider), spec,
        error: row.error === null ? null : String(row.error), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      };
    },
    appendNode: (id: string, node: ExperienceNode): void => {
      this.db.prepare(`INSERT INTO experience_nodes (experience_id,node_id,position,node_json)
        VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM experience_nodes WHERE experience_id = ?), ?)`).run(id, node.id, id, JSON.stringify(node));
    },
    complete: (id: string, spec: ExperienceSpec, updatedAt: string): void => {
      this.transaction(() => {
        this.db.prepare('DELETE FROM experience_nodes WHERE experience_id = ?').run(id);
        for (const node of spec.nodes) this.experiences.appendNode(id, node);
        const { nodes: _nodes, ...header } = spec;
        this.db.prepare("UPDATE experiences SET status='complete',spec_json=?,error=NULL,updated_at=? WHERE id=?").run(JSON.stringify(header), updatedAt, id);
      });
    },
    fail: (id: string, error: string, updatedAt: string): void => {
      this.db.prepare("UPDATE experiences SET status='failed',error=?,updated_at=? WHERE id=?").run(error, updatedAt, id);
    },
  };

  close(): void { this.db.close(); }

  private artifactFromRow(row: Row): Artifact {
    return {
      id: String(row.id), ownerId: String(row.owner_id), contentType: String(row.content_type), storageKey: String(row.storage_key),
      byteLength: Number(row.byte_length), metadata: JSON.parse(String(row.metadata_json)),
      provenance: JSON.parse(String(row.provenance_json)), createdAt: String(row.created_at),
    };
  }

  private transaction(operation: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try { operation(); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
