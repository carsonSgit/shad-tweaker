import { Router, Request, Response } from 'express';
import { previewChanges, applyChanges, applyBatchAction } from '../services/modifier.js';
import {
  validateEditRequest,
  validateApplyRequest,
  validateBatchActionRequest,
  validateRegex,
} from '../utils/validation.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.post('/preview', async (req: Request, res: Response) => {
  try {
    if (!validateEditRequest(req.body)) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid request body. Required: componentPaths (string[]), find (string), replace (string), isRegex (boolean)',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    const { componentPaths, find, replace, isRegex } = req.body;

    if (isRegex) {
      const validation = validateRegex(find);
      if (!validation.valid) {
        res.status(400).json({
          success: false,
          error: {
            message: `Invalid regex pattern: ${validation.error}`,
            code: 'INVALID_REGEX',
          },
        });
        return;
      }
    }

    const result = await previewChanges(componentPaths, find, replace, isRegex);

    res.json({
      success: true,
      previews: result.previews,
      totalChanges: result.totalChanges,
    });
  } catch (error) {
    logger.error('Failed to preview changes', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to preview changes',
        code: 'PREVIEW_ERROR',
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
          message: 'Invalid request body. Required: componentPaths (string[]), find (string), replace (string), isRegex (boolean)',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    const { componentPaths, find, replace, isRegex, createBackup = true } = req.body;

    if (isRegex) {
      const validation = validateRegex(find);
      if (!validation.valid) {
        res.status(400).json({
          success: false,
          error: {
            message: `Invalid regex pattern: ${validation.error}`,
            code: 'INVALID_REGEX',
          },
        });
        return;
      }
    }

    const result = await applyChanges(componentPaths, find, replace, isRegex, createBackup);

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Some files failed to modify',
          code: 'APPLY_PARTIAL_ERROR',
        },
        modified: result.modified,
        errors: result.errors,
        backupId: result.backupId,
      });
      return;
    }

    res.json({
      success: true,
      modified: result.modified,
      changes: result.changes,
      backupId: result.backupId,
    });
  } catch (error) {
    logger.error('Failed to apply changes', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to apply changes',
        code: 'APPLY_ERROR',
      },
    });
  }
});

router.post('/batch-action', async (req: Request, res: Response) => {
  try {
    if (!validateBatchActionRequest(req.body)) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid request body. Required: action (string), componentPaths (string[]). Valid actions: remove-cursor-pointer, add-focus-rings, update-border-radius, remove-class, replace-class',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    const { action, componentPaths, options } = req.body;

    const result = await applyBatchAction(action, componentPaths, options);

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: {
          message: result.errors?.[0]?.error || 'Batch action failed',
          code: 'BATCH_ACTION_ERROR',
        },
        errors: result.errors,
      });
      return;
    }

    res.json({
      success: true,
      modified: result.modified,
      changes: result.changes,
      backupId: result.backupId,
    });
  } catch (error) {
    logger.error('Failed to execute batch action', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to execute batch action',
        code: 'BATCH_ACTION_ERROR',
      },
    });
  }
});

export default router;
