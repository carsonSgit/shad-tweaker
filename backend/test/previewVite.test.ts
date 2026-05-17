import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type express from 'express';
import fs from 'fs-extra';
import type { InlineConfig } from 'vite';
import { createPreviewViteMiddleware } from '../src/services/previewVite.js';

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(
  process.cwd(),
  '.shadcn-tweaker-test-workspaces',
  'preview-vite'
);

interface FakeViteServer {
  closeCalls: number;
  middlewares: express.RequestHandler;
  close: () => Promise<void>;
}

type FakeCreateServer = (options: InlineConfig) => Promise<FakeViteServer>;

async function createTempRoot(): Promise<string> {
  const root = path.join(testWorkspaceBase, randomUUID());
  tempRoots.push(root);
  await fs.ensureDir(root);
  return root;
}

function createRequest(pathname: string) {
  return { path: pathname } as express.Request;
}

function createResponse() {
  return {} as express.Response;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

describe('preview Vite middleware', () => {
  it('reuses the Vite server while the workspace root is unchanged', async () => {
    const root = await createTempRoot();
    const createdRoots: string[] = [];
    const createServer: FakeCreateServer = async (options) => {
      createdRoots.push(options.root);
      return createFakeViteServer();
    };
    const middleware = createPreviewViteMiddleware({
      createServer,
      getWorkingDirectory: () => root,
      reactPlugin: createFakeReactPlugin,
    });

    await middleware.handler(createRequest('/components/ui/button.tsx'), createResponse(), noop);
    await middleware.handler(createRequest('/components/ui/card.tsx'), createResponse(), noop);

    assert.deepEqual(createdRoots, [path.resolve(root)]);
  });

  it('closes and replaces the Vite server when the workspace root changes', async () => {
    const firstRoot = await createTempRoot();
    const secondRoot = await createTempRoot();
    let currentRoot = firstRoot;
    const servers: FakeViteServer[] = [];
    const createdRoots: string[] = [];
    const createServer: FakeCreateServer = async (options) => {
      createdRoots.push(options.root);
      const server = createFakeViteServer();
      servers.push(server);
      return server;
    };
    const middleware = createPreviewViteMiddleware({
      createServer,
      getWorkingDirectory: () => currentRoot,
      reactPlugin: createFakeReactPlugin,
    });

    await middleware.handler(createRequest('/components/ui/button.tsx'), createResponse(), noop);

    currentRoot = secondRoot;
    await middleware.handler(createRequest('/components/ui/card.tsx'), createResponse(), noop);

    assert.deepEqual(createdRoots, [path.resolve(firstRoot), path.resolve(secondRoot)]);
    assert.equal(servers[0].closeCalls, 1);
    assert.equal(servers[1].closeCalls, 0);
  });

  it('clears a failed Vite initialization so the next request retries', async () => {
    const root = await createTempRoot();
    let attempts = 0;
    const createServer: FakeCreateServer = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('Vite unavailable');
      }
      return createFakeViteServer();
    };
    const middleware = createPreviewViteMiddleware({
      createServer,
      getWorkingDirectory: () => root,
      reactPlugin: createFakeReactPlugin,
    });

    await assert.rejects(
      () => middleware.handler(createRequest('/components/ui/button.tsx'), createResponse(), noop),
      /Vite unavailable/
    );
    await middleware.handler(createRequest('/components/ui/button.tsx'), createResponse(), noop);

    assert.equal(attempts, 2);
  });

  it('does not serve reserved paths through the preview Vite middleware', async () => {
    const root = await createTempRoot();
    let createServerCalls = 0;
    const skippedPaths: string[] = [];
    const middleware = createPreviewViteMiddleware({
      createServer: async () => {
        createServerCalls += 1;
        return createFakeViteServer();
      },
      getWorkingDirectory: () => root,
      reactPlugin: createFakeReactPlugin,
    });

    for (const pathname of [
      '/studio/preview/runtime',
      '/api/health',
      '/studio',
      '/node_modules/react/index.js',
    ]) {
      await middleware.handler(createRequest(pathname), createResponse(), () => {
        skippedPaths.push(pathname);
      });
    }

    assert.equal(createServerCalls, 0);
    assert.deepEqual(skippedPaths, [
      '/studio/preview/runtime',
      '/api/health',
      '/studio',
      '/node_modules/react/index.js',
    ]);
  });

  it('serves preview source and Vite internal paths through Vite', async () => {
    const root = await createTempRoot();
    const handledPaths: string[] = [];
    const middleware = createPreviewViteMiddleware({
      createServer: async () => ({
        closeCalls: 0,
        middlewares: (req, _res, next) => {
          handledPaths.push(req.path);
          if (typeof next === 'function') next();
        },
        async close() {
          this.closeCalls += 1;
        },
      }),
      getWorkingDirectory: () => root,
      reactPlugin: createFakeReactPlugin,
    });

    await middleware.handler(createRequest('/components/ui/button.tsx'), createResponse(), noop);
    await middleware.handler(createRequest('/app/components/button.tsx'), createResponse(), noop);
    await middleware.handler(createRequest('/src/lib/utils.ts'), createResponse(), noop);
    await middleware.handler(
      createRequest('/node_modules/.vite/deps/react.js'),
      createResponse(),
      noop
    );
    await middleware.handler(createRequest('/@vite/client'), createResponse(), noop);

    assert.deepEqual(handledPaths, [
      '/components/ui/button.tsx',
      '/app/components/button.tsx',
      '/src/lib/utils.ts',
      '/node_modules/.vite/deps/react.js',
      '/@vite/client',
    ]);
  });

  it('closes the cached Vite server on request', async () => {
    const root = await createTempRoot();
    const server = createFakeViteServer();
    const middleware = createPreviewViteMiddleware({
      createServer: async () => server,
      getWorkingDirectory: () => root,
      reactPlugin: createFakeReactPlugin,
    });

    await middleware.handler(createRequest('/components/ui/button.tsx'), createResponse(), noop);
    await middleware.close();

    assert.equal(server.closeCalls, 1);
  });

  it('allows close after failed initialization and retries later', async () => {
    const root = await createTempRoot();
    let attempts = 0;
    const middleware = createPreviewViteMiddleware({
      createServer: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Vite unavailable');
        return createFakeViteServer();
      },
      getWorkingDirectory: () => root,
      reactPlugin: createFakeReactPlugin,
    });

    await assert.rejects(
      () => middleware.handler(createRequest('/components/ui/button.tsx'), createResponse(), noop),
      /Vite unavailable/
    );
    await middleware.close();
    await middleware.handler(createRequest('/components/ui/button.tsx'), createResponse(), noop);

    assert.equal(attempts, 2);
  });
});

function createFakeViteServer(): FakeViteServer {
  return {
    closeCalls: 0,
    middlewares: (_req, _res, next) => {
      if (typeof next === 'function') next();
    },
    async close() {
      this.closeCalls += 1;
    },
  };
}

function createFakeReactPlugin() {
  return { name: 'fake-react' };
}

function noop() {}
