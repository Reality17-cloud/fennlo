import { resolve } from 'node:path';
import { createApplication } from './application/index.js';
import { seedArtifacts } from './application/seed.js';
import { createCapabilityRegistry } from './capabilities/index.js';
import { createHttpApp } from './http/app.js';
import { createProvider, MockGenerativeProvider } from './providers/index.js';

export interface FennloHttpAppOptions {
  production?: boolean;
  dataDirectory?: string;
}

/**
 * Build the complete Fennlo HTTP application without binding a TCP port.
 * Local development and Vercel use the same application/provider/artifact path.
 */
export async function createFennloHttpApp(options: FennloHttpAppOptions = {}) {
  const production = options.production ?? false;
  const defaultDataDirectory = process.env.VERCEL ? '/tmp/fennlo' : './data';
  const dataDirectory = resolve(options.dataDirectory || process.env.FENNLO_DATA_DIR || defaultDataDirectory);
  const provider = createProvider();

  let registry: ReturnType<typeof createCapabilityRegistry>;
  const application = createApplication({
    databasePath: resolve(dataDirectory, 'fennlo.sqlite'),
    storageDirectory: resolve(dataDirectory, 'artifacts'),
    provider,
    capabilities: () => registry?.list() ?? [],
  });

  registry = createCapabilityRegistry({
    provider,
    artifactRead: id => application.artifact.get(id),
    artifactStore: input => application.artifact.store({
      contentType: input.contentType,
      data: Buffer.from(input.dataBase64, 'base64'),
      metadata: input.metadata,
      provenance: input.provenance,
    }),
    artifactQuery: input => application.artifact.query({ contentType: input.contentType, publicOnly: true }).slice(0, input.limit),
    experienceEmit: (id, node) => application.experience.appendNode(id, node),
  });

  await seedArtifacts(application);

  const app = createHttpApp(application, {
    production,
    ownerToken: process.env.FENNLO_OWNER_TOKEN,
    referenceProvider: new MockGenerativeProvider(),
  });

  return { app, application, provider };
}
