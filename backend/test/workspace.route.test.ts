import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import express from 'express';
import fs from 'fs-extra';
import request from 'supertest';
import workspaceRouter from '../src/routes/workspace.js';
import { upsertRegistrySource } from '../src/services/workspace.js';

const app = express();
app.use(express.json());
app.use('/api/workspace', workspaceRouter);

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(process.cwd(), '.shadcn-tweaker-test-workspaces');

async function createTempRoot(): Promise<string> {
  const root = path.join(testWorkspaceBase, randomUUID());
  tempRoots.push(root);
  await fs.ensureDir(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  delete process.env.SHADCN_TWEAKER_CWD;
});

describe('workspace registry routes', () => {
  it('returns health payload', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;
    await upsertRegistrySource(
      { name: 'Local', type: 'local-folder', baseUrl: './missing', enabled: true },
      root
    );
    const res = await request(app).get('/api/workspace/registry-sources/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(Array.isArray(res.body.health), true);
  });

  it('returns 404 for unknown registry item', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;
    const res = await request(app).get('/api/workspace/registry-items/source/item');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'REGISTRY_ITEM_NOT_FOUND');
  });
});
