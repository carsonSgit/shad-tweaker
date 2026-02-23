import path from 'node:path';
import { type Request, type Response, Router } from 'express';
import { applyChanges } from '../services/modifier.js';
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from '../services/template.js';
import { logger } from '../utils/logger.js';
import {
  validateComponentPaths,
  validateTemplateId,
  validateTemplateRulesDetailed,
} from '../utils/validation.js';

const router = Router();

// Get the project directory for path validation
// Backend runs from the backend/ directory, so we need to go up one level to the project root
const PROJECT_DIR = path.resolve(process.cwd(), '..');

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

    // Validate template ID to prevent path traversal attacks
    const idValidation = validateTemplateId(id);
    if (!idValidation.valid) {
      res.status(400).json({
        success: false,
        error: {
          message: idValidation.error || 'Invalid template ID',
          code: 'INVALID_TEMPLATE_ID',
        },
      });
      return;
    }

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

    const validation = validateTemplateRulesDetailed(rules);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid template rules',
          code: 'INVALID_TEMPLATE_RULES',
        },
        validationErrors: validation.errors,
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

    // Validate template ID to prevent path traversal attacks
    const idValidation = validateTemplateId(id);
    if (!idValidation.valid) {
      res.status(400).json({
        success: false,
        error: {
          message: idValidation.error || 'Invalid template ID',
          code: 'INVALID_TEMPLATE_ID',
        },
      });
      return;
    }

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
      const validation = validateTemplateRulesDetailed(rules);
      if (!validation.valid) {
        res.status(400).json({
          success: false,
          error: {
            message: 'Invalid template rules',
            code: 'INVALID_TEMPLATE_RULES',
          },
          validationErrors: validation.errors,
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

    // Validate template ID to prevent path traversal attacks
    const idValidation = validateTemplateId(id);
    if (!idValidation.valid) {
      res.status(400).json({
        success: false,
        error: {
          message: idValidation.error || 'Invalid template ID',
          code: 'INVALID_TEMPLATE_ID',
        },
      });
      return;
    }

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

// Apply a template to components (applies all rules sequentially)
router.post('/:id/apply', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate template ID to prevent path traversal attacks
    const idValidation = validateTemplateId(id);
    if (!idValidation.valid) {
      res.status(400).json({
        success: false,
        error: {
          message: idValidation.error || 'Invalid template ID',
          code: 'INVALID_TEMPLATE_ID',
        },
      });
      return;
    }

    const { componentPaths } = req.body;

    if (!Array.isArray(componentPaths) || componentPaths.length === 0) {
      res.status(400).json({
        success: false,
        error: {
          message: 'componentPaths array is required',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    // Validate component paths to prevent path traversal attacks
    const pathValidation = validateComponentPaths(componentPaths, PROJECT_DIR);
    if (!pathValidation.valid) {
      res.status(400).json({
        success: false,
        error: {
          message: pathValidation.error || 'Invalid component paths',
          code: 'PATH_TRAVERSAL_ERROR',
        },
      });
      return;
    }

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

    // Apply each rule in sequence
    const allModified: string[] = [];
    let totalChanges = 0;
    let backupId: string | undefined;
    const applyErrors: Array<{ path: string; error: string; code?: string; ruleIndex: number }> =
      [];

    for (let i = 0; i < template.rules.length; i++) {
      const rule = template.rules[i];
      // Only create backup on first rule application
      const result = await applyChanges(
        componentPaths,
        rule.find,
        rule.replace,
        rule.isRegex,
        i === 0 // Only backup on first rule
      );

      if (i === 0 && result.backupId) {
        backupId = result.backupId;
      }

      if (!result.success && result.errors) {
        for (const error of result.errors) {
          applyErrors.push({ ...error, ruleIndex: i });
        }
        break;
      }

      for (const path of result.modified) {
        if (!allModified.includes(path)) {
          allModified.push(path);
        }
      }
      totalChanges += result.changes;
    }

    if (applyErrors.length > 0) {
      const first = applyErrors[0];
      const statusCode =
        first.code === 'INVALID_REGEX' || first.code === 'BATCH_ACTION_INVALID_OPTIONS' ? 400 : 500;

      res.status(statusCode).json({
        success: false,
        error: {
          message: first.error,
          code: first.code || 'TEMPLATE_APPLY_ERROR',
        },
        errors: applyErrors,
        backupId,
      });
      return;
    }

    res.json({
      success: true,
      modified: allModified,
      changes: totalChanges,
      backupId,
      rulesApplied: template.rules.length,
    });
  } catch (error) {
    logger.error(`Failed to apply template: ${req.params.id}`, error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to apply template',
        code: 'TEMPLATE_APPLY_ERROR',
      },
    });
  }
});

export default router;
