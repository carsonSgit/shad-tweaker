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

  it('returns a direct validation error when axis values are missing', async () => {
    await createTempRoot();

    const res = await request(app)
      .post('/api/variants/preview')
      .send({
        componentPath: 'components/ui/button.tsx',
        targetDefinition: 'buttonVariants',
        operation: {
          type: 'add-axis',
          axis: { name: 'size' },
        },
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.message, 'axis.values is required.');
  });

  it('allows long preview component paths through validation', async () => {
    await createTempRoot();
    const nestedPath = `components/ui/${Array.from(
      { length: 25 },
      (_, index) => `segment-${index}`
    ).join('/')}/button.tsx`;

    const res = await request(app)
      .post('/api/variants/preview')
      .send({
        componentPath: nestedPath,
        targetDefinition: 'buttonVariants',
        operation: {
          type: 'add-value',
          axisName: 'variant',
          value: { name: 'ghost', classes: ['bg-transparent'] },
        },
      });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'COMPONENT_LIBRARY_NOT_FOUND');
  });

  it('bounds preview identifier string lengths', async () => {
    await createTempRoot();

    const res = await request(app)
      .post('/api/variants/preview')
      .send({
        componentPath: 'components/ui/button.tsx',
        targetDefinition: 'x'.repeat(261),
        operation: {
          type: 'add-value',
          axisName: 'variant',
          value: { name: 'ghost', classes: ['bg-transparent'] },
        },
      });

    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /260 characters or fewer/);
  });

  it('bounds add-axis defaultValue string lengths', async () => {
    await createTempRoot();

    const res = await request(app)
      .post('/api/variants/preview')
      .send({
        componentPath: 'components/ui/button.tsx',
        targetDefinition: 'buttonVariants',
        operation: {
          type: 'add-axis',
          axis: {
            name: 'size',
            values: [{ name: 'sm', classes: ['h-8'] }],
          },
          defaultValue: 'x'.repeat(261),
        },
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VARIANT_BUILDER_VALIDATION_ERROR');
    assert.match(res.body.error.message, /260 characters or fewer/);
  });

  it('bounds add-axis nested axis defaultValue string lengths', async () => {
    await createTempRoot();

    const res = await request(app)
      .post('/api/variants/preview')
      .send({
        componentPath: 'components/ui/button.tsx',
        targetDefinition: 'buttonVariants',
        operation: {
          type: 'add-axis',
          axis: {
            name: 'size',
            values: [{ name: 'sm', classes: ['h-8'] }],
            defaultValue: 'x'.repeat(261),
          },
        },
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VARIANT_BUILDER_VALIDATION_ERROR');
    assert.match(res.body.error.message, /260 characters or fewer/);
  });

  it('rejects traversal-shaped component identifiers', async () => {
    await createTempRoot();

    const res = await request(app).get('/api/variants/components/..%5Csecret');

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'COMPONENT_LIBRARY_VALIDATION_ERROR');
    assert.equal(res.body.error.message, 'Invalid component identifier.');
  });

  it('rejects encoded slash, double-encoded traversal, null byte, and malformed identifiers', async () => {
    await createTempRoot();

    const urls = [
      '/api/variants/components/..',
      '/api/variants/components/%2E%2E',
      '/api/variants/components/item%2Fsecret',
      '/api/variants/components/item%252Fsecret',
      '/api/variants/components/item%5Csecret',
      '/api/variants/components/item%255Csecret',
      '/api/variants/components/item%2F..%2Fsecret',
      '/api/variants/components/item%252F..%252Fsecret',
      '/api/variants/components/button%00',
      '/api/variants/components/%E0%A4%A',
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
      '/api/variants/components/%2E%2E',
      '/api/variants/components/item%2Fsecret',
      '/api/variants/components/item%5Csecret',
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
      '/api/variants/components/.button',
      '/api/variants/components/button.',
      '/api/variants/components/...',
      `/api/variants/components/${'a'.repeat(129)}`,
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
    await fs.outputFile(
      path.join(root, 'components/ui', `${name}.tsx`),
      `
import { cva } from "class-variance-authority";
const variants = cva("block", {
  variants: { size: { sm: "text-sm" } },
  defaultVariants: { size: "sm" },
});
export function LongName() { return <div />; }
`
    );

    const res = await request(app).get(`/api/variants/components/${name}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.component.name, name);
  });

  it('allows dotted and dashed component identifiers', async () => {
    const root = await createTempRoot();
    await fs.outputFile(
      path.join(root, 'components/ui/chart.axis.tsx'),
      `
import { cva } from "class-variance-authority";
const chartAxisVariants = cva("block", {
  variants: { side: { bottom: "bottom-0" } },
  defaultVariants: { side: "bottom" },
});
export function ChartAxis() { return <div />; }
`
    );
    await fs.outputFile(
      path.join(root, 'components/ui/date-picker.tsx'),
      `
import { cva } from "class-variance-authority";
const datePickerVariants = cva("block", {
  variants: { size: { sm: "text-sm" } },
  defaultVariants: { size: "sm" },
});
export function DatePicker() { return <div />; }
`
    );

    const dotted = await request(app).get('/api/variants/components/chart.axis');
    const dashed = await request(app).get('/api/variants/components/date-picker');

    assert.equal(dotted.status, 200);
    assert.equal(dotted.body.component.name, 'chart.axis');
    assert.equal(dashed.status, 200);
    assert.equal(dashed.body.component.name, 'date-picker');
  });

  it('returns 404 for missing components', async () => {
    await createTempRoot();

    const res = await request(app).get('/api/variants/components/missing');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'COMPONENT_LIBRARY_NOT_FOUND');
  });
});
