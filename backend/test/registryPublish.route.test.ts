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
  'registry-publish-routes'
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

const CARD = `import { cn } from '@/lib/utils';

export function Card() {
  return <div className={cn('rounded-lg border p-4')}>Card</div>;
}
`;

describe('registry publish routes', () => {
  it('generates, validates, and serves a registry', async () => {
    const root = await createTempRoot();
    await fs.outputFile(path.join(root, 'components/ui/card.tsx'), CARD);

    const generated = await request(app)
      .post('/api/registry-publish/generate')
      .send({ name: 'test-registry' });
    assert.equal(generated.status, 200);
    assert.equal(generated.body.itemCount, 1);

    const validation = await request(app).get('/api/registry-publish/validate');
    assert.equal(validation.status, 200);
    assert.equal(validation.body.validation.valid, true);

    const index = await request(app).get('/r/registry.json');
    assert.equal(index.status, 200);
    assert.equal(index.body.name, 'test-registry');
    assert.equal(index.body.items.length, 1);

    const item = await request(app).get('/r/card.json');
    assert.equal(item.status, 200);
    assert.equal(item.body.name, 'card');
    assert.equal(item.body.files[0].content, CARD);
  });

  it('simulates a sample app install from the served registry', async () => {
    const root = await createTempRoot();
    await fs.outputFile(path.join(root, 'components/ui/card.tsx'), CARD);
    await request(app).post('/api/registry-publish/generate').send({});

    // Emulate what `shadcn add <url>/r/card.json` does: fetch the item and
    // materialize its files into a sample app.
    const item = await request(app).get('/r/card.json');
    assert.equal(item.status, 200);

    const sampleApp = path.join(root, 'sample-app');
    for (const file of item.body.files) {
      const target = path.join(sampleApp, file.path.replace('registry/default', 'components'));
      await fs.outputFile(target, file.content);
    }

    const installed = await fs.readFile(path.join(sampleApp, 'components/ui/card.tsx'), 'utf-8');
    assert.equal(installed, CARD);
  });

  it('404s before generation and rejects invalid item names', async () => {
    await createTempRoot();

    const index = await request(app).get('/r/registry.json');
    assert.equal(index.status, 404);
    assert.equal(index.body.error.code, 'REGISTRY_NOT_GENERATED');

    const invalid = await request(app).get('/r/..%2Fregistry.json');
    assert.equal(invalid.status, 400);

    const missing = await request(app).get('/r/nope.json');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'REGISTRY_ITEM_NOT_FOUND');
  });

  it('returns publish instructions', async () => {
    const res = await request(app).get('/api/registry-publish/instructions');
    assert.equal(res.status, 200);
    assert.ok(res.body.instructions.includes('npx shadcn@latest add'));
  });
});
