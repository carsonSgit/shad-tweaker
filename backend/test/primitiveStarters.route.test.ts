import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import express from 'express';
import fs from 'fs-extra';
import request from 'supertest';
import primitiveStartersRouter from '../src/routes/primitiveStarters.js';

const app = express();
app.use(express.json());
app.use('/api/primitive-starters', primitiveStartersRouter);

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

describe('primitive starter routes', () => {
  it('lists available starter templates', async () => {
    const res = await request(app).get('/api/primitive-starters');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(
      res.body.templates.map((template: { id: string }) => template.id),
      ['blank-component', 'radix-dialog', 'base-ui-dialog']
    );
  });

  it('previews a starter without writing files', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;

    const res = await request(app)
      .post('/api/primitive-starters/preview')
      .send({ provider: 'blank', componentName: 'Toast Shell' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.result.componentName, 'ToastShell');
    assert.equal(
      await fs.pathExists(path.join(root, 'components', 'ui', 'toast-shell.tsx')),
      false
    );
  });

  it('applies a starter by writing the generated file', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;

    const res = await request(app)
      .post('/api/primitive-starters/apply')
      .send({ provider: 'radix', componentName: 'Dialog' });

    const target = path.join(root, 'components', 'ui', 'dialog.tsx');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.result.written[0], target);
    assert.match(await fs.readFile(target, 'utf-8'), /@radix-ui\/react-dialog/);
  });

  it('reports existing files as apply conflicts without overwrite', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;
    await fs.outputFile(path.join(root, 'components', 'ui', 'dialog.tsx'), 'existing');

    const res = await request(app)
      .post('/api/primitive-starters/apply')
      .send({ provider: 'blank', componentName: 'Dialog' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'PRIMITIVE_STARTER_APPLY_ERROR');
  });

  it('rejects invalid providers', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;

    const res = await request(app)
      .post('/api/primitive-starters/preview')
      .send({ provider: 'headless-ui' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });
});
