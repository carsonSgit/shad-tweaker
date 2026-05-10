import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs-extra';
import {
  getVariantComponentDetail,
  listVariantComponents,
  previewVariantGeneration,
  VariantBuilderValidationError,
} from '../src/services/variants.js';

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(process.cwd(), '.shadcn-tweaker-test-workspaces');

async function createTempRoot(): Promise<string> {
  const root = path.join(testWorkspaceBase, randomUUID());
  tempRoots.push(root);
  await fs.ensureDir(path.join(root, 'components/ui'));
  process.env.SHADCN_TWEAKER_CWD = root;
  return root;
}

async function writeComponent(root: string, name: string, content: string): Promise<string> {
  const relativePath = `components/ui/${name}.tsx`;
  await fs.outputFile(path.join(root, relativePath), content);
  return relativePath;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  delete process.env.SHADCN_TWEAKER_CWD;
});

describe('variant builder service', () => {
  it('lists cva and tailwind-variants component summaries', async () => {
    const root = await createTempRoot();
    await writeComponent(
      root,
      'button',
      `
import { cva } from "class-variance-authority";
const buttonVariants = cva("inline-flex", {
  variants: { variant: { default: "bg-primary", outline: "border" } },
  defaultVariants: { variant: "default" },
});
export function Button() { return <button />; }
`
    );
    await writeComponent(
      root,
      'card',
      `
import { tv } from "tailwind-variants";
const card = tv({
  base: "rounded-lg",
  variants: { density: { compact: "p-3", comfortable: "p-6" } },
});
export function Card() { return <section />; }
`
    );

    const summaries = await listVariantComponents(root);

    assert.equal(summaries.length, 2);
    assert.deepEqual(
      summaries.map((summary) => summary.systems[0]).sort(),
      ['cva', 'tv']
    );
    assert.ok(summaries.some((summary) => summary.axes.includes('variant')));
    assert.ok(summaries.some((summary) => summary.axes.includes('density')));
  });

  it('returns cva detail with axes, defaults, and classes', async () => {
    const root = await createTempRoot();
    await writeComponent(
      root,
      'button',
      `
import { cva } from "class-variance-authority";
const buttonVariants = cva("inline-flex", {
  variants: {
    variant: { default: "bg-primary", outline: "border border-input" },
    size: { sm: "h-8 px-3", md: "h-10 px-4" },
  },
  defaultVariants: { variant: "default", size: "md" },
});
export function Button() { return <button />; }
`
    );

    const detail = await getVariantComponentDetail(root, 'button');
    const definition = detail.definitions[0];

    assert.equal(detail.variantCount, 1);
    assert.equal(definition.system, 'cva');
    assert.deepEqual(definition.axes.map((axis) => axis.name), ['variant', 'size']);
    assert.equal(definition.axes[0].defaultValue, 'default');
    assert.deepEqual(definition.axes[0].values[1].classes, ['border', 'border-input']);
  });

  it('detects manual flat and nested variant maps conservatively', async () => {
    const root = await createTempRoot();
    await writeComponent(
      root,
      'badge',
      `
const badgeVariants = {
  solid: "bg-primary text-primary-foreground",
  outline: "border border-input",
};
const panelStyles = {
  tone: {
    neutral: "bg-card",
    brand: "bg-primary",
  },
  density: {
    compact: "p-2",
    roomy: "p-6",
  },
};
export function Badge({ tone }: { tone: "neutral" | "brand" }) {
  return <span className={tone === "brand" ? "bg-primary" : "bg-card"} />;
}
`
    );

    const detail = await getVariantComponentDetail(root, 'badge');

    assert.equal(detail.definitions.length, 2);
    assert.ok(detail.systems.includes('manual'));
    assert.ok(detail.axes.includes('variant'));
    assert.ok(detail.axes.includes('tone'));
    assert.ok(
      detail.diagnostics.some(
        (diagnostic) => diagnostic.code === 'UNSUPPORTED_VARIANT_EXPRESSION'
      )
    );
  });

  it('generates a non-mutating preview for adding a cva value', async () => {
    const root = await createTempRoot();
    const relativePath = await writeComponent(
      root,
      'button',
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
    const absolutePath = path.join(root, relativePath);
    const before = await fs.readFile(absolutePath, 'utf-8');

    const preview = await previewVariantGeneration(root, {
      componentPath: relativePath,
      targetDefinition: 'buttonVariants',
      operation: {
        type: 'add-value',
        axisName: 'variant',
        value: { name: 'ghost', classes: ['bg-transparent', 'hover:bg-accent'] },
      },
    });
    const after = await fs.readFile(absolutePath, 'utf-8');

    assert.match(preview.after, /ghost: 'bg-transparent hover:bg-accent'/);
    assert.match(preview.diff, /ghost/);
    assert.equal(after, before);
  });

  it('rejects duplicate preview values before generating output', async () => {
    const root = await createTempRoot();
    const relativePath = await writeComponent(
      root,
      'button',
      `
import { cva } from "class-variance-authority";
const buttonVariants = cva("inline-flex", {
  variants: { variant: { default: "bg-primary" } },
});
export function Button() { return <button />; }
`
    );

    await assert.rejects(
      previewVariantGeneration(root, {
        componentPath: relativePath,
        targetDefinition: 'buttonVariants',
        operation: {
          type: 'add-value',
          axisName: 'variant',
          value: { name: 'default', classes: ['bg-card'] },
        },
      }),
      VariantBuilderValidationError
    );
  });
});
