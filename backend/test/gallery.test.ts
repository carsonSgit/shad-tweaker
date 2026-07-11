import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../src/server.js';
import { listGalleryFixtures } from '../src/services/gallery.js';

const KINDS = [
  'component',
  'primitive',
  'token-preset',
  'variant-recipe',
  'loader',
  'motion-preset',
];

describe('gallery fixtures', () => {
  it('covers every fixture kind with unique ids', () => {
    const fixtures = listGalleryFixtures();
    const ids = fixtures.map((fixture) => fixture.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const kind of KINDS) {
      assert.ok(
        fixtures.some((fixture) => fixture.kind === kind),
        `missing fixtures of kind ${kind}`
      );
    }
  });

  it('gives every fixture a launchable playground target', () => {
    for (const fixture of listGalleryFixtures()) {
      assert.ok(fixture.title.length > 0, fixture.id);
      assert.ok(fixture.description.length > 0, fixture.id);
      assert.ok(fixture.targetArea.length > 0, fixture.id);
      assert.ok(fixture.tags.length > 0, fixture.id);
    }
  });

  it('includes braille loader presets and primitive starters dynamically', () => {
    const fixtures = listGalleryFixtures();
    const loader = fixtures.find((fixture) => fixture.id === 'loader-braille-dots');
    assert.ok(loader);
    assert.equal(loader.targetArea, 'loaders');
    assert.equal(loader.data?.presetId, 'braille-dots');

    const primitives = fixtures.filter((fixture) => fixture.kind === 'primitive');
    assert.ok(primitives.length >= 2);
  });

  it('serves fixtures through the API', async () => {
    const res = await request(app).get('/api/gallery/fixtures');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.fixtures.length >= 15);
  });
});
