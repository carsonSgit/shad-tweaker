import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import express from 'express';
import fs from 'fs-extra';
import request from 'supertest';
import tokensRouter from '../src/routes/tokens.js';
import { createTokenSet } from '../src/services/tokens.js';
import { recordScannedComponents } from '../src/services/workspace.js';
import type { Component } from '../src/types/index.js';

const app = express();
app.use(express.json());
app.use('/api/tokens', tokensRouter);

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(process.cwd(), '.shadcn-tweaker-test-workspaces');

async function createTempRoot(): Promise<string> {
  const root = path.join(testWorkspaceBase, randomUUID());
  tempRoots.push(root);
  await fs.ensureDir(root);
  process.env.SHADCN_TWEAKER_CWD = root;
  return root;
}

async function writeComponent(
  root: string,
  relativePath: string,
  content: string
): Promise<string> {
  const filePath = path.join(root, relativePath);
  await fs.outputFile(filePath, content);
  const stats = await fs.stat(filePath);
  const component: Component = {
    name: path.basename(relativePath, path.extname(relativePath)),
    path: filePath,
    metadata: {
      lines: content.split('\n').length,
      size: stats.size,
      lastModified: stats.mtime.toISOString(),
    },
  };
  await recordScannedComponents([component], root);
  return filePath;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  delete process.env.SHADCN_TWEAKER_CWD;
});

describe('token routes', () => {
  it('validates CRUD HTTP responses and error codes', async () => {
    await createTempRoot();

    const createRes = await request(app).post('/api/tokens/sets').send({ name: 'Route Tokens' });
    const listRes = await request(app).get('/api/tokens/sets');
    const getRes = await request(app).get(`/api/tokens/sets/${createRes.body.tokenSet.id}`);
    const updateRes = await request(app)
      .put(`/api/tokens/sets/${createRes.body.tokenSet.id}`)
      .send({ name: 'Route Tokens v2', tokens: createRes.body.tokenSet.tokens });
    const deleteRes = await request(app).delete(`/api/tokens/sets/${createRes.body.tokenSet.id}`);
    const missingRes = await request(app).get(`/api/tokens/sets/${createRes.body.tokenSet.id}`);

    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.success, true);
    assert.equal(listRes.body.tokenSets.length, 1);
    assert.equal(getRes.body.tokenSet.name, 'Route Tokens');
    assert.equal(updateRes.body.tokenSet.name, 'Route Tokens v2');
    assert.equal(deleteRes.status, 200);
    assert.equal(missingRes.status, 404);
    assert.equal(missingRes.body.error.code, 'TOKEN_SET_NOT_FOUND');
  });

  it('rejects unsafe token IDs and bad categories', async () => {
    await createTempRoot();

    const badId = await request(app).post('/api/tokens/sets').send({
      id: '../nope',
      name: 'Unsafe',
    });
    const badCategory = await request(app)
      .post('/api/tokens/sets')
      .send({ name: 'Bad', tokens: { nope: {} } });

    assert.equal(badId.status, 400);
    assert.equal(badId.body.error.code, 'VALIDATION_ERROR');
    assert.equal(badCategory.status, 400);
    assert.equal(badCategory.body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects traversal component paths and malformed patch payloads', async () => {
    await createTempRoot();

    const traversal = await request(app)
      .post('/api/tokens/extract')
      .send({ componentPaths: [path.resolve('..', '..', 'secret.tsx')] });
    const malformed = await request(app)
      .post('/api/tokens/patch/preview')
      .send({ componentPaths: [], changes: [{ category: 'radius', from: '', to: 'rounded-lg' }] });

    assert.equal(traversal.status, 400);
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'VALIDATION_ERROR');
  });

  it('verifies preview and apply response shapes', async () => {
    const root = await createTempRoot();
    const filePath = await writeComponent(
      root,
      'components/ui/button.tsx',
      '<button className="rounded-md px-4" />'
    );
    const tokenSet = await createTokenSet({ name: 'Route Patch Tokens' });

    const preview = await request(app)
      .post('/api/tokens/patch/preview')
      .send({
        tokenSetId: tokenSet.id,
        componentPaths: [filePath],
        changes: [{ category: 'radius', from: 'rounded-md', to: 'rounded-lg' }],
      });
    const apply = await request(app)
      .post('/api/tokens/patch/apply')
      .send({
        tokenSetId: tokenSet.id,
        componentPaths: [filePath],
        changes: [{ category: 'spacing', from: 'px-4', to: 'px-6', tokenName: 'button-inline' }],
        createBackup: false,
        recordOverrides: true,
      });
    const overrides = await request(app).get(
      `/api/tokens/components/${encodeURIComponent(filePath)}/overrides`
    );

    assert.equal(preview.status, 200);
    assert.equal(preview.body.totalChanges, 1);
    assert.equal(Array.isArray(preview.body.previews), true);
    assert.equal(apply.status, 200);
    assert.equal(apply.body.success, true);
    assert.equal(apply.body.modified.length, 1);
    assert.equal(overrides.status, 200);
    assert.equal(overrides.body.overrides[0].overrides.spacing['button-inline'], 'px-6');
  });

  it('returns frequency and inconsistency reports', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'components/ui/a.tsx', '<div className="rounded-md p-4" />');
    await writeComponent(root, 'components/ui/b.tsx', '<div className="rounded-lg p-4" />');

    const frequency = await request(app).get('/api/tokens/reports/frequency');
    const inconsistencies = await request(app).get('/api/tokens/reports/inconsistencies');

    assert.equal(frequency.status, 200);
    assert.ok(frequency.body.report.entries.length >= 2);
    assert.equal(inconsistencies.status, 200);
    assert.equal(inconsistencies.body.report.entries[0].family, 'radius');
  });
});
