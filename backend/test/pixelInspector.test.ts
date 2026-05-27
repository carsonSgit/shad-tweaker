import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs-extra';
import { analyzePixelInspector, buildPixelInspectorPatch } from '../src/services/pixelInspector.js';
import { recordScannedComponents } from '../src/services/workspace.js';
import type { Component } from '../src/types/index.js';

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(process.cwd(), '.shadcn-tweaker-test-workspaces');

async function createTempRoot(): Promise<string> {
  const root = path.join(testWorkspaceBase, randomUUID());
  tempRoots.push(root);
  await fs.ensureDir(root);
  process.env.SHADCN_TWEAKER_CWD = root;
  return root;
}

async function writeComponent(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.outputFile(filePath, content);
  const stats = await fs.stat(filePath);
  const component: Component = {
    name: path.basename(relativePath, path.extname(relativePath)),
    path: relativePath,
    metadata: {
      lines: content.split('\n').length,
      size: stats.size,
      lastModified: stats.mtime.toISOString(),
    },
  };
  await recordScannedComponents([component], root);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  delete process.env.SHADCN_TWEAKER_CWD;
});

describe('pixel inspector service', () => {
  it('groups editable classes by pixel inspector control family', async () => {
    const root = await createTempRoot();
    await writeComponent(
      root,
      'components/ui/button.tsx',
      `import { cva } from 'class-variance-authority';
const buttonVariants = cva('rounded-md px-4 py-2 gap-2 h-10 w-full border border-input bg-background text-foreground shadow-sm ring-offset-background text-sm font-medium tracking-wide transition duration-200 ease-out transform hover:scale-105', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground',
    },
  },
});
export function Button() {
  return <button className="border-2 border-red-500 p-4">Click</button>;
}`
    );

    const analysis = await analyzePixelInspector('components/ui/button.tsx');
    const groups = new Set(analysis.candidates.map((candidate) => candidate.group));

    assert.equal(analysis.componentPath, 'components/ui/button.tsx');
    assert.deepEqual([...groups].sort(), [
      'background',
      'borderColor',
      'borderWidth',
      'duration',
      'easing',
      'fontSize',
      'fontWeight',
      'foreground',
      'gap',
      'height',
      'letterSpacing',
      'padding',
      'radius',
      'ring',
      'shadow',
      'transform',
      'width',
    ]);
    assert.ok(analysis.rawClasses.includes('hover:scale-105'));
  });

  it('builds exact class replacement patches without matching substrings', () => {
    const patch = buildPixelInspectorPatch({
      componentPath: 'components/ui/button.tsx',
      targetClasses: ['p-2'],
      replacementClasses: ['p-4'],
      rawClassName: 'p-4',
      saveMode: 'component-patch',
    });

    const content = `className="p-2 p-20 hover:p-2"`;
    assert.equal(patch.apply(content).content, `className="p-4 p-20 hover:p-2"`);
    assert.equal(patch.apply(content).changes, 1);
  });

  it('accepts absolute component paths inside the workspace', async () => {
    const root = await createTempRoot();
    await writeComponent(
      root,
      'components/ui/badge.tsx',
      `export function Badge() {
  return <span className="rounded-full px-3 text-xs shadow-sm">Badge</span>;
}`
    );

    const analysis = await analyzePixelInspector(path.join(root, 'components/ui/badge.tsx'));

    assert.equal(analysis.componentPath, 'components/ui/badge.tsx');
    assert.ok(analysis.candidates.some((candidate) => candidate.group === 'radius'));
  });
});
