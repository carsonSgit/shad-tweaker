import { type Request, type Response, Router } from 'express';
import { listBackups } from '../services/backup.js';
import { listComponentLibrary } from '../services/componentLibrary.js';
import { getRegistrySourceHealth, listRegistryItemsBySource } from '../services/registry.js';
import {
  createFrequencyReport,
  createInconsistencyReport,
  listTokenSets,
} from '../services/tokens.js';
import { listVariantComponents } from '../services/variants.js';
import {
  getWorkingDirectory,
  listRegistrySources,
  loadWorkspaceManifest,
} from '../services/workspace.js';
import { logger } from '../utils/logger.js';

const router = Router();

async function readSafely<T>(label: string, loader: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    logger.warn(`Failed to load studio summary ${label}`, error);
    return fallback;
  }
}

router.get('/summary', async (_req: Request, res: Response) => {
  const cwd = getWorkingDirectory();
  const [
    manifest,
    inventory,
    sources,
    health,
    registryItems,
    tokenSets,
    frequency,
    inconsistencies,
    variantComponents,
    backups,
  ] = await Promise.all([
    loadWorkspaceManifest(cwd),
    readSafely('components', () => listComponentLibrary(cwd), []),
    readSafely('registry sources', () => listRegistrySources(cwd), []),
    readSafely('registry health', () => getRegistrySourceHealth(cwd), []),
    readSafely('registry items', () => listRegistryItemsBySource(undefined, cwd), {
      items: [],
      warnings: [],
    }),
    readSafely('token sets', () => listTokenSets(), []),
    readSafely('token frequency', () => createFrequencyReport(), {
      entries: [],
      totalOccurrences: 0,
    }),
    readSafely('token inconsistencies', () => createInconsistencyReport(), { entries: [] }),
    readSafely('variants', () => listVariantComponents(cwd), []),
    readSafely('backups', () => listBackups(), []),
  ]);

  res.json({
    success: true,
    workspace: {
      cwd,
      manifest,
    },
    components: {
      count: inventory.length,
      inventory,
    },
    registries: {
      sources,
      health,
      items: registryItems.items,
      warnings: registryItems.warnings,
    },
    tokens: {
      tokenSets,
      frequency,
      inconsistencies,
    },
    variants: {
      components: variantComponents,
    },
    backups: {
      backups,
    },
    health: {
      status: 'ok',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;
