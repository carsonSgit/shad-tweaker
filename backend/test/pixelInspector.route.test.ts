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
});
