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
});
