import { type Request, type Response, Router } from 'express';
import {
  generateBrailleLoader,
  LoaderValidationError,
  listBrailleLoaderPresets,
} from '../services/loaders.js';
import { logger } from '../utils/logger.js';

const router = Router();

function sendError(res: Response, error: unknown, fallback: string): void {
  const validation = error instanceof LoaderValidationError;
  res.status(validation ? 400 : 500).json({
    success: false,
    error: {
      message: error instanceof Error ? error.message : fallback,
      code: validation ? error.code : 'LOADER_ERROR',
    },
  });
}

router.get('/presets', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, presets: listBrailleLoaderPresets() });
  } catch (error) {
    logger.error('Failed to list braille loader presets', error);
    sendError(res, error, 'Failed to list braille loader presets');
  }
});

router.post('/generate', (req: Request, res: Response) => {
  try {
    if (typeof req.body?.presetId !== 'string') {
      throw new LoaderValidationError('presetId is required.');
    }
    res.json({
      success: true,
      generated: generateBrailleLoader({
        presetId: req.body.presetId,
        componentName:
          typeof req.body.componentName === 'string' ? req.body.componentName : undefined,
        intervalMs: typeof req.body.intervalMs === 'number' ? req.body.intervalMs : undefined,
        label: typeof req.body.label === 'string' ? req.body.label : undefined,
        sizeRem: typeof req.body.sizeRem === 'number' ? req.body.sizeRem : undefined,
        color: typeof req.body.color === 'string' ? req.body.color : undefined,
        reducedMotionMode:
          typeof req.body.reducedMotionMode === 'string' ? req.body.reducedMotionMode : undefined,
      }),
    });
  } catch (error) {
    logger.error('Failed to generate braille loader component', error);
    sendError(res, error, 'Failed to generate braille loader component');
  }
});

export default router;
