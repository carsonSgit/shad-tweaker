import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs-extra';
import request from 'supertest';
import { app } from '../src/server.js';

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(
  process.cwd(),
  '.shadcn-tweaker-test-workspaces',
  'pixel-inspector-routes'
);

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

describe('pixel inspector routes', () => {
  it('analyzes component classes through the API', async () => {
    const root = await createTempRoot();
    await fs.outputFile(
      path.join(root, 'components/ui/badge.tsx'),
      `export function Badge() {
  return <span className="rounded-full px-2 bg-primary text-primary-foreground shadow-sm">Badge</span>;
}`
    );

    const res = await request(app)
      .post('/api/pixel-inspector/analyze')
      .send({ componentPath: 'components/ui/badge.tsx' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.analysis.componentPath, 'components/ui/badge.tsx');
    assert.deepEqual(
      res.body.analysis.candidates.map((candidate: { group: string }) => candidate.group).sort(),
      ['background', 'foreground', 'padding', 'radius', 'shadow']
    );
  });

  it('rejects unsafe analyze paths', async () => {
    const res = await request(app)
      .post('/api/pixel-inspector/analyze')
      .send({ componentPath: '../secret.tsx' });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'PIXEL_INSPECTOR_VALIDATION_ERROR');
  });

  it('previews class patches without writing component files', async () => {
    const root = await createTempRoot();
    const componentPath = path.join(root, 'components/ui/card.tsx');
    const before = `export function Card() {
  return <div className="rounded-md p-2 shadow-sm">Card</div>;
}`;
    await fs.outputFile(componentPath, before);

    const res = await request(app)
      .post('/api/pixel-inspector/preview')
      .send({
        draft: {
          componentPath: 'components/ui/card.tsx',
          targetClasses: ['rounded-md', 'p-2'],
          replacementClasses: ['rounded-lg', 'p-4'],
          rawClassName: 'rounded-lg p-4 shadow-sm',
          saveMode: 'component-patch',
        },
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.totalChanges, 2);
    assert.match(res.body.previews[0].diff, /rounded-lg p-4/);
    assert.equal(await fs.readFile(componentPath, 'utf-8'), before);
  });

  it('applies component class patches with a backup', async () => {
    const root = await createTempRoot();
    const componentPath = path.join(root, 'components/ui/card.tsx');
    await fs.outputFile(
      componentPath,
      `export function Card() {
  return <div className="rounded-md p-2 shadow-sm">Card</div>;
}`
    );

    const res = await request(app)
      .post('/api/pixel-inspector/apply')
      .send({
        draft: {
          componentPath: 'components/ui/card.tsx',
          targetClasses: ['rounded-md', 'p-2'],
          replacementClasses: ['rounded-lg', 'p-4'],
          rawClassName: 'rounded-lg p-4 shadow-sm',
          saveMode: 'component-patch',
        },
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.result.success, true);
    assert.equal(res.body.result.changes, 2);
    assert.ok(res.body.result.backupId);
    assert.match(await fs.readFile(componentPath, 'utf-8'), /rounded-lg p-4 shadow-sm/);
  });
});
