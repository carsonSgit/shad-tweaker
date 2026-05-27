import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
import express from 'express';
import fs from 'fs-extra';
import request from 'supertest';
import { createPreviewApp, createStudioAssetLimiter, app as serverApp } from '../src/server.js';

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(
  process.cwd(),
  '.shadcn-tweaker-test-workspaces',
  'server-routes'
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

after(async () => {
  await fs.remove(testWorkspaceBase);
});

describe('server routes', () => {
  it('rate limits repeated studio asset fallback requests', async () => {
    const app = express();
    app.use('/studio', createStudioAssetLimiter(2));
    app.get('/studio/*', (_req, res) => {
      res.json({ success: true });
    });

    let limited: request.Response | undefined;
    for (let index = 0; index < 3; index += 1) {
      const res = await request(app).get('/studio/missing-route');
      if (res.status === 429) {
        limited = res;
        break;
      }
    }

    assert.ok(limited);
    assert.equal(limited.body.success, false);
    assert.equal(limited.body.error.code, 'RATE_LIMIT_EXCEEDED');
  });

  it('exercises the studio SPA fallback route', async () => {
    const res = await request(serverApp).get('/studio/workbench/deep-link');

    assert.ok([200, 404].includes(res.status));
    if (res.status === 404) {
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'STUDIO_ASSETS_MISSING');
    } else {
      assert.match(res.text, /<html/i);
    }
  });

  it('preview app parses JSON and returns preview 404 responses for unknown routes', async () => {
    const res = await request(createPreviewApp())
      .post('/studio/preview/unknown')
      .send({ probe: true });

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.equal(res.body.error.message, 'Preview endpoint not found');
  });

  it('rejects oversized preview manifest JSON bodies before route handling', async () => {
    const res = await request(serverApp)
      .post('/api/studio/preview/manifest')
      .set('Content-Type', 'application/json')
      .send({ componentPath: 'components/ui/card.tsx', payload: 'x'.repeat(120_000) });

    assert.equal(res.status, 413);
  });

  it('accepts ordinary preview manifest JSON bodies with the smaller route limit', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/card.tsx'),
      `export function Card() { return <section>Card</section>; }`
    );

    const res = await request(serverApp)
      .post('/api/studio/preview/manifest')
      .send({ componentPath: 'components/ui/card.tsx' });

    assert.equal(res.status, 200);
    assert.equal(res.body.manifest.component.defaultExport, 'Card');
  });
});
