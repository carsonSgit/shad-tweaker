import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
import express from 'express';
import fs from 'fs-extra';
import request from 'supertest';
import backendPackage from '../package.json' with { type: 'json' };
import studioRouter, {
  createStudioRouter,
  createStudioSummaryLimiter,
  defaultStudioSummaryLoaders,
} from '../src/routes/studio.js';

const app = express();
app.use(express.json());
app.use('/api/studio', studioRouter);

const tempRoots: string[] = [];
const testWorkspaceBase = path.join(
  process.cwd(),
  '.shadcn-tweaker-test-workspaces',
  'studio-routes'
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

after(async () => {
  await fs.remove(testWorkspaceBase);
});

describe('studio summary route', () => {
  it('returns partial summary data when the workspace manifest cannot be loaded', async () => {
    const root = await createTempRoot();
    await fs.ensureDir(path.join(root, '.shadcn-tweaker'));
    await fs.writeFile(path.join(root, '.shadcn-tweaker/manifest.json'), '{ invalid json');

    const res = await request(app).get('/api/studio/summary');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.workspace.cwd, root);
    assert.equal(res.body.workspace.manifest.config.componentDirectory, './components/ui');
    assert.deepEqual(res.body.workspace.manifest.components, []);
    assert.ok(
      res.body._meta.errors.some((error: { label: string }) => error.label === 'workspace manifest')
    );
  });

  it('returns partial summary metadata when one loader fails', async () => {
    await createTempRoot();
    const degradedApp = express();
    degradedApp.use(express.json());
    degradedApp.use(
      '/api/studio',
      createStudioRouter({
        ...defaultStudioSummaryLoaders,
        listComponentLibrary: async () => {
          throw new Error('inventory unavailable');
        },
      })
    );

    const res = await request(degradedApp).get('/api/studio/summary');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.components.inventory, []);
    assert.ok(
      res.body._meta.errors.some(
        (error: { label: string; message: string }) =>
          error.label === 'components' && error.message === 'inventory unavailable'
      )
    );
  });

  it('returns fallback data when a summary loader times out', async () => {
    const root = await createTempRoot();
    const timeoutApp = express();
    timeoutApp.use(express.json());
    timeoutApp.use(
      '/api/studio',
      createStudioRouter(
        {
          loadWorkspaceManifest: async () => ({
            version: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
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
            tokenSets: [],
            componentTokenOverrides: {},
            presets: [],
            backups: [],
          }),
          listComponentLibrary: async () => [],
          listRegistrySources: async () => [],
          getRegistrySourceHealth: async () => [],
          listRegistryItemsBySource: async () => ({ items: [], warnings: [] }),
          listTokenSets: async () => [],
          createFrequencyReport: async () => ({ entries: [], totalOccurrences: 0 }),
          createInconsistencyReport: async () => ({ entries: [] }),
          listVariantComponents: async () => [],
          listBackups: () => new Promise(() => {}),
        },
        5
      )
    );

    const res = await request(timeoutApp).get('/api/studio/summary');

    assert.equal(res.status, 200);
    assert.equal(res.body.workspace.cwd, root);
    assert.deepEqual(res.body.backups.backups, []);
    assert.ok(
      res.body._meta.errors.some((error: { label: string; message: string }) => {
        return error.label === 'backups' && /timed out/.test(error.message);
      })
    );
  });

  it('returns cache headers and the backend package version', async () => {
    await createTempRoot();

    const res = await request(app).get('/api/studio/summary');

    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'private, max-age=5');
    assert.equal(res.body.health.version, backendPackage.version);
  });

  it('returns backup component counts in the summary backup list', async () => {
    const root = await createTempRoot();
    const backupPath = path.join(root, '.shadcn-tweaker/backups/backup_2026-01-01_00-00-00');
    const filePath = path.join(backupPath, 'button.tsx');
    await fs.outputFile(filePath, 'backup content');
    await fs.writeJson(path.join(backupPath, 'manifest.json'), {
      id: 'backup_2026-01-01_00-00-00',
      timestamp: '2026-01-01T00:00:00.000Z',
      files: [
        {
          originalPath: 'components/ui/button.tsx',
          backupPath: filePath,
        },
        {
          originalPath: 'components/ui/card.tsx',
          backupPath: filePath,
        },
      ],
    });

    const res = await request(app).get('/api/studio/summary');

    assert.equal(res.status, 200);
    assert.equal(res.body.backups.backups[0].components, 2);
  });

  it('rate limits repeated summary requests', async () => {
    const limitedApp = express();
    limitedApp.get('/limited-summary', createStudioSummaryLimiter(2), (_req, res) => {
      res.json({ success: true });
    });

    let limited: request.Response | undefined;
    for (let index = 0; index < 3; index += 1) {
      const res = await request(limitedApp).get('/limited-summary');
      if (res.status === 429) {
        limited = res;
        break;
      }
    }

    assert.ok(limited);
    assert.equal(limited.body.success, false);
    assert.equal(limited.body.error.code, 'RATE_LIMIT_EXCEEDED');
  });
});
