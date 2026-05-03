import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs-extra';
import {
  findRegistryItem,
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
  const originalFetch = globalThis.fetch;

  function mockRegistryFetch(items: unknown[]): void {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ items }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

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

  it('does not add listing unsupported noise for disabled npm sources', async () => {
    const root = await createTempRoot();
    await upsertRegistrySource(
      { name: 'NPM', type: 'npm-package', baseUrl: 'react', enabled: false },
      root
    );

    const health = await getRegistrySourceHealth(root);
    assert.equal(health[0].status, 'degraded');
    assert.deepEqual(
      health[0].issues.map((entry) => entry.code),
      ['SOURCE_DISABLED']
    );
  });

  it('returns null for missing registry item', async () => {
    const root = await createTempRoot();
    const { source } = await upsertRegistrySource(
      {
        name: 'Dead',
        type: 'shadcn-registry',
        registryJsonUrl: 'https://example.invalid/nope',
        enabled: true,
      },
      root
    );
    globalThis.fetch = async () => new Response('nope', { status: 404 });
    const item = await getRegistryItem(source.id, 'button', root);
    assert.equal(item, null);
  });

  it('maps registry item files into component packages', async () => {
    const root = await createTempRoot();
    const { source } = await upsertRegistrySource(
      {
        name: 'Registry',
        type: 'shadcn-registry',
        registryJsonUrl: 'https://example.com/registry.json',
        enabled: true,
      },
      root
    );
    mockRegistryFetch([
      {
        name: 'button',
        type: 'component',
        files: [{ path: 'ui/button.tsx' }],
        dependencies: ['react'],
        registryDependencies: ['utils'],
      },
    ]);

    const item = await getRegistryItem(source.id, 'button', root);
    assert.equal(item?.name, 'button');
    assert.equal(item?.type, 'component');
    assert.deepEqual(item?.files, ['ui/button.tsx']);
    assert.deepEqual(item?.dependencies, [{ name: 'react', type: 'package' }]);
    assert.deepEqual(item?.registryDependencies, [{ name: 'utils', type: 'registry' }]);
  });

  it('finds registry items across enabled sources by name', async () => {
    const root = await createTempRoot();
    await upsertRegistrySource(
      {
        name: 'Alpha',
        type: 'shadcn-registry',
        registryJsonUrl: 'https://example.com/a.json',
        enabled: true,
      },
      root
    );
    await upsertRegistrySource(
      {
        name: 'Beta',
        type: 'shadcn-registry',
        registryJsonUrl: 'https://example.com/b.json',
        enabled: true,
      },
      root
    );

    globalThis.fetch = async (input) => {
      const url = input.toString();
      const items = url.endsWith('/b.json') ? [{ name: 'button', type: 'component' }] : [];
      return new Response(JSON.stringify({ items }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const item = await findRegistryItem('button', root);
    assert.equal(item?.name, 'button');
    assert.equal(item?.source?.originRegistry, 'Beta');
  });

  it('rejects unsafe registry item identifiers', async () => {
    const root = await createTempRoot();
    const { source } = await upsertRegistrySource(
      {
        name: 'Registry',
        type: 'shadcn-registry',
        registryJsonUrl: 'https://example.com/registry.json',
        enabled: true,
      },
      root
    );
    mockRegistryFetch([{ name: 'button', type: 'component' }]);

    assert.equal(await getRegistryItem(source.id, '..', root), null);
    assert.equal(await getRegistryItem(source.id, 'button/../../secret', root), null);
    assert.equal(await getRegistryItem(source.id, 'a'.repeat(129), root), null);
    assert.equal(await findRegistryItem('button/../../secret', root), null);
  });

  it('short-circuits fallback item lookup after the first match', async () => {
    const root = await createTempRoot();
    await upsertRegistrySource(
      {
        name: 'Alpha',
        type: 'shadcn-registry',
        registryJsonUrl: 'https://example.com/a.json',
        enabled: true,
      },
      root
    );
    await upsertRegistrySource(
      {
        name: 'Beta',
        type: 'shadcn-registry',
        registryJsonUrl: 'https://example.com/b.json',
        enabled: true,
      },
      root
    );

    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      urls.push(input.toString());
      return new Response(JSON.stringify({ items: [{ name: 'button', type: 'component' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const item = await findRegistryItem('button', root);
    assert.equal(item?.source?.originRegistry, 'Alpha');
    assert.deepEqual(urls, ['https://example.com/a.json']);
  });

  it('returns timeout warnings for unresponsive registry listings', async () => {
    const root = await createTempRoot();
    await upsertRegistrySource(
      {
        name: 'Registry',
        type: 'shadcn-registry',
        registryJsonUrl: 'https://example.com/slow.json',
        enabled: true,
      },
      root
    );

    globalThis.fetch = async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    };

    const result = await listRegistryItems(root);
    assert.equal(result.items.length, 0);
    assert.match(result.warnings[0].message, /Request timed out/);
  });
});
