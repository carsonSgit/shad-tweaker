import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs-extra';
import {
  buildRegistryItem,
  generateRegistry,
  getPublishInstructions,
  RegistryPublishValidationError,
  validateRegistry,
} from '../src/services/registryPublisher.js';

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(
  process.cwd(),
  '.shadcn-tweaker-test-workspaces',
  'registry-publisher'
);

async function createTempRoot(): Promise<string> {
  const root = path.join(testWorkspaceBase, randomUUID());
  tempRoots.push(root);
  await fs.ensureDir(path.join(root, 'components/ui'));
  process.env.SHADCN_TWEAKER_CWD = root;
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  delete process.env.SHADCN_TWEAKER_CWD;
});

const BUTTON = `import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Badge } from './badge';

export function Button() {
  return <button className={cn('rounded-md px-4 py-2')}><Badge /></button>;
}
`;

const BADGE = `import { cn } from '@/lib/utils';

export function Badge() {
  return <span className={cn('rounded-full px-2')}>Badge</span>;
}
`;

describe('buildRegistryItem', () => {
  it('derives npm and registry dependencies from imports', () => {
    const item = buildRegistryItem({
      name: 'button',
      content: BUTTON,
      knownComponentNames: new Set(['button', 'badge']),
    });

    assert.equal(item.name, 'button');
    assert.equal(item.type, 'registry:ui');
    assert.equal(item.title, 'Button');
    assert.deepEqual(item.dependencies, ['@radix-ui/react-slot', 'class-variance-authority']);
    assert.deepEqual(item.registryDependencies, ['badge', 'utils']);
    assert.equal(item.files.length, 1);
    assert.equal(item.files[0].path, 'registry/default/ui/button.tsx');
    assert.equal(item.files[0].content, BUTTON);
  });
});

describe('generateRegistry', () => {
  it('writes registry.json, item files, and publish instructions', async () => {
    const root = await createTempRoot();
    await fs.outputFile(path.join(root, 'components/ui/button.tsx'), BUTTON);
    await fs.outputFile(path.join(root, 'components/ui/badge.tsx'), BADGE);

    const result = await generateRegistry({ name: 'acme-ui', homepage: 'https://acme.dev' });

    assert.equal(result.itemCount, 2);
    assert.equal(result.registry.name, 'acme-ui');

    const registryJson = await fs.readJson(path.join(result.outputDir, 'registry.json'));
    assert.equal(registryJson.$schema, 'https://ui.shadcn.com/schema/registry.json');
    assert.equal(registryJson.items.length, 2);
    // The index lists files without inlined content.
    assert.equal(registryJson.items[0].files[0].content, undefined);

    const itemJson = await fs.readJson(path.join(result.outputDir, 'r', 'button.json'));
    assert.equal(itemJson.$schema, 'https://ui.shadcn.com/schema/registry-item.json');
    assert.equal(itemJson.files[0].content, BUTTON);
    assert.deepEqual(itemJson.registryDependencies, ['badge', 'utils']);

    assert.ok(await fs.pathExists(path.join(result.outputDir, 'PUBLISHING.md')));
  });

  it('rejects invalid registry names and empty libraries', async () => {
    await createTempRoot();
    await assert.rejects(generateRegistry({ name: 'Not Valid!' }), RegistryPublishValidationError);
    await assert.rejects(generateRegistry(), RegistryPublishValidationError);
  });
});

describe('validateRegistry', () => {
  it('accepts a freshly generated registry', async () => {
    const root = await createTempRoot();
    await fs.outputFile(path.join(root, 'components/ui/button.tsx'), BUTTON);
    await fs.outputFile(path.join(root, 'components/ui/badge.tsx'), BADGE);
    await generateRegistry();

    const validation = await validateRegistry();
    assert.equal(validation.valid, true, validation.errors.join('; '));
    assert.equal(validation.itemCount, 2);
    assert.deepEqual(validation.errors, []);
  });

  it('reports a missing registry', async () => {
    await createTempRoot();
    const validation = await validateRegistry();
    assert.equal(validation.valid, false);
    assert.match(validation.errors[0], /not been generated/);
  });

  it('detects missing item files', async () => {
    const root = await createTempRoot();
    await fs.outputFile(path.join(root, 'components/ui/button.tsx'), BUTTON);
    const result = await generateRegistry();
    await fs.remove(path.join(result.outputDir, 'r', 'button.json'));

    const validation = await validateRegistry();
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((error) => error.includes('r/button.json')));
  });
});

describe('publish instructions', () => {
  it('explains serving and installing from the registry', () => {
    const instructions = getPublishInstructions();
    assert.ok(instructions.includes('registry.json'));
    assert.ok(instructions.includes('npx shadcn@latest add'));
  });
});
