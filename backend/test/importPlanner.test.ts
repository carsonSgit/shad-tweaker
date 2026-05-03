import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs-extra';
import { applyImportPlan, generateImportPlan } from '../src/services/importPlanner.js';
import { upsertRegistrySource } from '../src/services/workspace.js';
import type { ImportPlan } from '../src/types/index.js';

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(process.cwd(), '.shadcn-tweaker-test-workspaces');

async function createTempRoot(): Promise<string> {
  const root = path.join(testWorkspaceBase, randomUUID());
  tempRoots.push(root);
  await fs.ensureDir(root);
  await fs.writeJson(path.join(root, 'package.json'), {
    dependencies: { react: '^19.0.0' },
    devDependencies: { typescript: '^5.0.0' },
  });
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  delete process.env.SHADCN_TWEAKER_CWD;
});

describe('import planner service', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function addRegistry(root: string, items: unknown[]): Promise<string> {
    const { source } = await upsertRegistrySource(
      {
        name: 'Registry',
        type: 'shadcn-registry',
        registryJsonUrl: 'https://example.com/registry.json',
        enabled: true,
      },
      root
    );

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ items }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    return source.id;
  }

  it('generates files, dependency deltas, registry dependencies, aliases, and conflicts', async () => {
    const root = await createTempRoot();
    const sourceId = await addRegistry(root, [
      {
        name: 'button',
        type: 'component',
        files: [
          {
            path: 'ui/button.tsx',
            content: "import { cn } from '@/lib/utils';\nexport function Button() {}\n",
          },
        ],
        dependencies: ['react', 'lucide-react'],
        devDependencies: ['vitest'],
        registryDependencies: ['utils'],
      },
      {
        name: 'utils',
        type: 'utility',
        files: [
          {
            path: 'lib/utils.ts',
            content: 'export function cn() {}\n',
          },
        ],
        dependencies: ['clsx'],
      },
    ]);
    const existingButton = path.join(root, 'components', 'ui', 'button.tsx');
    await fs.outputFile(existingButton, 'existing button');

    const plan = await generateImportPlan({ sourceId, itemName: 'button' }, root);

    assert.equal(plan.filesToAdd.length, 1);
    assert.equal(plan.filesToOverwrite.length, 1);
    assert.deepEqual(plan.dependencies, ['clsx', 'lucide-react']);
    assert.deepEqual(plan.devDependencies, ['vitest']);
    assert.deepEqual(plan.registryDependencies, ['utils']);
    assert.deepEqual(plan.aliasesNeeded, ['@/lib']);
    assert.equal(
      plan.conflicts.some((conflict) => conflict.type === 'file-exists'),
      true
    );
    assert.equal('backupPaths' in plan, false);
  });

  it('does not report aliases that are configured in tsconfig paths', async () => {
    const root = await createTempRoot();
    await fs.writeJson(path.join(root, 'tsconfig.json'), {
      compilerOptions: {
        paths: {
          '@/*': ['./src/*'],
        },
      },
    });
    const sourceId = await addRegistry(root, [
      {
        name: 'button',
        files: [
          {
            path: 'ui/button.tsx',
            content: "import { cn } from '@/lib/utils';\nexport function Button() {}\n",
          },
        ],
      },
    ]);

    const plan = await generateImportPlan({ sourceId, itemName: 'button' }, root);

    assert.deepEqual(plan.aliasesNeeded, []);
  });

  it('reports unsafe paths and missing content before import', async () => {
    const root = await createTempRoot();
    const sourceId = await addRegistry(root, [
      {
        name: 'unsafe',
        files: [{ path: '../secret.tsx', content: 'nope' }, { path: 'ui/empty.tsx' }],
      },
    ]);

    const plan = await generateImportPlan({ sourceId, itemName: 'unsafe' }, root);

    assert.deepEqual(plan.conflicts.map((conflict) => conflict.type).sort(), [
      'missing-content',
      'unsafe-path',
    ]);
    assert.equal(plan.filesToAdd.length, 0);
  });

  it('applies approved plans, creates backups, and supports skip and rename decisions', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;
    const sourceId = await addRegistry(root, [
      {
        name: 'button',
        files: [
          { path: 'ui/button.tsx', content: 'new button' },
          { path: 'ui/card.tsx', content: 'new card' },
          { path: 'ui/dialog.tsx', content: 'new dialog' },
        ],
      },
    ]);
    const existingButton = path.join(root, 'components', 'ui', 'button.tsx');
    const existingDialog = path.join(root, 'components', 'ui', 'dialog.tsx');
    await fs.outputFile(existingButton, 'old button');
    await fs.outputFile(existingDialog, 'old dialog');

    const plan = await generateImportPlan({ sourceId, itemName: 'button' }, root);
    const result = await applyImportPlan(
      {
        plan,
        resolutions: [
          { path: existingButton, action: 'rename', targetPath: 'components/ui/button-new.tsx' },
          { path: existingDialog, action: 'skip' },
        ],
      },
      root
    );

    assert.equal(result.success, true);
    assert.equal(typeof result.backupId, 'string');
    assert.equal(await fs.pathExists(existingButton), false);
    assert.equal(await fs.readFile(existingDialog, 'utf-8'), 'old dialog');
    assert.deepEqual(result.skipped, [existingDialog]);
    assert.equal(
      await fs.readFile(path.join(root, 'components', 'ui', 'button-new.tsx'), 'utf-8'),
      'new button'
    );
    assert.equal(
      await fs.readFile(path.join(root, 'components', 'ui', 'card.tsx'), 'utf-8'),
      'new card'
    );
  });

  it('rolls back overwritten files when apply fails', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;
    const existingButton = path.join(root, 'components', 'ui', 'button.tsx');
    await fs.outputFile(existingButton, 'old button');

    const plan: ImportPlan = {
      id: 'manual',
      itemName: 'button',
      filesToAdd: [],
      filesToOverwrite: [
        { sourcePath: 'ui/button.tsx', targetPath: existingButton, content: 'new button' },
        {
          sourcePath: 'ui/bad.tsx',
          targetPath: path.resolve(root, '..', 'bad.tsx'),
          content: 'bad',
        },
      ],
      dependencies: [],
      devDependencies: [],
      registryDependencies: [],
      aliasesNeeded: [],
      conflicts: [],
    };

    await assert.rejects(
      () => applyImportPlan({ plan }, root),
      /Refusing to write outside project.*Rolled back/
    );
    assert.equal(await fs.readFile(existingButton, 'utf-8'), 'old button');
  });

  it('overwrites by default and forks when requested', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_TWEAKER_CWD = root;
    const existingButton = path.join(root, 'components', 'ui', 'button.tsx');
    const existingCard = path.join(root, 'components', 'ui', 'card.tsx');
    await fs.outputFile(existingButton, 'old button');
    await fs.outputFile(existingCard, 'old card');

    const plan: ImportPlan = {
      id: 'manual',
      itemName: 'button',
      filesToAdd: [],
      filesToOverwrite: [
        { sourcePath: 'ui/button.tsx', targetPath: existingButton, content: 'new button' },
        { sourcePath: 'ui/card.tsx', targetPath: existingCard, content: 'new card' },
      ],
      dependencies: [],
      devDependencies: [],
      registryDependencies: [],
      aliasesNeeded: [],
      conflicts: [],
    };

    const result = await applyImportPlan(
      {
        plan,
        resolutions: [
          { path: existingCard, action: 'fork', targetPath: 'components/ui/card-copy.tsx' },
        ],
      },
      root
    );

    assert.equal(await fs.readFile(existingButton, 'utf-8'), 'new button');
    assert.equal(await fs.readFile(existingCard, 'utf-8'), 'old card');
    assert.equal(
      await fs.readFile(path.join(root, 'components', 'ui', 'card-copy.tsx'), 'utf-8'),
      'new card'
    );
    assert.deepEqual(result.overwritten, [existingButton]);
  });
});
