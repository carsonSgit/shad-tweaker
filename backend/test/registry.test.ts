import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs-extra';
import {
  getRegistryItem,
  getRegistrySourceHealth,
  listRegistryItems,
} from '../src/services/registry.js';
import { upsertRegistrySource } from '../src/services/workspace.js';

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

describe('registry service', () => {
  it('reports local-folder health issues when path is missing', async () => {
    const root = await createTempRoot();
    await upsertRegistrySource(
      { name: 'Local', type: 'local-folder', baseUrl: './nope', enabled: true },
      root
    );
    const health = await getRegistrySourceHealth(root);
    assert.equal(health.length, 1);
    assert.equal(health[0].status, 'degraded');
  });

  it('returns warnings for enabled sources without registryJsonUrl', async () => {
    const root = await createTempRoot();
    await upsertRegistrySource(
      { name: 'NPM', type: 'npm-package', baseUrl: 'react', enabled: true },
      root
    );
    const result = await listRegistryItems(root);
    assert.equal(result.items.length, 0);
    assert.equal(result.warnings.length, 1);
  });

  it('returns null for missing registry item', async () => {
    const root = await createTempRoot();
    await upsertRegistrySource(
      { name: 'Dead', type: 'shadcn-registry', registryJsonUrl: 'https://example.invalid/nope', enabled: true },
      root
    );
    const sourceId = 'registry_dead';
    const item = await getRegistryItem(sourceId, 'button', root);
    assert.equal(item, null);
  });
});
