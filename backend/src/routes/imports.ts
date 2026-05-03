import { type Request, type Response, Router } from 'express';
import {
  applyImportPlan,
  generateImportPlan,
  RegistryItemNotFoundError,
} from '../services/importPlanner.js';
import { getWorkingDirectory } from '../services/workspace.js';
import type {
  ApplyImportPlanRequest,
  ImportConflictAction,
  ImportPlanRequest,
  PlannedFile,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { isSafeProjectRelativePath } from '../utils/paths.js';
import { isPathSafe, isSafeRegistryIdentifier } from '../utils/validation.js';

const router = Router();

const CONFLICT_ACTIONS = [
  'overwrite',
  'skip',
  'rename',
  'fork',
] as const satisfies ImportConflictAction[];

function validatePlanRequest(body: unknown): body is ImportPlanRequest {
  if (typeof body !== 'object' || body === null) return false;
  const req = body as Record<string, unknown>;

  if (typeof req.itemName !== 'string' || !isSafeRegistryIdentifier(req.itemName)) return false;
  if (req.sourceId !== undefined) {
    return typeof req.sourceId === 'string' && isSafeRegistryIdentifier(req.sourceId);
  }

  return true;
}

function isPlannedFile(value: unknown, cwd: string): value is PlannedFile {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file.sourcePath === 'string' &&
    typeof file.targetPath === 'string' &&
    typeof file.content === 'string' &&
    isPathSafe(file.targetPath, cwd)
  );
}

function validateApplyRequest(body: unknown, cwd: string): body is ApplyImportPlanRequest {
  if (typeof body !== 'object' || body === null) return false;
  const req = body as Record<string, unknown>;

  if (typeof req.plan !== 'object' || req.plan === null) return false;
  const plan = req.plan as Record<string, unknown>;
  if (
    typeof plan.id !== 'string' ||
    typeof plan.itemName !== 'string' ||
    !isSafeRegistryIdentifier(plan.itemName)
  ) {
    return false;
  }
  if (!Array.isArray(plan.filesToAdd) || !Array.isArray(plan.filesToOverwrite)) return false;
  if (!plan.filesToAdd.every((file) => isPlannedFile(file, cwd))) return false;
  if (!plan.filesToOverwrite.every((file) => isPlannedFile(file, cwd))) return false;

  if (req.resolutions === undefined) return true;
  if (!Array.isArray(req.resolutions)) return false;

  return req.resolutions.every((resolution) => {
    if (typeof resolution !== 'object' || resolution === null) return false;
    const candidate = resolution as Record<string, unknown>;
    return (
      typeof candidate.path === 'string' &&
      typeof candidate.action === 'string' &&
      CONFLICT_ACTIONS.includes(candidate.action as ImportConflictAction) &&
      (candidate.targetPath === undefined ||
        (typeof candidate.targetPath === 'string' &&
          isSafeProjectRelativePath(candidate.targetPath)))
    );
  });
}

router.post('/plan', async (req: Request, res: Response) => {
  try {
    if (!validatePlanRequest(req.body)) {
      res.status(400).json({
        success: false,
        error: {
          message: 'itemName and optional sourceId must be safe registry identifiers.',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    const plan = await generateImportPlan(req.body);
    res.json({ success: true, plan });
  } catch (error) {
    logger.error('Failed to generate import plan', error);
    const message = error instanceof Error ? error.message : 'Failed to generate import plan';
    const notFound = error instanceof RegistryItemNotFoundError;
    const status = notFound ? 404 : 500;
    res.status(status).json({
      success: false,
      error: {
        message,
        code: notFound ? error.code : 'IMPORT_PLAN_ERROR',
      },
    });
  }
});

router.post('/apply', async (req: Request, res: Response) => {
  try {
    if (!validateApplyRequest(req.body, getWorkingDirectory())) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid import plan apply request.',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    const result = await applyImportPlan(req.body);
    res.json({ success: true, result });
  } catch (error) {
    logger.error('Failed to apply import plan', error);
    const message = error instanceof Error ? error.message : 'Failed to apply import plan';
    res.status(500).json({
      success: false,
      error: {
        message,
        code: 'IMPORT_APPLY_ERROR',
      },
    });
  }
});

export default router;
