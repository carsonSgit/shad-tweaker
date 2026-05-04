import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs-extra';
import {
  applyPrimitiveStarter,
  generatePrimitiveStarter,
} from '../src/services/primitiveStarters.js';

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(process.cwd(), '.shadcn-tweaker-test-workspaces');

async function createTempRoot(): Promise<string> {
  const root = path.join(testWorkspaceBase, randomUUID());
  tempRoots.push(root);
  await fs.ensureDir(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

describe('primitive starter service', () => {
  it('generates a blank wrapper with cn support', async () => {
    const root = await createTempRoot();

    const result = await generatePrimitiveStarter(
      { provider: 'blank', componentName: 'Empty State' },
      root
    );

    assert.equal(result.componentName, 'EmptyState');
    assert.equal(result.files.length, 1);
    assert.match(result.files[0].path, /empty-state\.tsx$/);
    assert.match(result.files[0].content, /import \{ cn \} from '@\/lib\/utils';/);
    assert.match(result.files[0].content, /data-slot="empty-state"/);
  });

  it('generates a Radix dialog wrapper with primitive parts', async () => {
    const root = await createTempRoot();

    const result = await generatePrimitiveStarter(
      { provider: 'radix', templateId: 'radix-dialog' },
      root
    );

    assert.match(result.files[0].content, /@radix-ui\/react-dialog/);
    assert.match(result.files[0].content, /DialogPrimitive\.Overlay/);
    assert.match(result.files[0].content, /DialogContent/);
    assert.match(result.files[0].content, /sr-only">Close/);
  });

  it('generates a Base UI dialog wrapper with primitive parts', async () => {
    const root = await createTempRoot();

    const result = await generatePrimitiveStarter({ provider: 'base-ui' }, root);

    assert.match(result.files[0].content, /@base-ui-components\/react\/dialog/);
    assert.match(result.files[0].content, /Dialog\.Backdrop/);
    assert.match(result.files[0].content, /DialogPopup/);
    assert.match(result.files[0].content, /sr-only">Close/);
  });

  it('adds CVA variant scaffolding only when requested', async () => {
    const root = await createTempRoot();

    const plain = await generatePrimitiveStarter({ provider: 'blank' }, root);
    const withCva = await generatePrimitiveStarter({ provider: 'blank', includeCva: true }, root);

    assert.doesNotMatch(plain.files[0].content, /class-variance-authority/);
    assert.match(withCva.files[0].content, /class-variance-authority/);
    assert.match(withCva.files[0].content, /VariantProps/);
  });

  it('rejects unsafe target paths', async () => {
    const root = await createTempRoot();

    await assert.rejects(
      generatePrimitiveStarter({ provider: 'blank', targetPath: '../escape.tsx' }, root),
      /targetPath/
    );
  });

  it('reports conflicts and refuses apply without overwrite', async () => {
    const root = await createTempRoot();
    const target = path.join(root, 'components', 'ui', 'dialog.tsx');
    await fs.outputFile(target, 'existing');

    const preview = await generatePrimitiveStarter(
      { provider: 'blank', componentName: 'Dialog' },
      root
    );
    assert.deepEqual(preview.conflicts, [target]);

    await assert.rejects(
      applyPrimitiveStarter({ provider: 'blank', componentName: 'Dialog' }, root),
      /already exists/
    );
  });

  it('overwrites an existing target when requested', async () => {
    const root = await createTempRoot();
    const target = path.join(root, 'components', 'ui', 'dialog.tsx');
    await fs.outputFile(target, 'existing');

    const result = await applyPrimitiveStarter(
      { provider: 'blank', componentName: 'Dialog', overwrite: true },
      root
    );

    assert.deepEqual(result.written, [target]);
    assert.match(await fs.readFile(target, 'utf-8'), /export function Dialog/);
    assert.doesNotMatch(await fs.readFile(target, 'utf-8'), /existing/);
  });
});
