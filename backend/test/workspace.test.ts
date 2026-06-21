import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs-extra';
import { cleanupOldBackups } from '../src/services/backup.js';
import {
  deleteRegistrySource,
  getManifestPath,
  initializeWorkspace,
  listRegistrySources,
  loadWorkspaceManifest,
  recordBackupMetadata,
  recordScannedComponents,
  updateWorkspaceConfig,
  upsertRegistrySource,
} from '../src/services/workspace.js';
import type { Component } from '../src/types/index.js';
import { isSafeProjectRelativePath } from '../src/utils/paths.js';

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
  delete process.env.SHADCN_COMPONENTS_PATH;
});

describe('workspace manifest service', () => {
  it('validates project-relative paths consistently', () => {
    assert.equal(isSafeProjectRelativePath('./components/ui'), true);
    assert.equal(isSafeProjectRelativePath('components/ui'), true);
    assert.equal(isSafeProjectRelativePath('../outside'), false);
    assert.equal(isSafeProjectRelativePath('./../../outside'), false);
    assert.equal(isSafeProjectRelativePath(path.resolve('components/ui')), false);
  });

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

  it('reports whether workspace initialization created the manifest', async () => {
    const root = await createTempRoot();

    const first = await initializeWorkspace(root);
    const second = await initializeWorkspace(root);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.manifest.version, 1);
    assert.equal(second.manifest.version, 1);
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
    const backupFileContent = 'export const Button = () => null;';
    await fs.writeFile(backupFile, backupFileContent);
    await fs.writeJson(path.join(backupDir, 'manifest.json'), backupManifest, { spaces: 2 });

    const manifest = await loadWorkspaceManifest(root);

    assert.equal(manifest.backups.length, 1);
    assert.equal(manifest.backups[0].id, backupManifest.id);
    assert.equal(manifest.backups[0].components[0], backupManifest.files[0].originalPath);
    assert.equal(manifest.backups[0].size, Buffer.byteLength(backupFileContent));
  });

  it('cleans up backups by count and retention days from workspace config', async () => {
    const root = await createTempRoot();
    const previousCwd = process.env.SHADCN_TWEAKER_CWD;
    process.env.SHADCN_TWEAKER_CWD = root;

    try {
      await updateWorkspaceConfig({ maxBackups: 2, backupRetentionDays: 7 }, root);

      const backupBasePath = path.join(root, '.shadcn-tweaker', 'backups');
      const backupAt = (daysAgo: number) => {
        const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
        const id = `backup_${date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)}`;
        return { id, timestamp: date.toISOString() };
      };
      const backups = [backupAt(0), backupAt(1), backupAt(20)];

      for (const backup of backups) {
        const backupDir = path.join(backupBasePath, backup.id);
        const backupFile = path.join(backupDir, 'button.tsx');
        await fs.ensureDir(backupDir);
        await fs.writeFile(backupFile, 'export const Button = () => null;');
        await fs.writeJson(
          path.join(backupDir, 'manifest.json'),
          {
            id: backup.id,
            timestamp: backup.timestamp,
            files: [
              {
                originalPath: path.join(root, 'components', 'ui', 'button.tsx'),
                backupPath: backupFile,
              },
            ],
          },
          { spaces: 2 }
        );
      }

      const deleted = await cleanupOldBackups();

      assert.equal(deleted, 1);
      assert.equal(await fs.pathExists(path.join(backupBasePath, backups[0].id)), true);
      assert.equal(await fs.pathExists(path.join(backupBasePath, backups[1].id)), true);
      assert.equal(await fs.pathExists(path.join(backupBasePath, backups[2].id)), false);
    } finally {
      if (previousCwd === undefined) {
        delete process.env.SHADCN_TWEAKER_CWD;
      } else {
        process.env.SHADCN_TWEAKER_CWD = previousCwd;
      }
    }
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

  it('uses the CLI component path environment override during initialization', async () => {
    const root = await createTempRoot();
    process.env.SHADCN_COMPONENTS_PATH = path.join(root, 'samples/components/ui');

    const { manifest } = await initializeWorkspace(root);

    assert.equal(manifest.config.componentDirectory, 'samples/components/ui');
  });

  it('applies the CLI component path environment override to existing manifests', async () => {
    const root = await createTempRoot();
    await initializeWorkspace(root);
    process.env.SHADCN_COMPONENTS_PATH = path.join(root, 'samples/components/ui');

    const { manifest } = await initializeWorkspace(root);
    const reloaded = await loadWorkspaceManifest(root);

    assert.equal(manifest.config.componentDirectory, 'samples/components/ui');
    assert.equal(reloaded.config.componentDirectory, 'samples/components/ui');
  });

  it('ignores a component path environment override that points outside the workspace', async () => {
    const root = await createTempRoot();
    await initializeWorkspace(root);
    const defaultDir = (await loadWorkspaceManifest(root)).config.componentDirectory;

    process.env.SHADCN_COMPONENTS_PATH = path.join(root, '..', 'outside/components/ui');

    const reloaded = await loadWorkspaceManifest(root);
    assert.equal(reloaded.config.componentDirectory, defaultDir);
  });

  it('keeps the component path environment override out of the persisted manifest', async () => {
    const root = await createTempRoot();
    await initializeWorkspace(root);
    const defaultDir = (await loadWorkspaceManifest(root)).config.componentDirectory;

    process.env.SHADCN_COMPONENTS_PATH = path.join(root, 'samples/components/ui');
    // Apply the override in memory, then trigger a manifest write via an unrelated mutation.
    await loadWorkspaceManifest(root);
    await updateWorkspaceConfig({ maxBackups: 9 }, root);

    const onDisk = await fs.readJson(getManifestPath(root));
    assert.equal(onDisk.config.componentDirectory, defaultDir);
    assert.equal(onDisk.config.maxBackups, 9);

    delete process.env.SHADCN_COMPONENTS_PATH;
    assert.equal((await loadWorkspaceManifest(root)).config.componentDirectory, defaultDir);
  });

  it('preserves manifest config updates after legacy config seeding', async () => {
    const root = await createTempRoot();

    await fs.writeJson(
      path.join(root, '.shadcn-tweaker.json'),
      {
        componentsPath: './legacy/components',
        maxBackups: 7,
      },
      { spaces: 2 }
    );

    const initial = await loadWorkspaceManifest(root);
    const updated = await updateWorkspaceConfig(
      { componentDirectory: './src/components/ui' },
      root
    );
    const reloaded = await loadWorkspaceManifest(root);

    assert.equal(initial.config.componentDirectory, './legacy/components');
    assert.equal(updated.config.componentDirectory, './src/components/ui');
    assert.equal(reloaded.config.componentDirectory, './src/components/ui');
    assert.equal(reloaded.config.maxBackups, 7);
  });

  it('keeps concurrent backup and scan metadata updates', async () => {
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

    await Promise.all([
      recordBackupMetadata(
        {
          id: 'backup_2026-05-03_12-00-00',
          timestamp: '2026-05-03T12:00:00.000Z',
          components: [component.path],
          size: 200,
        },
        root
      ),
      recordScannedComponents([component], root),
    ]);

    const manifest = await loadWorkspaceManifest(root);

    assert.equal(manifest.backups[0].id, 'backup_2026-05-03_12-00-00');
    assert.equal(manifest.components[0].name, 'button');
  });

  it('serializes hydration loads with concurrent metadata writes', async () => {
    const root = await createTempRoot();
    const templatePath = path.join(root, '.shadcn-tweaker', 'templates', 'templates.json');
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

    await fs.ensureDir(path.dirname(templatePath));
    await fs.writeJson(
      templatePath,
      {
        templates: [
          {
            id: 'template_concurrent',
            name: 'Concurrent preset',
            created: '2026-05-03T00:00:00.000Z',
            rules: [{ find: 'rounded-md', replace: 'rounded-lg', isRegex: false }],
          },
        ],
      },
      { spaces: 2 }
    );

    await Promise.all([
      loadWorkspaceManifest(root),
      recordScannedComponents([component], root),
      recordBackupMetadata(
        {
          id: 'backup_2026-05-03_13-00-00',
          timestamp: '2026-05-03T13:00:00.000Z',
          components: [component.path],
          size: 200,
        },
        root
      ),
    ]);

    const manifest = await loadWorkspaceManifest(root);

    assert.equal(manifest.presets.length, 1);
    assert.equal(manifest.presets[0].id, 'template_concurrent');
    assert.equal(manifest.components[0].name, 'button');
    assert.equal(manifest.backups[0].id, 'backup_2026-05-03_13-00-00');
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

  it('merges scanned components with existing manifest inventory', async () => {
    const root = await createTempRoot();
    const button: Component = {
      name: 'button',
      path: path.join(root, 'components', 'ui', 'button.tsx'),
      metadata: {
        lines: 10,
        size: 200,
        lastModified: '2026-05-03T00:00:00.000Z',
        classCount: 3,
      },
    };
    const card: Component = {
      name: 'card',
      path: path.join(root, 'src', 'components', 'card.tsx'),
      metadata: {
        lines: 20,
        size: 300,
        lastModified: '2026-05-03T00:00:00.000Z',
        classCount: 5,
      },
    };

    await recordScannedComponents([button], root);
    await recordScannedComponents([card], root);

    const manifest = await loadWorkspaceManifest(root);

    assert.deepEqual(manifest.components.map((component) => component.name).sort(), [
      'button',
      'card',
    ]);
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

  it('rejects manifest config with unsafe component paths', async () => {
    const root = await createTempRoot();
    const manifestPath = path.join(root, '.shadcn-tweaker', 'manifest.json');

    await fs.ensureDir(path.dirname(manifestPath));
    await fs.writeJson(
      manifestPath,
      {
        version: 1,
        createdAt: '2026-05-03T00:00:00.000Z',
        updatedAt: '2026-05-03T00:00:00.000Z',
        config: {
          componentDirectory: '../outside',
          backupRetentionDays: 30,
          maxBackups: 20,
          autoBackup: true,
          validateAfterEdit: true,
          port: 3001,
        },
        components: [],
        sources: [],
        packages: [],
        tokenSets: [],
        presets: [],
        backups: [],
      },
      { spaces: 2 }
    );

    await assert.rejects(
      () => loadWorkspaceManifest(root),
      /Failed to load workspace manifest: Workspace manifest config has an invalid componentDirectory/
    );
  });

  it('adds, updates, lists, and deletes registry sources', async () => {
    const root = await createTempRoot();

    const createdResult = await upsertRegistrySource(
      {
        name: 'Acme Registry',
        type: 'shadcn-registry',
        registryJsonUrl: 'https://example.com/registry.json',
        enabled: true,
      },
      root
    );
    const updatedResult = await upsertRegistrySource(
      {
        id: createdResult.source.id,
        name: 'Acme Registry',
        type: 'shadcn-registry',
        registryJsonUrl: 'https://example.com/r/registry.json',
        enabled: false,
      },
      root
    );
    const sources = await listRegistrySources(root);
    const deleted = await deleteRegistrySource(createdResult.source.id, root);
    const afterDelete = await listRegistrySources(root);

    assert.equal(createdResult.created, true);
    assert.equal(updatedResult.created, false);
    assert.equal(createdResult.source.id, 'registry_acme-registry');
    assert.equal(updatedResult.source.createdAt, createdResult.source.createdAt);
    assert.notEqual(updatedResult.source.updatedAt, createdResult.source.updatedAt);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].registryJsonUrl, 'https://example.com/r/registry.json');
    assert.equal(sources[0].enabled, false);
    assert.equal(deleted, true);
    assert.deepEqual(afterDelete, []);
  });

  it('defaults registry sources to enabled for direct service callers', async () => {
    const root = await createTempRoot();

    const result = await upsertRegistrySource(
      {
        name: 'Default Enabled Registry',
        type: 'shadcn-registry',
        registryJsonUrl: 'https://example.com/registry.json',
      },
      root
    );

    assert.equal(result.created, true);
    assert.equal(result.source.enabled, true);
  });
});
