import { type Request, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import backendPackage from '../../package.json' with { type: 'json' };
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
  DEFAULT_WORKSPACE_CONFIG,
  getWorkingDirectory,
  listRegistrySources,
  loadWorkspaceManifest,
} from '../services/workspace.js';
import type { WorkspaceManifest } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { readPositiveInteger } from '../utils/numbers.js';

const DEFAULT_STUDIO_SUMMARY_TIMEOUT_MS = 3000;

interface StudioSummaryError {
  label: string;
  message: string;
}

interface StudioSummaryReadContext {
  errors: StudioSummaryError[];
}

interface StudioSummaryLoaders {
  loadWorkspaceManifest: (cwd: string) => Promise<WorkspaceManifest>;
  listComponentLibrary: typeof listComponentLibrary;
  listRegistrySources: typeof listRegistrySources;
  getRegistrySourceHealth: typeof getRegistrySourceHealth;
  listRegistryItemsBySource: typeof listRegistryItemsBySource;
  listTokenSets: typeof listTokenSets;
  createFrequencyReport: typeof createFrequencyReport;
  createInconsistencyReport: typeof createInconsistencyReport;
  listVariantComponents: typeof listVariantComponents;
  listBackups: typeof listBackups;
}

export const defaultStudioSummaryLoaders: StudioSummaryLoaders = {
  loadWorkspaceManifest,
  listComponentLibrary,
  listRegistrySources,
  getRegistrySourceHealth,
  listRegistryItemsBySource,
  listTokenSets,
  createFrequencyReport,
  createInconsistencyReport,
  listVariantComponents,
  listBackups,
};

export function createStudioSummaryLimiter(
  max = readPositiveInteger(process.env.STUDIO_SUMMARY_RATE_LIMIT_PER_MINUTE, 600)
) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        message: 'Too many studio summary requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
    },
  });
}

const summaryLimiter = createStudioSummaryLimiter();

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Failed to load summary data.';
}

function withTimeout<T>(label: string, loader: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  return Promise.race([loader(), timeout]).finally(() => clearTimeout(timer));
}

async function readSafely<T>(
  label: string,
  loader: () => Promise<T>,
  fallback: T,
  context: StudioSummaryReadContext,
  timeoutMs: number
): Promise<T> {
  try {
    return await withTimeout(label, loader, timeoutMs);
  } catch (error) {
    logger.warn(`Failed to load studio summary ${label}`, error);
    context.errors.push({ label, message: errorMessage(error) });
    return fallback;
  }
}

function createFallbackManifest(): WorkspaceManifest {
  const now = new Date().toISOString();

  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    config: { ...DEFAULT_WORKSPACE_CONFIG },
    components: [],
    sources: [],
    packages: [],
    tokenSets: [],
    componentTokenOverrides: {},
    presets: [],
    backups: [],
  };
}

export function createStudioRouter(
  loaders: StudioSummaryLoaders = defaultStudioSummaryLoaders,
  summaryTimeoutMs = DEFAULT_STUDIO_SUMMARY_TIMEOUT_MS
) {
  const router = Router();

  router.get('/summary', summaryLimiter, async (_req: Request, res: Response) => {
    try {
      const cwd = getWorkingDirectory();
      const context: StudioSummaryReadContext = { errors: [] };
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
        readSafely(
          'workspace manifest',
          () => loaders.loadWorkspaceManifest(cwd),
          createFallbackManifest(),
          context,
          summaryTimeoutMs
        ),
        readSafely(
          'components',
          () => loaders.listComponentLibrary(cwd),
          [],
          context,
          summaryTimeoutMs
        ),
        readSafely(
          'registry sources',
          () => loaders.listRegistrySources(cwd),
          [],
          context,
          summaryTimeoutMs
        ),
        readSafely(
          'registry health',
          () => loaders.getRegistrySourceHealth(cwd),
          [],
          context,
          summaryTimeoutMs
        ),
        readSafely(
          'registry items',
          () => loaders.listRegistryItemsBySource(undefined, cwd),
          {
            items: [],
            warnings: [],
          },
          context,
          summaryTimeoutMs
        ),
        readSafely('token sets', () => loaders.listTokenSets(), [], context, summaryTimeoutMs),
        readSafely(
          'token frequency',
          () => loaders.createFrequencyReport(),
          {
            entries: [],
            totalOccurrences: 0,
          },
          context,
          summaryTimeoutMs
        ),
        readSafely(
          'token inconsistencies',
          () => loaders.createInconsistencyReport(),
          { entries: [] },
          context,
          summaryTimeoutMs
        ),
        readSafely(
          'variants',
          () => loaders.listVariantComponents(cwd),
          [],
          context,
          summaryTimeoutMs
        ),
        readSafely('backups', () => loaders.listBackups(), [], context, summaryTimeoutMs),
      ]);

      res.setHeader('Cache-Control', 'private, max-age=5');
      res.json({
        success: true,
        _meta: {
          errors: context.errors,
        },
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
          backups: backups.map((backup) => ({
            id: backup.id,
            timestamp: backup.timestamp,
            components: backup.components.length,
            size: backup.size,
          })),
        },
        health: {
          status: 'ok',
          version: backendPackage.version,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error('Failed to build studio summary response', error);
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to build studio summary.',
          code: 'STUDIO_SUMMARY_ERROR',
        },
      });
    }
  });

  return router;
}

export default createStudioRouter();
