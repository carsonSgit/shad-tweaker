import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs-extra';
import { findComponentDirectory } from '../src/services/scanner.js';

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(
  process.cwd(),
  '.shadcn-tweaker-test-workspaces',
  'scanner-service'
);

async function createTempRoot(): Promise<string> {
  const root = path.join(testWorkspaceBase, randomUUID());
  tempRoots.push(root);
  await fs.ensureDir(root);
  return root;
}

afterEach(async () => {
  delete process.env.SHADCN_COMPONENTS_PATH;
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

describe('findComponentDirectory', () => {
  it('falls back to the bundled samples/components/ui set when nothing else is configured', async () => {
    const root = await createTempRoot();
    const samples = path.join(root, 'samples/components/ui');
    await fs.ensureDir(samples);
    await fs.writeFile(path.join(samples, 'button.tsx'), 'export const Button = () => null;');

    assert.equal(await findComponentDirectory(root), samples);
  });

  it('prefers a standard project directory over the samples fallback', async () => {
    const root = await createTempRoot();
    await fs.ensureDir(path.join(root, 'components/ui'));
    await fs.ensureDir(path.join(root, 'samples/components/ui'));

    assert.equal(await findComponentDirectory(root), path.join(root, 'components/ui'));
  });
});
