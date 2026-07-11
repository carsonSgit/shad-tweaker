import { type Request, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  applyMotionSlotPatch,
  buildMotionOutput,
  createMotionPreset,
  DEFAULT_MOTION_SETTINGS,
  deleteMotionPreset,
  listMotionPresets,
  listMotionSlots,
  MotionValidationError,
  previewMotionSlotPatch,
  validateMotionSettings,
} from '../services/motion.js';
import { logger } from '../utils/logger.js';
import { readPositiveInteger } from '../utils/numbers.js';

const router = Router();

const MAX_COMPONENT_PATH_LENGTH = 1024;
const MAX_PRESET_ID_LENGTH = 128;

/** Guards file writes and preset mutations against abusive request volumes. */
export function createMotionMutationLimiter(
  max = readPositiveInteger(process.env.MOTION_MUTATION_RATE_LIMIT_PER_MINUTE, 60)
) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        message: 'Too many motion write requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
    },
  });
}

const mutationLimiter = createMotionMutationLimiter();

function sendError(res: Response, error: unknown, fallback: string): void {
  const validation = error instanceof MotionValidationError;
  res.status(validation ? 400 : 500).json({
    success: false,
    error: {
      message: error instanceof Error ? error.message : fallback,
      code: validation ? error.code : 'MOTION_ERROR',
    },
  });
}

function readComponentPath(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MotionValidationError('componentPath is required.');
  }
  if (value.length > MAX_COMPONENT_PATH_LENGTH) {
    throw new MotionValidationError('componentPath is too long.');
  }
  return value;
}

function readLine(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100000) {
    throw new MotionValidationError('line must be a positive integer.');
  }
  return value;
}

router.get('/defaults', (_req: Request, res: Response) => {
  res.json({ success: true, settings: DEFAULT_MOTION_SETTINGS });
});

router.post('/output', (req: Request, res: Response) => {
  try {
    const settings = validateMotionSettings(req.body?.settings);
    res.json({ success: true, output: buildMotionOutput(settings) });
  } catch (error) {
    logger.error('Failed to build motion output', error);
    sendError(res, error, 'Failed to build motion output');
  }
});

router.post('/slots', async (req: Request, res: Response) => {
  try {
    const componentPath = readComponentPath(req.body?.componentPath);
    res.json({ success: true, slots: await listMotionSlots(componentPath) });
  } catch (error) {
    logger.error('Failed to list motion slots', error);
    sendError(res, error, 'Failed to list motion slots');
  }
});

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const componentPath = readComponentPath(req.body?.componentPath);
    const line = readLine(req.body?.line);
    const settings = validateMotionSettings(req.body?.settings);
    res.json({
      success: true,
      ...(await previewMotionSlotPatch({ componentPath, line, settings })),
    });
  } catch (error) {
    logger.error('Failed to preview motion patch', error);
    sendError(res, error, 'Failed to preview motion patch');
  }
});

router.post('/apply', mutationLimiter, async (req: Request, res: Response) => {
  try {
    const componentPath = readComponentPath(req.body?.componentPath);
    const line = readLine(req.body?.line);
    const settings = validateMotionSettings(req.body?.settings);
    res.json({
      success: true,
      result: await applyMotionSlotPatch({
        componentPath,
        line,
        settings,
        createBackup: req.body?.createBackup,
      }),
    });
  } catch (error) {
    logger.error('Failed to apply motion patch', error);
    sendError(res, error, 'Failed to apply motion patch');
  }
});

router.get('/presets', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, presets: await listMotionPresets() });
  } catch (error) {
    logger.error('Failed to list motion presets', error);
    sendError(res, error, 'Failed to list motion presets');
  }
});

router.post('/presets', mutationLimiter, async (req: Request, res: Response) => {
  try {
    if (typeof req.body?.name !== 'string') {
      throw new MotionValidationError('name is required.');
    }
    res.status(201).json({
      success: true,
      preset: await createMotionPreset({
        name: req.body.name,
        description: typeof req.body.description === 'string' ? req.body.description : undefined,
        settings: validateMotionSettings(req.body?.settings),
      }),
    });
  } catch (error) {
    logger.error('Failed to create motion preset', error);
    sendError(res, error, 'Failed to create motion preset');
  }
});

router.delete('/presets/:id', mutationLimiter, async (req: Request, res: Response) => {
  try {
    if (!req.params.id || req.params.id.length > MAX_PRESET_ID_LENGTH) {
      throw new MotionValidationError('preset id is missing or too long.');
    }
    const deleted = await deleteMotionPreset(req.params.id);
    if (!deleted) {
      res.status(404).json({
        success: false,
        error: { message: 'Preset not found', code: 'MOTION_PRESET_NOT_FOUND' },
      });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete motion preset', error);
    sendError(res, error, 'Failed to delete motion preset');
  }
});

export default router;
