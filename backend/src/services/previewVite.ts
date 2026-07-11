import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type express from 'express';
import fs from 'fs-extra';
import { createServer, type InlineConfig, type Plugin, type ViteDevServer } from 'vite';
import {
  createPreviewRuntimeModule,
  createPreviewStylesCss,
  normalizePreviewRequest,
  PREVIEW_RUNTIME_MODULE_PATH,
  PREVIEW_STYLES_MODULE_PATH,
} from './preview.js';
import { getWorkingDirectory, loadWorkspaceManifest } from './workspace.js';

type PreviewViteServer = Pick<ViteDevServer, 'close' | 'middlewares'>;
type CreatePreviewViteServer = (config: InlineConfig) => Promise<PreviewViteServer>;
type CreateReactPlugin = typeof react;

interface PreviewViteMiddlewareOptions {
  createServer?: CreatePreviewViteServer;
  getWorkingDirectory?: () => string;
  reactPlugin?: CreateReactPlugin;
}

interface PreviewViteMiddlewareHandle {
  handler: express.RequestHandler;
  close: () => Promise<void>;
}

interface PreviewViteServerCache {
  rootPath: string;
  server: Promise<PreviewViteServer>;
}

// shadcn components import through the `@/` alias (e.g. `@/lib/utils`), which
// Vite does not resolve on its own. Derive the alias target from the
// workspace tsconfig `paths`; default to the workspace root, the shadcn
// convention when no explicit mapping exists.
export async function resolveWorkspacePreviewAlias(rootPath: string): Promise<string> {
  try {
    const tsconfig = (await fs.readJson(path.join(rootPath, 'tsconfig.json'))) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    const target = tsconfig.compilerOptions?.paths?.['@/*']?.[0];
    if (target) {
      return path.resolve(rootPath, target.replace(/\/?\*$/, ''));
    }
  } catch {
    // Missing or unparseable (e.g. JSONC) tsconfig — fall through to the default.
  }
  return rootPath;
}

function isPreviewRuntimeModuleId(id: string): boolean {
  return id === PREVIEW_RUNTIME_MODULE_PATH || id.startsWith(`${PREVIEW_RUNTIME_MODULE_PATH}?`);
}

// Tailwind's scanner only follows real files, so the preview stylesheet is
// written to disk inside the workspace's .shadcn-tweaker dir and served by
// Vite like any other workspace file.
export async function writePreviewStylesheet(rootPath: string): Promise<void> {
  const manifest = await loadWorkspaceManifest(rootPath);
  const componentDirectory = manifest.config.componentDirectory || './components/ui';
  await fs.outputFile(
    path.join(rootPath, PREVIEW_STYLES_MODULE_PATH.replace(/^\//, '')),
    createPreviewStylesCss(componentDirectory)
  );
}

// Serves the generated preview runtime as a Vite virtual module. Routing it
// through Vite (instead of plain express) lets Vite rewrite its bare imports
// (react, react-dom/client) to browser-loadable optimized-dep URLs.
function createPreviewRuntimePlugin(readWorkingDirectory: () => string): Plugin {
  return {
    name: 'shadcn-tweaker-preview-runtime',
    enforce: 'pre',
    resolveId(id) {
      if (isPreviewRuntimeModuleId(id)) return id;
      return undefined;
    },
    async load(id) {
      if (!isPreviewRuntimeModuleId(id)) return undefined;
      const query = id.split('?')[1] ?? '';
      const request = normalizePreviewRequest(Object.fromEntries(new URLSearchParams(query)));
      return createPreviewRuntimeModule(readWorkingDirectory(), request);
    },
  };
}

async function closePreviewViteServer(cache: PreviewViteServerCache): Promise<void> {
  try {
    const server = await cache.server;
    await server.close();
  } catch {
    // A failed initialization should not keep future preview requests from retrying.
  }
}

export function createPreviewViteMiddleware(
  options: PreviewViteMiddlewareOptions = {}
): PreviewViteMiddlewareHandle {
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
      const server = Promise.all([
        resolveWorkspacePreviewAlias(rootPath),
        writePreviewStylesheet(rootPath),
      ]).then(([aliasTarget]) =>
        createPreviewViteServer({
          appType: 'custom',
          root: rootPath,
          resolve: {
            alias: { '@': aliasTarget },
          },
          plugins: [
            createReactPlugin(),
            tailwindcss(),
            createPreviewRuntimePlugin(readWorkingDirectory),
          ],
          server: {
            middlewareMode: true,
            // The preview frame is sandboxed (allow-scripts without
            // allow-same-origin), so its module fetches arrive from a null
            // origin and need a wildcard Access-Control-Allow-Origin.
            cors: true,
          },
        })
      );
      server.catch(() => {
        if (previewViteServerCache?.server === server) {
          previewViteServerCache = null;
        }
      });
      // Cache the initialization promise synchronously so concurrent preview
      // requests share one Vite startup instead of creating duplicate servers.
      previewViteServerCache = { rootPath, server };
    }

    return previewViteServerCache.server;
  }

  async function handler(
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

  async function close(): Promise<void> {
    if (!previewViteServerCache) return;
    const cache = previewViteServerCache;
    previewViteServerCache = null;
    await closePreviewViteServer(cache);
  }

  return { handler, close };
}

function shouldHandleWithVite(requestPath: string): boolean {
  if (requestPath.startsWith('/node_modules/')) {
    return requestPath.startsWith('/node_modules/.vite/deps/');
  }
  return !(
    requestPath === '/studio' ||
    requestPath.startsWith('/studio/') ||
    requestPath.startsWith('/api/')
  );
}

export const previewViteMiddleware = createPreviewViteMiddleware();
