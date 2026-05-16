import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
import express from 'express';
import fs from 'fs-extra';
import request from 'supertest';
import componentsRouter, {
  createComponentLibraryMutationLimiter,
} from '../src/routes/components.js';

const app = express();
app.use(express.json());
app.use('/api/components', componentsRouter);

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(
  process.cwd(),
  '.shadcn-tweaker-test-workspaces',
  'component-library-routes'
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
    assert.equal(res.body.error.message, 'Invalid component identifier.');
  });

  it('rejects encoded slash, double-encoded traversal, null byte, and malformed identifiers', async () => {
    await createTempRoot();

    const urls = [
      '/api/components/library/detail/..',
      '/api/components/library/detail/%2E%2E',
      '/api/components/library/detail/item%2Fsecret',
      '/api/components/library/detail/item%252Fsecret',
      '/api/components/library/detail/item%5Csecret',
      '/api/components/library/detail/item%255Csecret',
      '/api/components/library/detail/item%2F..%2Fsecret',
      '/api/components/library/detail/item%252F..%252Fsecret',
      '/api/components/library/detail/button%00',
      '/api/components/library/detail/%E0%A4%A',
    ];

    for (const url of urls) {
      const res = await request(app).get(url);

      assert.equal(res.status, 400, url);
      assert.equal(res.body.error.code, 'COMPONENT_LIBRARY_VALIDATION_ERROR', url);
      assert.equal(res.body.error.message, 'Invalid component identifier.', url);
    }
  });

  it('rejects mixed-case encoded traversal markers', async () => {
    await createTempRoot();

    const urls = [
      '/api/components/library/detail/%2E%2E',
      '/api/components/library/detail/item%2Fsecret',
      '/api/components/library/detail/item%5Csecret',
    ];

    for (const url of urls) {
      const res = await request(app).get(url);

      assert.equal(res.status, 400, url);
      assert.equal(res.body.error.code, 'COMPONENT_LIBRARY_VALIDATION_ERROR', url);
    }
  });

  it('rejects leading, trailing, pure-dot, and over-length identifiers', async () => {
    await createTempRoot();

    const urls = [
      '/api/components/library/detail/.button',
      '/api/components/library/detail/button.',
      '/api/components/library/detail/...',
      `/api/components/library/detail/${'a'.repeat(129)}`,
    ];

    for (const url of urls) {
      const res = await request(app).get(url);

      assert.equal(res.status, 400, url);
      assert.equal(res.body.error.code, 'COMPONENT_LIBRARY_VALIDATION_ERROR', url);
    }
  });

  it('allows identifiers at the maximum length', async () => {
    const root = await createTempRoot();
    const name = 'a'.repeat(128);
    await fs.writeFile(
      path.join(root, 'components/ui', `${name}.tsx`),
      `export function LongName() { return <div />; }`
    );

    const res = await request(app).get(`/api/components/library/detail/${name}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.component.name, name);
  });

  it('allows dotted and dashed component detail identifiers', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui/chart.axis.tsx'),
      `export function ChartAxis() { return <div />; }`
    );
    await fs.writeFile(
      path.join(root, 'components/ui/date-picker.tsx'),
      `export function DatePicker() { return <div />; }`
    );

    const dotted = await request(app).get('/api/components/library/detail/chart.axis');
    const dashed = await request(app).get('/api/components/library/detail/date-picker');

    assert.equal(dotted.status, 200);
    assert.equal(dotted.body.component.name, 'chart.axis');
    assert.equal(dashed.status, 200);
    assert.equal(dashed.body.component.name, 'date-picker');
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

  it('rate limits component library mutation requests', async () => {
    const limitedApp = express();
    limitedApp.post(
      '/api/components/library/:identifier/rename',
      createComponentLibraryMutationLimiter(2),
      (_req, res) => {
        res.json({ success: true });
      }
    );

    let limited: request.Response | undefined;
    for (let index = 0; index < 3; index += 1) {
      const res = await request(limitedApp)
        .post('/api/components/library/button/rename')
        .send({ name: 'button copy' });
      if (res.status === 429) {
        limited = res;
        break;
      }
    }

    assert.ok(limited);
    assert.equal(limited.body.success, false);
    assert.equal(limited.body.error.code, 'RATE_LIMIT_EXCEEDED');
  });

  it('does not rate limit compare through the mutation limiter', async () => {
    const root = await createTempRoot();
    await fs.writeFile(
      path.join(root, 'components/ui', 'alert.tsx'),
      `export function Alert() { return <div />; }`
    );

    for (let index = 0; index < 3; index += 1) {
      const res = await request(app).get('/api/components/library/alert/compare');

      assert.equal(res.status, 200);
      assert.equal(res.body.compare.changed, true);
    }
  });
});
