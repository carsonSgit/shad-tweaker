import type express from 'express';
import react from '@vitejs/plugin-react';
import { createServer, type ViteDevServer } from 'vite';
import { getWorkingDirectory } from './workspace.js';

let previewViteServer: Promise<ViteDevServer> | null = null;

async function getPreviewViteServer(): Promise<ViteDevServer> {
  previewViteServer ??= createServer({
    appType: 'custom',
    root: getWorkingDirectory(),
    plugins: [react()],
    server: {
      middlewareMode: true,
    },
  });
  return previewViteServer;
}

export async function previewViteMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): Promise<void> {
  if (!shouldHandleWithVite(req.path)) {
    next();
    return;
  }

  const vite = await getPreviewViteServer();
  vite.middlewares(req, res, next);
}

function shouldHandleWithVite(requestPath: string): boolean {
  return (
    requestPath.startsWith('/components/') ||
    requestPath.startsWith('/src/') ||
    requestPath.startsWith('/node_modules/') ||
    requestPath.startsWith('/@') ||
    requestPath === '/@vite/client'
  );
}
