import { type Request, type Response, Router } from 'express';
import {
  analyzePixelInspector,
  applyPixelInspectorPatch,
  createPixelInspectorPreset,
  deletePixelInspectorPreset,
  listPixelInspectorPresets,
  PixelInspectorValidationError,
  previewPixelInspectorPatch,
} from '../services/pixelInspector.js';
import { logger } from '../utils/logger.js';

const router = Router();

const MAX_COMPONENT_PATH_LENGTH = 1024;
const MAX_DRAFT_CLASSES = 50;
const MAX_CLASS_LENGTH = 200;

function validateClassList(value: unknown, field: string): void {
  if (!Array.isArray(value)) {
    throw new PixelInspectorValidationError(`${field} must be an array.`);
  }
  if (value.length > MAX_DRAFT_CLASSES) {
    throw new PixelInspectorValidationError(
      `${field} must contain at most ${MAX_DRAFT_CLASSES} entries.`
    );
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length > MAX_CLASS_LENGTH) {
      throw new PixelInspectorValidationError(
        `${field} entries must be strings up to ${MAX_CLASS_LENGTH} characters.`
      );
    }
  }
}

/** Bounds-checks the untrusted draft payload before it reaches the service layer. */
function validatePixelInspectorDraft(draft: unknown): void {
  if (!draft || typeof draft !== 'object') {
    throw new PixelInspectorValidationError('draft is required.');
  }
  const record = draft as Record<string, unknown>;
  if (typeof record.componentPath !== 'string' || record.componentPath.trim().length === 0) {
    throw new PixelInspectorValidationError('draft.componentPath must be a non-empty string.');
  }
  if (record.componentPath.length > MAX_COMPONENT_PATH_LENGTH) {
    throw new PixelInspectorValidationError('draft.componentPath is too long.');
  }
  validateClassList(record.targetClasses, 'draft.targetClasses');
  validateClassList(record.replacementClasses, 'draft.replacementClasses');
}

function sendError(res: Response, error: unknown, fallback: string): void {
  const validation = error instanceof PixelInspectorValidationError;
  res.status(validation ? 400 : 500).json({
    success: false,
    error: {
      message: error instanceof Error ? error.message : fallback,
      code: validation ? error.code : 'PIXEL_INSPECTOR_ERROR',
    },
  });
}

router.post('/analyze', async (req: Request, res: Response) => {
  try {
    if (typeof req.body?.componentPath !== 'string') {
      throw new PixelInspectorValidationError('componentPath is required.');
    }
    res.json({
      success: true,
      analysis: await analyzePixelInspector(req.body.componentPath),
    });
  } catch (error) {
    logger.error('Failed to analyze pixel inspector classes', error);
    sendError(res, error, 'Failed to analyze pixel inspector classes');
  }
});

router.post('/preview', async (req: Request, res: Response) => {
  try {
    validatePixelInspectorDraft(req.body?.draft);
    res.json({
      success: true,
      ...(await previewPixelInspectorPatch({ draft: req.body.draft })),
    });
  } catch (error) {
    logger.error('Failed to preview pixel inspector patch', error);
    sendError(res, error, 'Failed to preview pixel inspector patch');
  }
});

router.post('/apply', async (req: Request, res: Response) => {
  try {
    validatePixelInspectorDraft(req.body?.draft);
    res.json({
      success: true,
      result: await applyPixelInspectorPatch({
        draft: req.body.draft,
        createBackup: req.body.createBackup,
        recordOverrides: req.body.recordOverrides,
      }),
    });
  } catch (error) {
    logger.error('Failed to apply pixel inspector patch', error);
    sendError(res, error, 'Failed to apply pixel inspector patch');
  }
});

router.get('/presets', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, presets: await listPixelInspectorPresets() });
  } catch (error) {
    logger.error('Failed to list pixel inspector presets', error);
    sendError(res, error, 'Failed to list pixel inspector presets');
  }
});

router.post('/presets', async (req: Request, res: Response) => {
  try {
    if (typeof req.body?.name !== 'string') {
      throw new PixelInspectorValidationError('name is required.');
    }
    validatePixelInspectorDraft(req.body?.draft);
    res.status(201).json({
      success: true,
      preset: await createPixelInspectorPreset({
        name: req.body.name,
        description: typeof req.body.description === 'string' ? req.body.description : undefined,
        draft: req.body.draft,
      }),
    });
  } catch (error) {
    logger.error('Failed to create pixel inspector preset', error);
    sendError(res, error, 'Failed to create pixel inspector preset');
  }
});

router.delete('/presets/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await deletePixelInspectorPreset(req.params.id);
    if (!deleted) {
      res.status(404).json({
        success: false,
        error: { message: 'Preset not found', code: 'PIXEL_INSPECTOR_PRESET_NOT_FOUND' },
      });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete pixel inspector preset', error);
    sendError(res, error, 'Failed to delete pixel inspector preset');
  }
});

export default router;
