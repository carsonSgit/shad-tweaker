import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import express from 'express';
import fs from 'fs-extra';
import request from 'supertest';
import componentsRouter from '../src/routes/components.js';

const app = express();
app.use(express.json());
app.use('/api/components', componentsRouter);

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(process.cwd(), '.shadcn-tweaker-test-workspaces');

async function createTempRoot(): Promise<string> {
  const root = path.join(testWorkspaceBase, randomUUID());
  tempRoots.push(root);
  await fs.ensureDir(path.join(root, 'components/ui'));
  process.env.SHADCN_TWEAKER_CWD = root;
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  delete process.env.SHADCN_TWEAKER_CWD;
});

describe('component library routes', () => {
  it('lists component library inventory', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/button.tsx'),
      `export function Button() { return <button className="bg-primary">Save</button>; }`
    );

    const res = await request(app).get('/api/components/library/inventory');

    assert.equal(res.status, 200);
    assert.equal(res.body.components.length, 1);
    assert.equal(res.body.components[0].name, 'button');
  });

  it('returns component detail', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/card.tsx'),
      `export function Card() { return <section>Card</section>; }`
    );

    const res = await request(app).get('/api/components/library/detail/card');

    assert.equal(res.status, 200);
    assert.equal(res.body.component.name, 'card');
    assert.match(res.body.component.content, /function Card/);
  });

  it('returns duplicate reports', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/a.tsx'),
      `export function Shared() { return <div />; }`
    );
    await fs.writeFile(
      path.join(root, 'components/ui/b.tsx'),
      `export function Shared() { return <div />; }`
    );

    const res = await request(app).get('/api/components/library/duplicates');

    assert.equal(res.status, 200);
    assert.ok(
      res.body.duplicates.some(
        (duplicate: { type: string; value: string }) =>
          duplicate.type === 'export' && duplicate.value === 'Shared'
      )
    );
  });

  it('returns 404 for missing component detail', async () => {
    await createTempRoot();

    const res = await request(app).get('/api/components/library/detail/missing');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'COMPONENT_LIBRARY_NOT_FOUND');
  });

  it('rejects traversal-shaped component detail identifiers', async () => {
    await createTempRoot();

    const res = await request(app).get('/api/components/library/detail/..%5Csecret');

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'COMPONENT_LIBRARY_VALIDATION_ERROR');
  });

  it('renames a component through the route', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/badge.tsx'),
      `export function Badge() { return <span />; }`
    );

    const res = await request(app)
      .post('/api/components/library/badge/rename')
      .send({ name: 'status badge' });

    assert.equal(res.status, 200);
    assert.equal(res.body.result.newPath, 'components/ui/status-badge.tsx');
    assert.equal(await fs.pathExists(path.join(root, 'components/ui/status-badge.tsx')), true);
  });

  it('forks and compares components through routes', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/alert.tsx'),
      `export function Alert() { return <div />; }`
    );

    const fork = await request(app)
      .post('/api/components/library/alert/fork')
      .send({ name: 'alert acme' });
    const compare = await request(app).get('/api/components/library/alert/compare');

    assert.equal(fork.status, 200);
    assert.equal(fork.body.result.newPath, 'components/ui/alert-acme.tsx');
    assert.equal(compare.status, 200);
    assert.equal(compare.body.compare.changed, true);
  });

  it('returns 400 when rename body omits a name', async () => {
    await createTempRoot();

    const res = await request(app).post('/api/components/library/missing/rename').send({});

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'COMPONENT_LIBRARY_VALIDATION_ERROR');
  });
});
