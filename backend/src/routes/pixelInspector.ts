import { type Request, type Response, Router } from 'express';
import {
  analyzePixelInspector,
  PixelInspectorValidationError,
} from '../services/pixelInspector.js';
import { logger } from '../utils/logger.js';

const router = Router();

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

export default router;
