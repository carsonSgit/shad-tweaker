import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../src/server.js';

describe('server routes', () => {
  it('rate limits repeated studio asset fallback requests', async () => {
    let limited: request.Response | undefined;
    for (let index = 0; index < 121; index += 1) {
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
});
