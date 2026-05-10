import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import express from 'express';
import fs from 'fs-extra';
import request from 'supertest';
import variantsRouter from '../src/routes/variants.js';

const app = express();
app.use(express.json());
app.use('/api/variants', variantsRouter);

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(process.cwd(), '.shadcn-tweaker-test-workspaces');

async function createTempRoot(): Promise<string> {
  const root = path.join(testWorkspaceBase, randomUUID());
  tempRoots.push(root);
  await fs.ensureDir(path.join(root, 'components/ui'));
  process.env.SHADCN_TWEAKER_CWD = root;
  return root;
}

async function writeButton(root: string): Promise<void> {
  await fs.outputFile(
    path.join(root, 'components/ui/button.tsx'),
    `
import { cva } from "class-variance-authority";
const buttonVariants = cva("inline-flex", {
  variants: {
    variant: {
      default: "bg-primary",
    },
  },
  defaultVariants: { variant: "default" },
});
export function Button() { return <button />; }
`
  );
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  delete process.env.SHADCN_TWEAKER_CWD;
});

describe('variant builder routes', () => {
  it('lists component variant summaries', async () => {
    const root = await createTempRoot();
    await writeButton(root);

    const res = await request(app).get('/api/variants/components');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.components[0].name, 'button');
    assert.deepEqual(res.body.components[0].systems, ['cva']);
  });

  it('returns component variant detail', async () => {
    const root = await createTempRoot();
    await writeButton(root);

    const res = await request(app).get('/api/variants/components/button');

    assert.equal(res.status, 200);
    assert.equal(res.body.component.definitions[0].name, 'buttonVariants');
    assert.equal(res.body.component.definitions[0].axes[0].defaultValue, 'default');
  });

  it('previews variant generation without writing component files', async () => {
    const root = await createTempRoot();
    await writeButton(root);
    const filePath = path.join(root, 'components/ui/button.tsx');
    const before = await fs.readFile(filePath, 'utf-8');

    const res = await request(app)
      .post('/api/variants/preview')
      .send({
        componentPath: 'components/ui/button.tsx',
        targetDefinition: 'buttonVariants',
        operation: {
          type: 'add-value',
          axisName: 'variant',
          value: { name: 'ghost', classes: ['bg-transparent'] },
        },
      });
    const after = await fs.readFile(filePath, 'utf-8');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.match(res.body.preview.after, /ghost: 'bg-transparent'/);
    assert.equal(after, before);
  });

  it('returns validation errors for malformed preview payloads', async () => {
    await createTempRoot();

    const res = await request(app)
      .post('/api/variants/preview')
      .send({
        componentPath: 'components/ui/button.tsx',
        targetDefinition: 'buttonVariants',
        operation: { type: 'add-value', axisName: 'variant' },
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VARIANT_BUILDER_VALIDATION_ERROR');
  });

  it('bounds preview request string lengths', async () => {
    await createTempRoot();

    const res = await request(app)
      .post('/api/variants/preview')
      .send({
        componentPath: `${'x'.repeat(261)}.tsx`,
        targetDefinition: 'buttonVariants',
        operation: {
          type: 'add-value',
          axisName: 'variant',
          value: { name: 'ghost', classes: ['bg-transparent'] },
        },
      });

    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /260 characters or fewer/);
  });

  it('rejects traversal-shaped component identifiers', async () => {
    await createTempRoot();

    const res = await request(app).get('/api/variants/components/..%5Csecret');

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'COMPONENT_LIBRARY_VALIDATION_ERROR');
  });

  it('returns 404 for missing components', async () => {
    await createTempRoot();

    const res = await request(app).get('/api/variants/components/missing');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'COMPONENT_LIBRARY_NOT_FOUND');
  });
});
