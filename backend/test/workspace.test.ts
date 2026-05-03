import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import {
  loadWorkspaceManifest,
  recordBackupMetadata,
  recordScannedComponents,
  updateWorkspaceConfig,
} from '../src/services/workspace.js';
import type { Component } from '../src/types/index.js';

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = path.join(os.tmpdir(), `shadcn-tweaker-workspace-${randomUUID()}`);
  tempRoots.push(root);
  await fs.ensureDir(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

describe('workspace manifest service', () => {
  it('creates a fresh v1 manifest when none exists', async () => {
    const root = await createTempRoot();

    const manifest = await loadWorkspaceManifest(root);

    assert.equal(manifest.version, 1);
    assert.equal(manifest.config.componentDirectory, './components/ui');
    assert.equal(manifest.config.maxBackups, 20);
    assert.deepEqual(manifest.components, []);
    assert.deepEqual(manifest.presets, []);
    assert.equal(await fs.pathExists(path.join(root, '.shadcn-tweaker', 'manifest.json')), true);
  });

  it('merges legacy config values without rewriting the legacy file', async () => {
    const root = await createTempRoot();
    const legacyPath = path.join(root, '.shadcn-tweaker.json');
    const legacyConfig = {
      componentsPath: './src/components/ui',
      maxBackups: 7,
    };

    await fs.writeJson(legacyPath, legacyConfig, { spaces: 2 });

    const manifest = await loadWorkspaceManifest(root);
    const legacyAfterLoad = await fs.readJson(legacyPath);

    assert.equal(manifest.config.componentDirectory, './src/components/ui');
    assert.equal(manifest.config.maxBackups, 7);
    assert.deepEqual(legacyAfterLoad, legacyConfig);
  });

  it('migrates legacy templates into presets and preserves template storage', async () => {
    const root = await createTempRoot();
    const templatePath = path.join(root, '.shadcn-tweaker', 'templates', 'templates.json');
    const templateStore = {
      templates: [
        {
          id: 'template_1234abcd',
          name: 'Radius bump',
          created: '2026-05-03T00:00:00.000Z',
          rules: [{ find: 'rounded-md', replace: 'rounded-lg', isRegex: false }],
        },
      ],
    };

    await fs.ensureDir(path.dirname(templatePath));
    await fs.writeJson(templatePath, templateStore, { spaces: 2 });

    const firstLoad = await loadWorkspaceManifest(root);
    const secondLoad = await loadWorkspaceManifest(root);
    const templateAfterLoad = await fs.readJson(templatePath);

    assert.equal(firstLoad.presets.length, 1);
    assert.equal(firstLoad.presets[0].migratedFromTemplateId, 'template_1234abcd');
    assert.deepEqual(firstLoad.presets[0].classTransforms, templateStore.templates[0].rules);
    assert.equal(secondLoad.presets.length, 1);
    assert.deepEqual(templateAfterLoad, templateStore);
  });

  it('derives backup metadata from existing backup manifests', async () => {
    const root = await createTempRoot();
    const backupDir = path.join(root, '.shadcn-tweaker', 'backups', 'backup_2026-05-03_11-00-00');
    const backupFile = path.join(backupDir, 'button.tsx');
    const backupManifest = {
      id: 'backup_2026-05-03_11-00-00',
      timestamp: '2026-05-03T11:00:00.000Z',
      files: [
        {
          originalPath: path.join(root, 'components', 'ui', 'button.tsx'),
          backupPath: backupFile,
        },
      ],
    };

    await fs.ensureDir(backupDir);
    await fs.writeFile(backupFile, 'export const Button = () => null;');
    await fs.writeJson(path.join(backupDir, 'manifest.json'), backupManifest, { spaces: 2 });

    const manifest = await loadWorkspaceManifest(root);

    assert.equal(manifest.backups.length, 1);
    assert.equal(manifest.backups[0].id, backupManifest.id);
    assert.equal(manifest.backups[0].components[0], backupManifest.files[0].originalPath);
    assert.equal(manifest.backups[0].size, 33);
  });

  it('updates manifest-owned config values', async () => {
    const root = await createTempRoot();

    const manifest = await updateWorkspaceConfig(
      {
        maxBackups: 5,
        autoBackup: false,
        componentDirectory: './src/components/ui',
      },
      root
    );

    assert.equal(manifest.config.maxBackups, 5);
    assert.equal(manifest.config.autoBackup, false);
    assert.equal(manifest.config.componentDirectory, './src/components/ui');
  });

  it('records backup and scanned component metadata', async () => {
    const root = await createTempRoot();
    const component: Component = {
      name: 'button',
      path: path.join(root, 'components', 'ui', 'button.tsx'),
      metadata: {
        lines: 10,
        size: 200,
        lastModified: '2026-05-03T00:00:00.000Z',
        classCount: 3,
      },
    };

    await recordBackupMetadata(
      {
        id: 'backup_2026-05-03_12-00-00',
        timestamp: '2026-05-03T12:00:00.000Z',
        components: [component.path],
        size: 200,
      },
      root
    );
    await recordScannedComponents([component], root);

    const manifest = await loadWorkspaceManifest(root);

    assert.equal(manifest.backups[0].id, 'backup_2026-05-03_12-00-00');
    assert.equal(manifest.components[0].name, 'button');
    assert.deepEqual(manifest.components[0].metadata, component.metadata);
  });

  it('rejects malformed manifest JSON with a useful error', async () => {
    const root = await createTempRoot();
    const manifestPath = path.join(root, '.shadcn-tweaker', 'manifest.json');

    await fs.ensureDir(path.dirname(manifestPath));
    await fs.writeJson(manifestPath, { version: 999 }, { spaces: 2 });

    await assert.rejects(
      () => loadWorkspaceManifest(root),
      /Failed to load workspace manifest: Unsupported workspace manifest version/
    );
  });
});
