import fs from 'fs-extra';
import { type Request, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { parseComponentFile, resolveProjectParserPath } from '../services/parser.js';
import { getWorkingDirectory } from '../services/workspace.js';
import { logger } from '../utils/logger.js';

const router = Router();

const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      message: 'Too many analyze requests. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
    },
  },
});

interface AnalyzeRequest {
  filePath?: unknown;
}

router.post('/analyze', analyzeLimiter, async (req: Request, res: Response) => {
  try {
    const { filePath } = req.body as AnalyzeRequest;

    if (typeof filePath !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          message: 'filePath must be a string.',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    const resolvedPath = resolveProjectParserPath(filePath, getWorkingDirectory());
    if (!resolvedPath) {
      res.status(400).json({
        success: false,
        error: {
          message: 'filePath must point to a TSX/JSX file inside the project.',
          code: 'INVALID_FILE_PATH',
        },
      });
      return;
    }

    if (!(await fs.pathExists(resolvedPath))) {
      res.status(404).json({
        success: false,
        error: {
          message: 'File not found.',
          code: 'FILE_NOT_FOUND',
        },
      });
      return;
    }

    const parsed = await parseComponentFile(resolvedPath);
    res.json({ success: true, parsed });
  } catch (error) {
    logger.error('Failed to analyze component file', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to analyze component file',
        code: 'PARSER_ANALYZE_ERROR',
      },
    });
  }
});

export default router;
