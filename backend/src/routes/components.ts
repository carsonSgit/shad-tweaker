import { type Request, type Response, Router } from 'express';
import {
  getCachedComponents,
  getComponentByName,
  getComponentsWithContent,
  getWorkingDirectory,
  scanComponents,
} from '../services/scanner.js';
import { logger } from '../utils/logger.js';
import { validateCustomPath } from '../utils/validation.js';

const router = Router();

router.get('/scan', async (req: Request, res: Response) => {
  try {
    const customPath = req.query.path as string | undefined;
    const basePath = getWorkingDirectory();

    // Validate custom path to prevent path traversal attacks
    if (customPath) {
      const pathValidation = validateCustomPath(customPath);
      if (!pathValidation.valid) {
        res.status(400).json({
          success: false,
          error: {
            message: pathValidation.error || 'Invalid path',
            code: 'PATH_TRAVERSAL_ERROR',
          },
        });
        return;
      }
    }

    const result = await scanComponents(basePath, customPath);

    if (!result.success) {
      res.status(404).json({
        success: false,
        error: {
          message: 'No shadcn components directory found',
          code: 'COMPONENTS_NOT_FOUND',
        },
      });
      return;
    }

    res.json(result);
  } catch (error) {
    logger.error('Failed to scan components', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to scan components',
        code: 'SCAN_ERROR',
      },
    });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const cached = getCachedComponents();

    if (cached.length === 0) {
      res.json({
        components: [],
        message: 'No components cached. Call GET /api/components/scan first.',
      });
      return;
    }

    const components = await getComponentsWithContent();

    res.json({ components });
  } catch (error) {
    logger.error('Failed to get components', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get components',
        code: 'GET_COMPONENTS_ERROR',
      },
    });
  }
});

router.get('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const component = await getComponentByName(name);

    if (!component) {
      res.status(404).json({
        success: false,
        error: {
          message: `Component not found: ${name}`,
          code: 'COMPONENT_NOT_FOUND',
        },
      });
      return;
    }

    res.json(component);
  } catch (error) {
    logger.error(`Failed to get component: ${req.params.name}`, error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get component',
        code: 'GET_COMPONENT_ERROR',
      },
    });
  }
});

export default router;
