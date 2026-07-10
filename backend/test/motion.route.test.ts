import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs-extra';
import request from 'supertest';
import { app } from '../src/server.js';
import { DEFAULT_MOTION_SETTINGS } from '../src/services/motion.js';

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(
  process.cwd(),
  '.shadcn-tweaker-test-workspaces',
  'motion-routes'
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

const COMPONENT = `export function Card() {
  return (
    <div className="rounded-md border p-4">
      <span className="text-sm">Card</span>
    </div>
  );
}
`;

describe('motion routes', () => {
  it('returns default motion settings', async () => {
    const res = await request(app).get('/api/motion/defaults');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.settings, DEFAULT_MOTION_SETTINGS);
  });

  it('builds motion output from settings', async () => {
    const res = await request(app)
      .post('/api/motion/output')
      .send({ settings: DEFAULT_MOTION_SETTINGS });
    assert.equal(res.status, 200);
    assert.ok(res.body.output.tailwindClasses.includes('animate-in'));
    assert.ok(res.body.output.css.includes('@keyframes motion-enter'));
  });

  it('rejects invalid settings', async () => {
    const res = await request(app)
      .post('/api/motion/output')
      .send({ settings: { ...DEFAULT_MOTION_SETTINGS, easing: 'wiggly' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'MOTION_VALIDATION_ERROR');
  });

  it('lists motion slots for a component', async () => {
    const root = await createTempRoot();
    await fs.outputFile(path.join(root, 'components/ui/card.tsx'), COMPONENT);

    const res = await request(app)
      .post('/api/motion/slots')
      .send({ componentPath: 'components/ui/card.tsx' });

    assert.equal(res.status, 200);
    assert.equal(res.body.slots.length, 2);
    assert.equal(res.body.slots[0].tagName, 'div');
    assert.equal(res.body.slots[0].patchable, true);
  });

  it('previews and applies motion classes to a selected slot', async () => {
    const root = await createTempRoot();
    const componentPath = path.join(root, 'components/ui/card.tsx');
    await fs.outputFile(componentPath, COMPONENT);

    const preview = await request(app).post('/api/motion/preview').send({
      componentPath: 'components/ui/card.tsx',
      line: 3,
      settings: DEFAULT_MOTION_SETTINGS,
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.totalChanges, 1);
    assert.ok(preview.body.tailwindClasses.includes('animate-in'));

    const apply = await request(app).post('/api/motion/apply').send({
      componentPath: 'components/ui/card.tsx',
      line: 3,
      settings: DEFAULT_MOTION_SETTINGS,
      createBackup: false,
    });
    assert.equal(apply.status, 200);
    assert.equal(apply.body.result.changes, 1);

    const content = await fs.readFile(componentPath, 'utf-8');
    assert.ok(content.includes('rounded-md border p-4 duration-[200ms]'));
    assert.ok(content.includes('animate-in'));
    // The other slot is untouched.
    assert.ok(content.includes('className="text-sm"'));
  });

  it('rejects applying motion to a line without a static className', async () => {
    const root = await createTempRoot();
    await fs.outputFile(path.join(root, 'components/ui/card.tsx'), COMPONENT);

    const res = await request(app).post('/api/motion/apply').send({
      componentPath: 'components/ui/card.tsx',
      line: 1,
      settings: DEFAULT_MOTION_SETTINGS,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'MOTION_VALIDATION_ERROR');
  });

  it('creates, lists, and deletes motion presets', async () => {
    await createTempRoot();

    const created = await request(app).post('/api/motion/presets').send({
      name: 'Dialog pop',
      description: 'Soft scale and fade for dialogs',
      settings: DEFAULT_MOTION_SETTINGS,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.preset.name, 'Dialog pop');
    assert.ok(created.body.preset.id.startsWith('motion_dialog-pop'));

    const listed = await request(app).get('/api/motion/presets');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.presets.length, 1);
    assert.deepEqual(listed.body.presets[0].settings, DEFAULT_MOTION_SETTINGS);

    const deleted = await request(app).delete(`/api/motion/presets/${created.body.preset.id}`);
    assert.equal(deleted.status, 200);

    const relisted = await request(app).get('/api/motion/presets');
    assert.equal(relisted.body.presets.length, 0);
  });

  it('404s when deleting a missing preset', async () => {
    await createTempRoot();
    const res = await request(app).delete('/api/motion/presets/motion_nope');
    assert.equal(res.status, 404);
  });
});
