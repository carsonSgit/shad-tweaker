import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../src/server.js';

describe('loader routes', () => {
  it('lists braille loader presets', async () => {
    const res = await request(app).get('/api/loaders/presets');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.presets));
    assert.ok(res.body.presets.length >= 8);
    const dots = res.body.presets.find((preset: { id: string }) => preset.id === 'braille-dots');
    assert.ok(dots);
    assert.ok(Array.isArray(dots.frames));
    assert.equal(typeof dots.intervalMs, 'number');
    assert.equal(typeof dots.reducedMotionFrame, 'string');
  });

  it('generates a loader component from a preset', async () => {
    const res = await request(app).post('/api/loaders/generate').send({
      presetId: 'braille-ring',
      intervalMs: 60,
      label: 'Fetching data',
      color: '#7c3aed',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.generated.presetId, 'braille-ring');
    assert.equal(res.body.generated.intervalMs, 60);
    assert.ok(res.body.generated.code.includes('role="status"'));
    assert.ok(res.body.generated.code.includes('#7c3aed'));
  });

  it('rejects generation without a presetId', async () => {
    const res = await request(app).post('/api/loaders/generate').send({});

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'LOADER_VALIDATION_ERROR');
  });

  it('rejects generation with an out-of-range interval', async () => {
    const res = await request(app)
      .post('/api/loaders/generate')
      .send({ presetId: 'braille-dots', intervalMs: 999999 });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'LOADER_VALIDATION_ERROR');
  });
});
