import type { Artifact, Experience, ExperienceNode, ExperienceSpec, Owner, VisitorSession } from '../../src/shared/spec.js';

/** The application depends on these ports, never on SQLite or a storage SDK. */
export interface Repository {
  owner: { get(): Owner };
  sessions: { get(id: string): VisitorSession | null; create(session: VisitorSession): void };
  artifacts: {
    create(artifact: Artifact): void;
    get(id: string): Artifact | null;
    query(filter?: { publicOnly?: boolean; contentType?: string }): Artifact[];
    delete(id: string): void;
    isReferenced(id: string, visitorSessionId?: string): boolean;
  };
  experiences: {
    create(experience: Experience): void;
    get(id: string): Experience | null;
    appendNode(id: string, node: ExperienceNode): void;
    complete(id: string, spec: ExperienceSpec, updatedAt: string): void;
    fail(id: string, error: string, updatedAt: string): void;
  };
  close(): void;
}

export interface ArtifactStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export class ApplicationError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'GENERATION_FAILED', message: string) {
    super(message);
    this.name = 'ApplicationError';
  }
}
