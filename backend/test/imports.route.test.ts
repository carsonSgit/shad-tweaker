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

  it('returns an import plan for a registry item', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;
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
      new Response(
        JSON.stringify({
          items: [{ name: 'button', files: [{ path: 'ui/button.tsx', content: 'button' }] }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const res = await request(app)
      .post('/api/imports/plan')
      .send({ sourceId: source.id, itemName: 'button' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.plan.filesToAdd.length, 1);
  });

  it('rejects unsafe import plan identifiers', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;

    const res = await request(app).post('/api/imports/plan').send({ itemName: '../button' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });
});
