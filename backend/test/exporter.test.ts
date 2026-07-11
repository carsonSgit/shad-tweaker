import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs-extra';
import request from 'supertest';
import { app } from '../src/server.js';
import { ExportValidationError, exportComponents } from '../src/services/exporter.js';

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(process.cwd(), '.shadcn-tweaker-test-workspaces', 'exporter');

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

const BUTTON = `import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';

export function Button() {
  return <button className={cn('rounded-md px-4')}>Go</button>;
}
`;

const CARD = `import { cn } from '@/lib/utils';

export function Card() {
  return <div className={cn('rounded-lg border p-4')}>Card</div>;
}
`;

async function seedComponents(root: string): Promise<string[]> {
  await fs.outputFile(path.join(root, 'components/ui/button.tsx'), BUTTON);
  await fs.outputFile(path.join(root, 'components/ui/card.tsx'), CARD);
  return ['components/ui/button.tsx', 'components/ui/card.tsx'];
}

describe('exportComponents', () => {
  it('exports a reusable local folder with tokens, deps, and docs', async () => {
    const root = await createTempRoot();
    const componentPaths = await seedComponents(root);

    const result = await exportComponents({ componentPaths, target: 'folder' });

    assert.equal(result.validation.valid, true, result.validation.errors.join('; '));
    assert.deepEqual(result.dependencies, ['@radix-ui/react-slot']);
    assert.ok(result.files.includes('components/ui/button.tsx'));
    assert.ok(result.files.includes('README.md'));
    assert.ok(result.files.includes('dependencies.json'));
    assert.ok(result.files.includes('tokens/css-variables.css'));
    assert.ok(result.files.includes('TAILWIND.md'));

    const written = await fs.readFile(
      path.join(result.outputDir, 'components/ui/button.tsx'),
      'utf-8'
    );
    assert.equal(written, BUTTON);

    const deps = await fs.readJson(path.join(result.outputDir, 'dependencies.json'));
    assert.deepEqual(deps.dependencies, ['@radix-ui/react-slot']);
    assert.deepEqual(deps.registryDependencies, ['utils']);
  });

  it('exports an npm-ready package scaffold', async () => {
    const root = await createTempRoot();
    const componentPaths = await seedComponents(root);

    const result = await exportComponents({
      componentPaths,
      target: 'npm-package',
      packageName: '@acme/ui',
    });

    assert.equal(result.validation.valid, true);
    const packageJson = await fs.readJson(path.join(result.outputDir, 'package.json'));
    assert.equal(packageJson.name, '@acme/ui');
    assert.equal(packageJson.peerDependencies.react, '>=18');
    assert.ok(packageJson.dependencies['@radix-ui/react-slot']);

    const index = await fs.readFile(path.join(result.outputDir, 'src/index.ts'), 'utf-8');
    assert.ok(index.includes("export * from './button.js';"));
    assert.ok(index.includes("export * from './card.js';"));
  });

  it('exports a shadcn-compatible registry structure', async () => {
    const root = await createTempRoot();
    const componentPaths = await seedComponents(root);

    const result = await exportComponents({ componentPaths, target: 'registry' });

    assert.equal(result.validation.valid, true);
    const registry = await fs.readJson(path.join(result.outputDir, 'registry.json'));
    assert.equal(registry.items.length, 2);
    const item = await fs.readJson(path.join(result.outputDir, 'r/button.json'));
    assert.equal(item.files[0].content, BUTTON);
  });

  it('rejects invalid targets, paths, and package names', async () => {
    const root = await createTempRoot();
    const componentPaths = await seedComponents(root);

    await assert.rejects(
      exportComponents({ componentPaths, target: 'zip' as never }),
      ExportValidationError
    );
    await assert.rejects(
      exportComponents({ componentPaths: ['../outside.tsx'], target: 'folder' }),
      ExportValidationError
    );
    await assert.rejects(
      exportComponents({ componentPaths, target: 'folder', outputDir: '../escape' }),
      ExportValidationError
    );
    await assert.rejects(
      exportComponents({ componentPaths, target: 'folder', outputDir: '.shadcn-tweaker/backups' }),
      ExportValidationError
    );
    await assert.rejects(
      exportComponents({ componentPaths, target: 'npm-package', packageName: 'Not Valid' }),
      ExportValidationError
    );
    await assert.rejects(
      exportComponents({ componentPaths: [], target: 'folder' }),
      ExportValidationError
    );
  });
});

describe('export route', () => {
  it('exports through the API', async () => {
    const root = await createTempRoot();
    const componentPaths = await seedComponents(root);

    const res = await request(app)
      .post('/api/export')
      .send({ componentPaths, target: 'folder', outputDir: 'exports/my-kit' });

    assert.equal(res.status, 200);
    assert.equal(res.body.result.validation.valid, true);
    assert.ok(res.body.result.outputDir.endsWith(path.join('exports', 'my-kit')));
  });

  it('rejects malformed requests', async () => {
    await createTempRoot();
    const res = await request(app).post('/api/export').send({ target: 'folder' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'EXPORT_VALIDATION_ERROR');
  });
});
