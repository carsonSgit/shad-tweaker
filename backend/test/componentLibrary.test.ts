import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs-extra';
import {
  compareComponentLibraryItem,
  detachComponentLibraryItem,
  findComponentLibraryDuplicates,
  forkComponentLibraryItem,
  getComponentLibraryDetail,
  listComponentLibrary,
  renameComponentLibraryItem,
  resetComponentLibraryItem,
} from '../src/services/componentLibrary.js';

const tempRoots: string[] = [];
const originalCwd = process.env.SHADCN_TWEAKER_CWD;
const testWorkspaceBase = path.join(process.cwd(), '.shadcn-tweaker-test-workspaces');

async function createTempRoot(): Promise<string> {
  const root = path.join(testWorkspaceBase, randomUUID());
  tempRoots.push(root);
  await fs.ensureDir(path.join(root, 'components/ui'));
  return root;
}

async function writeComponent(root: string, name: string, content: string): Promise<string> {
  const filePath = path.join(root, 'components/ui', `${name}.tsx`);
  await fs.writeFile(filePath, content);
  return filePath;
}

afterEach(async () => {
  if (originalCwd === undefined) {
    delete process.env.SHADCN_TWEAKER_CWD;
  } else {
    process.env.SHADCN_TWEAKER_CWD = originalCwd;
  }
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

describe('component library service', () => {
  it('lists local component inventory fields', async () => {
    const root = await createTempRoot();
    await writeComponent(
      root,
      'button',
      `import * as Dialog from '@radix-ui/react-dialog';
import { cva } from 'class-variance-authority';

export const buttonVariants = cva('bg-primary text-primary-foreground', {
  variants: { size: { sm: 'h-8', lg: 'h-10' } },
});

export function Button() {
  return <Dialog.Root><button className="border-border">Save</button></Dialog.Root>;
}
`
    );

    const inventory = await listComponentLibrary(root);

    assert.equal(inventory.length, 1);
    assert.equal(inventory[0].name, 'button');
    assert.equal(inventory[0].filePath, 'components/ui/button.tsx');
    assert.equal(inventory[0].primitiveBase, 'radix:dialog');
    assert.equal(inventory[0].variantCount, 1);
    assert.equal(inventory[0].dependencyStatus, 'ok');
    assert.ok(inventory[0].tokenUsage.includes('bg-primary'));
  });

  it('returns an empty inventory for an empty component directory', async () => {
    const root = await createTempRoot();

    const inventory = await listComponentLibrary(root);

    assert.deepEqual(inventory, []);
  });

  it('returns detail by component name or path', async () => {
    const root = await createTempRoot();
    await writeComponent(
      root,
      'card',
      `import { cn } from '@/lib/utils';
export function Card() {
  return <section className={cn('rounded-lg border-border')}>Card</section>;
}
`
    );

    const byName = await getComponentLibraryDetail(root, 'card');
    const byPath = await getComponentLibraryDetail(root, 'components/ui/card.tsx');

    assert.equal(byName.name, 'card');
    assert.equal(byPath.path, 'components/ui/card.tsx');
    assert.ok(byName.exports.includes('Card'));
    assert.match(byName.content, /function Card/);
  });

  it('reports duplicate names, exports, and dependencies', async () => {
    const root = await createTempRoot();
    await writeComponent(
      root,
      'button',
      `import { Slot } from '@radix-ui/react-slot';
export function Control() {
  return <Slot />;
}
`
    );
    await writeComponent(
      root,
      'button-copy',
      `import { Slot } from '@radix-ui/react-slot';
export function Control() {
  return <Slot />;
}
`
    );

    const duplicates = await findComponentLibraryDuplicates(root);

    assert.ok(
      duplicates.some((duplicate) => duplicate.type === 'export' && duplicate.value === 'Control')
    );
    assert.ok(
      duplicates.some(
        (duplicate) => duplicate.type === 'dependency' && duplicate.value === '@radix-ui/react-slot'
      )
    );
    assert.deepEqual(
      duplicates.find((duplicate) => duplicate.value === 'Control')?.suggestedNames,
      ['control-linear', 'control-minimal', 'control-acme']
    );
  });

  it('renames a component file safely', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'badge', `export function Badge() { return <span />; }`);

    const result = await renameComponentLibraryItem(root, 'badge', 'status badge');

    assert.equal(result.previousPath, 'components/ui/badge.tsx');
    assert.equal(result.newPath, 'components/ui/status-badge.tsx');
    assert.equal(await fs.pathExists(path.join(root, 'components/ui/badge.tsx')), false);
    assert.equal(await fs.pathExists(path.join(root, 'components/ui/status-badge.tsx')), true);
  });

  it('forks a component file without changing the original', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'alert', `export function Alert() { return <div />; }`);

    const result = await forkComponentLibraryItem(root, 'alert', 'alert minimal');

    assert.equal(result.newPath, 'components/ui/alert-minimal.tsx');
    assert.equal(await fs.pathExists(path.join(root, 'components/ui/alert.tsx')), true);
    assert.equal(await fs.pathExists(path.join(root, 'components/ui/alert-minimal.tsx')), true);
  });

  it('detaches source metadata from a manifest component', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'toast', `export function Toast() { return <div />; }`);
    await fs.ensureDir(path.join(root, '.shadcn-tweaker'));
    await fs.writeJson(path.join(root, '.shadcn-tweaker/manifest.json'), {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: {
        componentDirectory: './components/ui',
        backupRetentionDays: 30,
        maxBackups: 20,
        autoBackup: true,
        validateAfterEdit: true,
        port: 3001,
      },
      components: [
        {
          id: 'toast',
          name: 'toast',
          path: 'components/ui/toast.tsx',
          source: { originRegistry: 'acme' },
        },
      ],
      sources: [],
      packages: [],
      tokenSets: [],
      presets: [],
      backups: [],
    });

    const result = await detachComponentLibraryItem(root, 'toast');

    assert.equal(result.component.sourceRegistry, undefined);
  });

  it('compares components without source metadata as changed', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'sheet', `export function Sheet() { return <div />; }`);

    const result = await compareComponentLibraryItem(root, 'sheet');

    assert.equal(result.changed, true);
    assert.match(result.diff, /function Sheet/);
  });

  it('rejects reset when no source path is recorded', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'menu', `export function Menu() { return <div />; }`);

    await assert.rejects(resetComponentLibraryItem(root, 'menu'), /reset source path/);
  });
});
