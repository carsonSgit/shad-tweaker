import { type Request, type Response, Router } from 'express';
import type { PlannerRuleInput } from '../services/planner.js';
import {
  applyResearch,
  getResearchArtifact,
  getResearchReport,
  listResearchRuns,
  logResearchError,
  planResearch,
  scanResearch,
  simulateResearch,
} from '../services/research.js';
import { validateResearchRunId } from '../utils/validation.js';

const router = Router();

router.get('/runs', async (_req: Request, res: Response) => {
  try {
    const runs = await listResearchRuns();
    res.json({ success: true, runs });
  } catch (error) {
    logResearchError('list runs', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to list research runs',
        code: 'RESEARCH_LIST_ERROR',
      },
    });
  }
});

router.post('/scan', async (req: Request, res: Response) => {
  try {
    const explicitPaths = Array.isArray(req.body?.paths)
      ? req.body.paths.filter((entry: unknown) => typeof entry === 'string')
      : [];
    const result = await scanResearch({ explicitPaths });
    res.json({
      success: true,
      runId: result.runId,
      componentGraph: result.componentGraph,
    });
  } catch (error) {
    logResearchError('scan', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to run research scan',
        code: 'RESEARCH_SCAN_ERROR',
      },
    });
  }
});

router.post('/plan', async (req: Request, res: Response) => {
  try {
    const runId = req.body?.runId as string | undefined;
    const goals = Array.isArray(req.body?.goals)
      ? req.body.goals.filter((entry: unknown) => typeof entry === 'string')
      : [];
    const customRules = Array.isArray(req.body?.customRules)
      ? (req.body.customRules as PlannerRuleInput[])
      : [];
    const maxFiles = typeof req.body?.maxFiles === 'number' ? req.body.maxFiles : undefined;
    const explicitPaths = Array.isArray(req.body?.paths)
      ? req.body.paths.filter((entry: unknown) => typeof entry === 'string')
      : [];

    if (goals.length === 0 && customRules.length === 0) {
      res.status(400).json({
        success: false,
        error: {
          message: 'At least one goal or custom rule is required',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    if (maxFiles !== undefined && (!Number.isInteger(maxFiles) || maxFiles < 1)) {
      res.status(400).json({
        success: false,
        error: {
          message: 'maxFiles must be a positive integer',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    const hasInvalidRule = customRules.some(
      (rule) =>
        typeof rule !== 'object' ||
        rule === null ||
        typeof rule.find !== 'string' ||
        typeof rule.replace !== 'string' ||
        typeof rule.isRegex !== 'boolean'
    );
    if (hasInvalidRule) {
      res.status(400).json({
        success: false,
        error: {
          message: 'customRules must contain { find, replace, isRegex } objects',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    if (runId) {
      const validation = validateResearchRunId(runId);
      if (!validation.valid) {
        res.status(400).json({
          success: false,
          error: {
            message: validation.error || 'Invalid run ID',
            code: 'INVALID_RESEARCH_RUN_ID',
          },
        });
        return;
      }
    }

    const result = await planResearch({
      runId,
      goals,
      customRules,
      maxFiles,
      explicitPaths,
    });

    res.json({
      success: true,
      runId: result.runId,
      plan: result.plan,
      safetyReport: result.safetyReport,
    });
  } catch (error) {
    logResearchError('plan', error);
    const message = error instanceof Error ? error.message : 'Failed to build research plan';
    const notFound = message.includes('not found');
    res.status(notFound ? 404 : 500).json({
      success: false,
      error: {
        message,
        code: notFound ? 'RESEARCH_RUN_NOT_FOUND' : 'RESEARCH_PLAN_ERROR',
      },
    });
  }
});

router.post('/simulate', async (req: Request, res: Response) => {
  try {
    const runId = req.body?.runId;
    if (!runId || typeof runId !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          message: 'runId is required',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    const validation = validateResearchRunId(runId);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: {
          message: validation.error || 'Invalid run ID',
          code: 'INVALID_RESEARCH_RUN_ID',
        },
      });
      return;
    }

    const result = await simulateResearch(runId);
    res.json({
      success: true,
      simulation: result,
    });
  } catch (error) {
    logResearchError('simulate', error);
    const message = error instanceof Error ? error.message : 'Failed to simulate research plan';
    const notFound = message.includes('not found');
    res.status(notFound ? 404 : 500).json({
      success: false,
      error: {
        message,
        code: notFound ? 'RESEARCH_RUN_NOT_FOUND' : 'RESEARCH_SIMULATE_ERROR',
      },
    });
  }
});

router.post('/apply', async (req: Request, res: Response) => {
  try {
    const runId = req.body?.runId;
    if (!runId || typeof runId !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          message: 'runId is required',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    const validation = validateResearchRunId(runId);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: {
          message: validation.error || 'Invalid run ID',
          code: 'INVALID_RESEARCH_RUN_ID',
        },
      });
      return;
    }

    const result = await applyResearch({
      runId,
      confirmHighRisk: req.body?.confirmHighRisk === true,
      expectedChecksum:
        typeof req.body?.expectedChecksum === 'string' ? req.body.expectedChecksum : undefined,
    });

    res.json({
      success: true,
      apply: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to apply research plan';
    const isClientError =
      message.includes('confirmation') ||
      message.includes('checksum mismatch') ||
      message.includes('not found');
    logResearchError('apply', error);
    const status = message.includes('not found') ? 404 : isClientError ? 400 : 500;
    res.status(status).json({
      success: false,
      error: {
        message,
        code: message.includes('not found')
          ? 'RESEARCH_RUN_NOT_FOUND'
          : isClientError
            ? 'RESEARCH_APPLY_VALIDATION_ERROR'
            : 'RESEARCH_APPLY_ERROR',
      },
    });
  }
});

router.get('/:runId/report', async (req: Request, res: Response) => {
  try {
    const { runId } = req.params;
    const validation = validateResearchRunId(runId);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: {
          message: validation.error || 'Invalid run ID',
          code: 'INVALID_RESEARCH_RUN_ID',
        },
      });
      return;
    }

    const format = req.query.format === 'md' ? 'md' : 'json';
    const report = await getResearchReport(runId, format);
    if (format === 'md') {
      res.type('text/markdown').send(report as string);
      return;
    }
    res.json({
      success: true,
      report,
    });
  } catch (error) {
    logResearchError('report', error);
    const message = error instanceof Error ? error.message : 'Failed to get research report';
    const notFound = message.includes('not found');
    res.status(notFound ? 404 : 500).json({
      success: false,
      error: {
        message,
        code: notFound ? 'RESEARCH_RUN_NOT_FOUND' : 'RESEARCH_REPORT_ERROR',
      },
    });
  }
});

router.get('/:runId/artifacts/:name', async (req: Request, res: Response) => {
  try {
    const { runId, name } = req.params;
    const validation = validateResearchRunId(runId);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: {
          message: validation.error || 'Invalid run ID',
          code: 'INVALID_RESEARCH_RUN_ID',
        },
      });
      return;
    }

    const artifact = await getResearchArtifact(runId, name);
    res.json({
      success: true,
      artifact,
    });
  } catch (error) {
    logResearchError('artifact', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch artifact';
    const isClientError = message.includes('not found') || message.includes('not allowed');
    res.status(isClientError ? 400 : 500).json({
      success: false,
      error: {
        message,
        code: isClientError ? 'RESEARCH_ARTIFACT_VALIDATION_ERROR' : 'RESEARCH_ARTIFACT_ERROR',
      },
    });
  }
});

export default router;
