import 'dotenv/config';
import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { resolve } from 'node:path';
import { createFennloHttpApp } from './bootstrap.js';

const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const { app, application, provider } = await createFennloHttpApp({ production });

const server = createHttpServer(app);
let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;

if (production) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');

server.listen(port, '127.0.0.1', () => console.log(`Fennlo is ready at http://127.0.0.1:${port} (${provider.name})`));
server.on('error', async () => {
  console.error('Fennlo could not start. Check whether its port is already in use.');
  await vite?.close();
  application.close();
  process.exitCode = 1;
});

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(async () => {
    await vite?.close();
    application.close();
    process.exit(0);
  });
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
