import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import express from 'express';
import fs from 'fs-extra';
import request from 'supertest';
import importsRouter from '../src/routes/imports.js';
import { upsertRegistrySource } from '../src/services/workspace.js';

const app = express();
app.use(express.json());
app.use('/api/imports', importsRouter);

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(process.cwd(), '.shadcn-tweaker-test-workspaces');

async function createTempRoot(): Promise<string> {
  const root = path.join(testWorkspaceBase, randomUUID());
  tempRoots.push(root);
  await fs.ensureDir(root);
  await fs.writeJson(path.join(root, 'package.json'), { dependencies: {} });
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  delete process.env.SHADCN_TWEAKER_CWD;
});

describe('import routes', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function addRegistry(root: string, items: unknown[]) {
    const { source } = await upsertRegistrySource(
      {
        name: 'Registry',
        type: 'shadcn-registry',
        registryJsonUrl: 'https://example.com/registry.json',
        enabled: true,
      },
      root
    );
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ items }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    return source;
  }

  it('returns an import plan for a registry item', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;
    const source = await addRegistry(root, [
      { name: 'button', files: [{ path: 'ui/button.tsx', content: 'button' }] },
    ]);

    const res = await request(app)
      .post('/api/imports/plan')
      .send({ sourceId: source.id, itemName: 'button' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.plan.filesToAdd.length, 1);
  });

  it('returns 400 when itemName is missing', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;

    const res = await request(app).post('/api/imports/plan').send({});

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects unsafe import plan identifiers', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;

    const res = await request(app).post('/api/imports/plan').send({ itemName: '../button' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('returns 404 for unknown registry items', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;
    await addRegistry(root, []);

    const res = await request(app).post('/api/imports/plan').send({ itemName: 'missing' });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'REGISTRY_ITEM_NOT_FOUND');
  });

  it('applies an import plan', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;
    const source = await addRegistry(root, [
      { name: 'button', files: [{ path: 'ui/button.tsx', content: 'button' }] },
    ]);

    const planRes = await request(app)
      .post('/api/imports/plan')
      .send({ sourceId: source.id, itemName: 'button' });
    const applyRes = await request(app)
      .post('/api/imports/apply')
      .send({ plan: planRes.body.plan });

    assert.equal(applyRes.status, 200);
    assert.equal(applyRes.body.success, true);
    assert.equal(
      await fs.readFile(path.join(root, 'components', 'ui', 'button.tsx'), 'utf-8'),
      'button'
    );
  });

  it('returns 400 for invalid apply target paths', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;

    const res = await request(app)
      .post('/api/imports/apply')
      .send({
        plan: {
          id: 'bad',
          itemName: 'button',
          filesToAdd: [{ sourcePath: 'ui/button.tsx', targetPath: '../button.tsx', content: 'x' }],
          filesToOverwrite: [],
        },
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });
});
