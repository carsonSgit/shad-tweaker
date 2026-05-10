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
): Promise<{ absolutePath: string; relativePath: string }> {
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
  return { absolutePath: filePath, relativePath };
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

  it('rejects token set names that only differ by case', async () => {
    await createTempRoot();

    const created = await request(app).post('/api/tokens/sets').send({ name: 'App Tokens' });
    const duplicateCreate = await request(app).post('/api/tokens/sets').send({
      name: 'app tokens',
    });
    const second = await request(app).post('/api/tokens/sets').send({ name: 'Other Tokens' });
    const duplicateUpdate = await request(app)
      .put(`/api/tokens/sets/${second.body.tokenSet.id}`)
      .send({ name: 'APP TOKENS', tokens: second.body.tokenSet.tokens });

    assert.equal(created.status, 201);
    assert.equal(duplicateCreate.status, 409);
    assert.equal(duplicateUpdate.status, 409);
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
    const tooLongChange = await request(app)
      .post('/api/tokens/patch/preview')
      .send({
        componentPaths: [],
        changes: [{ category: 'radius', from: 'x'.repeat(257), to: 'rounded-lg' }],
      });

    assert.equal(traversal.status, 400);
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'VALIDATION_ERROR');
    assert.equal(tooLongChange.status, 400);
  });

  it('rejects component path arrays over the route limit', async () => {
    await createTempRoot();

    const res = await request(app)
      .post('/api/tokens/extract')
      .send({
        componentPaths: Array.from({ length: 101 }, (_, index) => `component-${index}.tsx`),
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects invalid component override payloads', async () => {
    const root = await createTempRoot();
    const { relativePath } = await writeComponent(root, 'components/ui/button.tsx', '<button />');
    const tokenSet = await createTokenSet({ name: 'Override Tokens' });

    const unsafeTokenSet = await request(app)
      .put('/api/tokens/components/overrides')
      .send({
        componentPath: relativePath,
        overrides: [{ tokenSetId: '../bad', overrides: { radius: { card: 'rounded-lg' } } }],
      });
    const unknownTokenSet = await request(app)
      .put('/api/tokens/components/overrides')
      .send({
        componentPath: relativePath,
        overrides: [
          { tokenSetId: 'token_set_missing', overrides: { radius: { card: 'rounded-lg' } } },
        ],
      });
    const badCategory = await request(app)
      .put('/api/tokens/components/overrides')
      .send({
        componentPath: relativePath,
        overrides: [{ tokenSetId: tokenSet.id, overrides: { nope: { card: 'rounded-lg' } } }],
      });
    const missingPath = await request(app)
      .put('/api/tokens/components/overrides')
      .send({
        componentPath: 'components/ui/missing.tsx',
        overrides: [{ tokenSetId: tokenSet.id, overrides: { radius: { card: 'rounded-lg' } } }],
      });

    assert.equal(unsafeTokenSet.status, 400);
    assert.equal(unknownTokenSet.status, 400);
    assert.equal(badCategory.status, 400);
    assert.equal(missingPath.status, 400);
    assert.match(missingPath.body.error.message, /could not be resolved/);
  });

  it('verifies preview and apply response shapes', async () => {
    const root = await createTempRoot();
    const { relativePath } = await writeComponent(
      root,
      'components/ui/button.tsx',
      '<button className="rounded-md px-4" />'
    );
    const tokenSet = await createTokenSet({ name: 'Route Patch Tokens' });

    const preview = await request(app)
      .post('/api/tokens/patch/preview')
      .send({
        tokenSetId: tokenSet.id,
        componentPaths: [relativePath],
        changes: [{ category: 'radius', from: 'rounded-md', to: 'rounded-lg' }],
      });
    const apply = await request(app)
      .post('/api/tokens/patch/apply')
      .send({
        tokenSetId: tokenSet.id,
        componentPaths: [relativePath],
        changes: [{ category: 'spacing', from: 'px-4', to: 'px-6', tokenName: 'button-inline' }],
        createBackup: false,
        recordOverrides: true,
      });
    const overrides = await request(app).get('/api/tokens/components/overrides').query({
      componentPath: relativePath,
    });

    assert.equal(preview.status, 200);
    assert.equal(preview.body.totalChanges, 1);
    assert.equal(Array.isArray(preview.body.previews), true);
    assert.equal(apply.status, 200);
    assert.equal(apply.body.success, true);
    assert.equal(apply.body.modified.length, 1);
    assert.equal(overrides.status, 200);
    assert.equal(overrides.body.overrides[0].overrides.spacing['button-inline'], 'px-6');
  });

  it('trims patch change values before previewing', async () => {
    const root = await createTempRoot();
    const { relativePath } = await writeComponent(
      root,
      'components/ui/trimmed.tsx',
      '<button className="rounded-md" />'
    );

    const preview = await request(app)
      .post('/api/tokens/patch/preview')
      .send({
        componentPaths: [relativePath],
        changes: [{ category: 'radius', from: ' rounded-md ', to: ' rounded-lg ' }],
      });

    assert.equal(preview.status, 200);
    assert.equal(preview.body.totalChanges, 1);
    assert.match(preview.body.previews[0].after, /rounded-lg/);
  });

  it('supports component override paths through query and body payloads', async () => {
    const root = await createTempRoot();
    const { relativePath } = await writeComponent(
      root,
      'components/ui/query-button.tsx',
      '<button />'
    );
    const tokenSet = await createTokenSet({ name: 'Query Override Tokens' });

    const put = await request(app)
      .put('/api/tokens/components/overrides')
      .send({
        componentPath: relativePath,
        overrides: [{ tokenSetId: tokenSet.id, overrides: { radius: { card: 'rounded-lg' } } }],
      });
    const get = await request(app).get('/api/tokens/components/overrides').query({
      componentPath: relativePath,
    });

    assert.equal(put.status, 200);
    assert.equal(get.status, 200);
    assert.equal(get.body.overrides[0].componentPath, relativePath);
    assert.equal(get.body.overrides[0].overrides.radius.card, 'rounded-lg');
  });

  it('replaces all component overrides on PUT', async () => {
    const root = await createTempRoot();
    const { relativePath } = await writeComponent(
      root,
      'components/ui/replace-button.tsx',
      '<button />'
    );
    const first = await createTokenSet({ name: 'First Override Tokens' });
    const second = await createTokenSet({ name: 'Second Override Tokens' });

    const initial = await request(app)
      .put('/api/tokens/components/overrides')
      .send({
        componentPath: relativePath,
        overrides: [
          { tokenSetId: first.id, overrides: { radius: { card: 'rounded-lg' } } },
          { tokenSetId: second.id, overrides: { radius: { card: 'rounded-sm' } } },
        ],
      });
    const replaced = await request(app)
      .put('/api/tokens/components/overrides')
      .send({
        componentPath: relativePath,
        overrides: [{ tokenSetId: first.id, overrides: { radius: { card: 'rounded-xl' } } }],
      });

    assert.equal(initial.status, 200);
    assert.equal(replaced.status, 200);
    assert.deepEqual(
      replaced.body.overrides.map((override: { tokenSetId: string }) => override.tokenSetId),
      [first.id]
    );
    assert.equal(replaced.body.overrides[0].overrides.radius.card, 'rounded-xl');
  });

  it('does not expose slash-encoded component override path routes', async () => {
    const root = await createTempRoot();
    const { relativePath } = await writeComponent(
      root,
      'components/ui/legacy-route.tsx',
      '<button />'
    );

    const get = await request(app).get(
      `/api/tokens/components/${encodeURIComponent(relativePath)}/overrides`
    );

    assert.equal(get.status, 404);
  });

  it('rejects patch apply with an unknown token set before editing files', async () => {
    const root = await createTempRoot();
    const { absolutePath, relativePath } = await writeComponent(
      root,
      'components/ui/button.tsx',
      '<button className="rounded-md" />'
    );

    const apply = await request(app)
      .post('/api/tokens/patch/apply')
      .send({
        tokenSetId: 'token_set_missing',
        componentPaths: [relativePath],
        changes: [{ category: 'radius', from: 'rounded-md', to: 'rounded-lg' }],
        createBackup: false,
        recordOverrides: true,
      });
    const content = await fs.readFile(absolutePath, 'utf-8');

    assert.equal(apply.status, 400);
    assert.equal(apply.body.error.code, 'VALIDATION_ERROR');
    assert.match(content, /rounded-md/);
  });

  it('returns a specific validation error for invalid patch apply token set IDs', async () => {
    await createTempRoot();

    const missing = await request(app)
      .post('/api/tokens/patch/apply')
      .send({
        componentPaths: ['components/ui/button.tsx'],
        changes: [{ category: 'radius', from: 'rounded-md', to: 'rounded-lg' }],
      });
    const unsafe = await request(app)
      .post('/api/tokens/patch/apply')
      .send({
        tokenSetId: '../bad',
        componentPaths: ['components/ui/button.tsx'],
        changes: [{ category: 'radius', from: 'rounded-md', to: 'rounded-lg' }],
      });

    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.message, 'Invalid token set ID');
    assert.equal(unsafe.status, 400);
    assert.equal(unsafe.body.error.message, 'Invalid token set ID');
  });

  it('returns 400 for patch apply input paths that cannot be resolved', async () => {
    await createTempRoot();
    const tokenSet = await createTokenSet({ name: 'Missing Apply Path Tokens' });

    const apply = await request(app)
      .post('/api/tokens/patch/apply')
      .send({
        tokenSetId: tokenSet.id,
        componentPaths: ['components/ui/missing.tsx'],
        changes: [{ category: 'radius', from: 'rounded-md', to: 'rounded-lg' }],
        createBackup: false,
      });

    assert.equal(apply.status, 400);
    assert.equal(apply.body.success, false);
    assert.match(apply.body.errors[0].error, /could not be resolved/);
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
