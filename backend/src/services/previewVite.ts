import path from 'node:path';
import react from '@vitejs/plugin-react';
import type express from 'express';
import { createServer, type InlineConfig, type ViteDevServer } from 'vite';
import { getWorkingDirectory } from './workspace.js';

type PreviewViteServer = Pick<ViteDevServer, 'close' | 'middlewares'>;
type CreatePreviewViteServer = (config: InlineConfig) => Promise<PreviewViteServer>;
type CreateReactPlugin = typeof react;

interface PreviewViteMiddlewareOptions {
  createServer?: CreatePreviewViteServer;
  getWorkingDirectory?: () => string;
  reactPlugin?: CreateReactPlugin;
}

interface PreviewViteServerCache {
  rootPath: string;
  server: Promise<PreviewViteServer>;
}

async function closePreviewViteServer(cache: PreviewViteServerCache): Promise<void> {
  try {
    const server = await cache.server;
    await server.close();
  } catch {
    // A failed initialization should not keep future preview requests from retrying.
  }
}

export function createPreviewViteMiddleware(options: PreviewViteMiddlewareOptions = {}) {
  const createPreviewViteServer = options.createServer ?? createServer;
  const readWorkingDirectory = options.getWorkingDirectory ?? getWorkingDirectory;
  const createReactPlugin = options.reactPlugin ?? react;
  let previewViteServerCache: PreviewViteServerCache | null = null;

  async function getPreviewViteServer(): Promise<PreviewViteServer> {
    const rootPath = path.resolve(readWorkingDirectory());
    if (previewViteServerCache && previewViteServerCache.rootPath !== rootPath) {
      await closePreviewViteServer(previewViteServerCache);
      previewViteServerCache = null;
    }

    if (!previewViteServerCache) {
      const server = createPreviewViteServer({
        appType: 'custom',
        root: rootPath,
        plugins: [createReactPlugin()],
        server: {
          middlewareMode: true,
        },
      }).catch((error) => {
        if (previewViteServerCache?.server === server) {
          previewViteServerCache = null;
        }
        throw error;
      });
      previewViteServerCache = { rootPath, server };
    }

    return previewViteServerCache.server;
  }

  return async function previewViteMiddleware(
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
  };
}

function shouldHandleWithVite(requestPath: string): boolean {
  return (
    requestPath.startsWith('/components/') ||
    requestPath.startsWith('/src/') ||
    // Vite rewrites dependency imports to /node_modules/ URLs in local preview mode.
    requestPath.startsWith('/node_modules/') ||
    requestPath.startsWith('/@') ||
    requestPath === '/@vite/client'
  );
}

export const previewViteMiddleware = createPreviewViteMiddleware();
