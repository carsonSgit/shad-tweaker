import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createStudioAssetLimiter, app as serverApp } from '../src/server.js';

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
});
