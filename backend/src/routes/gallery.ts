import { type Request, type Response, Router } from 'express';
import { listGalleryFixtures } from '../services/gallery.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/fixtures', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, fixtures: listGalleryFixtures() });
  } catch (error) {
    logger.error('Failed to list gallery fixtures', error);
    res.status(500).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to list gallery fixtures',
        code: 'GALLERY_ERROR',
      },
    });
  }
});

export default router;
