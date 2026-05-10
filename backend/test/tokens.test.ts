import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs-extra';
import {
  applyTokenPatch,
  createEmptyTokenMap,
  createFrequencyReport,
  createInconsistencyReport,
  createTokenSet,
  deleteTokenSet,
  extractTokenCandidates,
  getComponentOverrides,
  listTokenSets,
  previewTokenPatch,
  updateTokenSet,
} from '../src/services/tokens.js';
import { loadWorkspaceManifest, recordScannedComponents } from '../src/services/workspace.js';
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

async function writeComponent(
  root: string,
  relativePath: string,
  content: string
): Promise<string> {
  const filePath = path.join(root, relativePath);
  await fs.outputFile(filePath, content);
  const stats = await fs.stat(filePath);
  const component: Component = {
    name: path.basename(relativePath, path.extname(relativePath)),
    path: filePath,
    metadata: {
      lines: content.split('\n').length,
      size: stats.size,
      lastModified: stats.mtime.toISOString(),
    },
  };
  await recordScannedComponents([component], root);
  return filePath;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  delete process.env.SHADCN_TWEAKER_CWD;
});

describe('token service', () => {
  it('creates, updates, lists, and deletes token sets', async () => {
    await createTempRoot();
    const tokens = createEmptyTokenMap();
    tokens.radius.card = {
      name: 'card',
      category: 'radius',
      value: 'rounded-lg',
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    };

    const created = await createTokenSet({ name: 'App Tokens', tokens });
    const updatedTokens = createEmptyTokenMap();
    updatedTokens.spacing.tight = {
      name: 'tight',
      category: 'spacing',
      value: 'gap-2',
      createdAt: created.createdAt,
      updatedAt: created.createdAt,
    };
    const updated = await updateTokenSet(created.id, {
      name: 'App Tokens v2',
      tokens: updatedTokens,
    });
    const listed = await listTokenSets();
    const deleted = await deleteTokenSet(created.id);

    assert.equal(created.id, 'token_set_app-tokens');
    assert.equal(updated?.createdAt, created.createdAt);
    assert.equal(updated?.tokens.spacing.tight.value, 'gap-2');
    assert.equal(listed[0].name, 'App Tokens v2');
    assert.equal(deleted, true);
    assert.deepEqual(await listTokenSets(), []);
  });

  it('normalizes old loose token manifests', async () => {
    const root = await createTempRoot();
    await fs.outputJson(
      path.join(root, '.shadcn-tweaker', 'manifest.json'),
      {
        version: 1,
        createdAt: '2026-05-09T00:00:00.000Z',
        updatedAt: '2026-05-09T00:00:00.000Z',
        config: {
          componentDirectory: './components/ui',
          backupRetentionDays: 30,
          maxBackups: 20,
          autoBackup: true,
          validateAfterEdit: true,
          port: 3001,
        },
        components: [],
        sources: [],
        packages: [],
        tokenSets: [
          {
            id: 'token_set_legacy',
            name: 'Legacy',
            tokens: { brand: '#fff', radius: { sm: 'rounded-sm' } },
            createdAt: '2026-05-09T00:00:00.000Z',
            updatedAt: '2026-05-09T00:00:00.000Z',
          },
        ],
        presets: [],
        backups: [],
      },
      { spaces: 2 }
    );

    const manifest = await loadWorkspaceManifest(root);

    assert.equal(manifest.tokenSets[0].tokens.colors.brand.value, '#fff');
    assert.equal(manifest.tokenSets[0].tokens.radius.sm.value, 'rounded-sm');
  });

  it('extracts token candidates from className, cn, and cva base classes', async () => {
    const root = await createTempRoot();
    const filePath = await writeComponent(
      root,
      'components/ui/button.tsx',
      `
import { cva } from "class-variance-authority";
const styles = cva("rounded-md shadow-sm duration-200", {});
export function Button() {
  return <button className={cn("bg-primary px-4", active && "ring-2")}>Save</button>;
}
`
    );

    const candidates = await extractTokenCandidates([filePath]);
    const values = candidates.map((candidate) => candidate.value).sort();

    assert.deepEqual(values, [
      'bg-primary',
      'duration-200',
      'px-4',
      'ring-2',
      'rounded-md',
      'shadow-sm',
    ]);
  });

  it('reports token frequency across multiple components', async () => {
    const root = await createTempRoot();
    await writeComponent(
      root,
      'components/ui/button.tsx',
      '<button className="rounded-md px-4 bg-primary" />'
    );
    await writeComponent(
      root,
      'components/ui/card.tsx',
      '<div className="rounded-md p-4 bg-card" />'
    );

    const report = await createFrequencyReport();
    const rounded = report.entries.find((entry) => entry.value === 'rounded-md');

    assert.equal(rounded?.occurrences, 2);
    assert.equal(rounded?.componentPaths.length, 2);
    assert.equal(report.totalOccurrences, 6);
  });

  it('flags inconsistencies with stable recommendations', async () => {
    const root = await createTempRoot();
    await writeComponent(
      root,
      'components/ui/a.tsx',
      '<div className="rounded-md p-4 shadow-sm duration-200" />'
    );
    await writeComponent(
      root,
      'components/ui/b.tsx',
      '<div className="rounded-lg p-6 shadow-md duration-300" />'
    );
    await writeComponent(
      root,
      'components/ui/c.tsx',
      '<div className="rounded-md p-6 shadow-sm duration-200" />'
    );

    const report = await createInconsistencyReport();
    const radius = report.entries.find((entry) => entry.family === 'radius');
    const spacing = report.entries.find((entry) => entry.family === 'spacing');

    assert.equal(radius?.recommendedValue, 'rounded-md');
    assert.equal(spacing?.recommendedValue, 'p-6');
  });

  it('previews patches without changing files', async () => {
    const root = await createTempRoot();
    const filePath = await writeComponent(
      root,
      'components/ui/button.tsx',
      '<button className="rounded-md px-4" />'
    );

    const preview = await previewTokenPatch(filePath ? [filePath] : [], [
      { category: 'radius', from: 'rounded-md', to: 'rounded-lg' },
    ]);
    const after = await fs.readFile(filePath, 'utf-8');

    assert.equal(preview.totalChanges, 1);
    assert.match(preview.previews[0].after, /rounded-lg/);
    assert.match(after, /rounded-md/);
  });

  it('applies patches with backups and records overrides only on success', async () => {
    const root = await createTempRoot();
    const filePath = await writeComponent(
      root,
      'components/ui/button.tsx',
      '<button className="rounded-md px-4" />'
    );
    const tokenSet = await createTokenSet({ name: 'Patch Tokens' });

    const result = await applyTokenPatch({
      tokenSetId: tokenSet.id,
      componentPaths: [filePath],
      changes: [{ category: 'radius', from: 'rounded-md', to: 'rounded-lg', tokenName: 'card' }],
      recordOverrides: true,
    });
    const content = await fs.readFile(filePath, 'utf-8');
    const overrides = await getComponentOverrides(filePath);

    assert.equal(result.success, true);
    assert.equal(result.modified.length, 1);
    assert.ok(result.backupId);
    assert.match(content, /rounded-lg/);
    assert.equal(overrides[0].overrides.radius?.card, 'rounded-lg');
  });
});
