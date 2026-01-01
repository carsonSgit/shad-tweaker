import { Router, Request, Response } from 'express';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../services/template.js';
import { validateTemplateRules } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const templates = await listTemplates();
    res.json({ templates });
  } catch (error) {
    logger.error('Failed to list templates', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to list templates',
        code: 'TEMPLATE_LIST_ERROR',
      },
    });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const template = await getTemplate(id);

    if (!template) {
      res.status(404).json({
        success: false,
        error: {
          message: `Template not found: ${id}`,
          code: 'TEMPLATE_NOT_FOUND',
        },
      });
      return;
    }

    res.json({ template });
  } catch (error) {
    logger.error(`Failed to get template: ${req.params.id}`, error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get template',
        code: 'TEMPLATE_GET_ERROR',
      },
    });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, rules } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Template name is required',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    if (!validateTemplateRules(rules)) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid rules format. Each rule must have find (string), replace (string), and isRegex (boolean)',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    const template = await createTemplate(name.trim(), rules);

    res.status(201).json({
      success: true,
      template,
    });
  } catch (error) {
    logger.error('Failed to create template', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to create template',
        code: 'TEMPLATE_CREATE_ERROR',
      },
    });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, rules } = req.body;

    const updates: { name?: string; rules?: typeof rules } = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: {
            message: 'Template name must be a non-empty string',
            code: 'VALIDATION_ERROR',
          },
        });
        return;
      }
      updates.name = name.trim();
    }

    if (rules !== undefined) {
      if (!validateTemplateRules(rules)) {
        res.status(400).json({
          success: false,
          error: {
            message: 'Invalid rules format',
            code: 'VALIDATION_ERROR',
          },
        });
        return;
      }
      updates.rules = rules;
    }

    const template = await updateTemplate(id, updates);

    if (!template) {
      res.status(404).json({
        success: false,
        error: {
          message: `Template not found: ${id}`,
          code: 'TEMPLATE_NOT_FOUND',
        },
      });
      return;
    }

    res.json({
      success: true,
      template,
    });
  } catch (error) {
    logger.error(`Failed to update template: ${req.params.id}`, error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to update template',
        code: 'TEMPLATE_UPDATE_ERROR',
      },
    });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await deleteTemplate(id);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: {
          message: `Template not found: ${id}`,
          code: 'TEMPLATE_NOT_FOUND',
        },
      });
      return;
    }

    res.json({
      success: true,
      message: `Template ${id} deleted`,
    });
  } catch (error) {
    logger.error(`Failed to delete template: ${req.params.id}`, error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to delete template',
        code: 'TEMPLATE_DELETE_ERROR',
      },
    });
  }
});

export default router;
