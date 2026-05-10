import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
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
const testWorkspaceBase = path.join(
  process.cwd(),
  '.shadcn-tweaker-test-workspaces',
  'component-library-service'
);

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

after(async () => {
  await fs.remove(testWorkspaceBase);
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
    assert.equal(inventory[0].path, 'components/ui/button.tsx');
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

  it('rejects traversal-shaped component identifiers', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'card', `export function Card() { return <section />; }`);

    await assert.rejects(
      getComponentLibraryDetail(root, '../card.tsx'),
      /identifier must stay inside/
    );
  });

  it('excludes path aliases and shared utilities from dependencies', async () => {
    const root = await createTempRoot();
    await writeComponent(
      root,
      'input',
      `import path from 'node:path';
import { cn } from '@/lib/utils';
import { helper } from '~/components/helper';
import * as Dialog from '@radix-ui/react-dialog';
import { cva } from 'class-variance-authority';
export function Input() { return <Dialog.Root />; }
`
    );

    const detail = await getComponentLibraryDetail(root, 'input');

    assert.deepEqual(
      detail.dependencies.map((dependency) => dependency.name),
      ['@radix-ui/react-dialog']
    );
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

  it('rejects rename conflicts without moving the original file', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'badge', `export function Badge() { return <span />; }`);
    await writeComponent(
      root,
      'status-badge',
      `export function StatusBadge() { return <span />; }`
    );

    await assert.rejects(
      renameComponentLibraryItem(root, 'badge', 'status badge'),
      /already exists/
    );
    assert.equal(await fs.pathExists(path.join(root, 'components/ui/badge.tsx')), true);
  });

  it('forks a component file without changing the original', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'alert', `export function Alert() { return <div />; }`);

    const result = await forkComponentLibraryItem(root, 'alert', 'alert minimal');

    assert.equal(result.newPath, 'components/ui/alert-minimal.tsx');
    assert.equal(await fs.pathExists(path.join(root, 'components/ui/alert.tsx')), true);
    assert.equal(await fs.pathExists(path.join(root, 'components/ui/alert-minimal.tsx')), true);
  });

  it('registers forked components with source metadata when the original is manifest-owned', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'alert', `export function Alert() { return <div />; }`);
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
          id: 'alert',
          name: 'alert',
          path: 'components/ui/alert.tsx',
          source: { originRegistry: 'acme', localComponentName: 'alert' },
        },
      ],
      sources: [],
      packages: [],
      tokenSets: [],
      presets: [],
      backups: [],
    });

    await forkComponentLibraryItem(root, 'alert', 'alert minimal');
    const forked = await getComponentLibraryDetail(root, 'alert-minimal');

    assert.equal(forked.sourceRegistry, 'acme');
    assert.equal(forked.localComponentName, 'alert-minimal');
  });

  it('rejects fork conflicts', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'alert', `export function Alert() { return <div />; }`);
    await writeComponent(
      root,
      'alert-minimal',
      `export function AlertMinimal() { return <div />; }`
    );

    await assert.rejects(
      forkComponentLibraryItem(root, 'alert', 'alert minimal'),
      /already exists/
    );
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

  it('allows detach when a component has no manifest entry', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'toast', `export function Toast() { return <div />; }`);

    const result = await detachComponentLibraryItem(root, 'toast');

    assert.equal(result.component.name, 'toast');
    assert.equal(result.component.sourceRegistry, undefined);
  });

  it('compares components without source metadata as changed', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'sheet', `export function Sheet() { return <div />; }`);

    const result = await compareComponentLibraryItem(root, 'sheet');

    assert.equal(result.changed, true);
    assert.match(result.diff, /function Sheet/);
  });

  it('returns an empty diff for identical source-backed components', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'sheet', `export function Sheet() { return <div />; }`);
    await fs.ensureDir(path.join(root, 'registry'));
    await fs.writeFile(
      path.join(root, 'registry/sheet.tsx'),
      `export function Sheet() { return <div />; }`
    );
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
          id: 'sheet',
          name: 'sheet',
          path: 'components/ui/sheet.tsx',
          source: { originalPackageName: 'registry/sheet.tsx' },
        },
      ],
      sources: [],
      packages: [],
      tokenSets: [],
      presets: [],
      backups: [],
    });

    const result = await compareComponentLibraryItem(root, 'sheet');

    assert.equal(result.changed, false);
    assert.equal(result.diff, '');
  });

  it('rejects reset when no source path is recorded', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'menu', `export function Menu() { return <div />; }`);

    await assert.rejects(resetComponentLibraryItem(root, 'menu'), /reset source path/);
  });

  it('keeps acronym runs together when normalizing names', async () => {
    const root = await createTempRoot();
    await writeComponent(root, 'button', `export function Button() { return <button />; }`);

    const result = await renameComponentLibraryItem(root, 'button', 'HTMLButton');

    assert.equal(result.newPath, 'components/ui/html-button.tsx');
  });
});
