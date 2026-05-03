import { type Request, type Response, Router } from 'express';
import { applyImportPlan, generateImportPlan } from '../services/importPlanner.js';
import type {
  ApplyImportPlanRequest,
  ImportConflictAction,
  ImportPlanRequest,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { isSafeRegistryIdentifier } from '../utils/validation.js';

const router = Router();

const CONFLICT_ACTIONS: ImportConflictAction[] = ['overwrite', 'skip', 'rename', 'fork'];

function validatePlanRequest(body: unknown): body is ImportPlanRequest {
  if (typeof body !== 'object' || body === null) return false;
  const req = body as Record<string, unknown>;

  if (typeof req.itemName !== 'string' || !isSafeRegistryIdentifier(req.itemName)) return false;
  if (req.sourceId !== undefined) {
    return typeof req.sourceId === 'string' && isSafeRegistryIdentifier(req.sourceId);
  }

  return true;
}

function validateApplyRequest(body: unknown): body is ApplyImportPlanRequest {
  if (typeof body !== 'object' || body === null) return false;
  const req = body as Record<string, unknown>;

  if (typeof req.plan !== 'object' || req.plan === null) return false;
  const plan = req.plan as Record<string, unknown>;
  if (typeof plan.id !== 'string' || typeof plan.itemName !== 'string') return false;
  if (!Array.isArray(plan.filesToAdd) || !Array.isArray(plan.filesToOverwrite)) return false;

  if (req.resolutions === undefined) return true;
  if (!Array.isArray(req.resolutions)) return false;

  return req.resolutions.every((resolution) => {
    if (typeof resolution !== 'object' || resolution === null) return false;
    const candidate = resolution as Record<string, unknown>;
    return (
      typeof candidate.path === 'string' &&
      typeof candidate.action === 'string' &&
      CONFLICT_ACTIONS.includes(candidate.action as ImportConflictAction) &&
      (candidate.targetPath === undefined || typeof candidate.targetPath === 'string')
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
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({
      success: false,
      error: {
        message,
        code: status === 404 ? 'REGISTRY_ITEM_NOT_FOUND' : 'IMPORT_PLAN_ERROR',
      },
    });
  }
});

router.post('/apply', async (req: Request, res: Response) => {
  try {
    if (!validateApplyRequest(req.body)) {
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
