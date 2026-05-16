import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import backendPackage from '../package.json' with { type: 'json' };
import backupRouter from './routes/backup.js';
import componentsRouter from './routes/components.js';
import editRouter from './routes/edit.js';
import importsRouter from './routes/imports.js';
import parserRouter from './routes/parser.js';
import primitiveStartersRouter from './routes/primitiveStarters.js';
import studioRouter from './routes/studio.js';
import templatesRouter from './routes/templates.js';
import tokensRouter from './routes/tokens.js';
import variantsRouter from './routes/variants.js';
import workspaceRouter from './routes/workspace.js';
import { initializeDefaultTemplates } from './services/template.js';
import { initializeWorkspace } from './services/workspace.js';
import { logger } from './utils/logger.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const studioDistPath = path.join(__dirname, 'studio');

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createStudioAssetLimiter(
  max = readPositiveInteger(process.env.STUDIO_ASSET_RATE_LIMIT_PER_MINUTE, 1000)
) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        message: 'Too many studio asset requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
    },
  });
}

const studioAssetLimiter = createStudioAssetLimiter();

// CORS configuration - restrict to local development
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Request size limits to prevent DoS attacks
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: backendPackage.version,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/components', componentsRouter);
app.use('/api/edit', editRouter);
app.use('/api/backup', backupRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/workspace', workspaceRouter);
app.use('/api/parser', parserRouter);
app.use('/api/imports', importsRouter);
app.use('/api/primitive-starters', primitiveStartersRouter);
app.use('/api/tokens', tokensRouter);
app.use('/api/variants', variantsRouter);
app.use('/api/studio', studioRouter);

// Serve built browser studio assets first, then fall back to index.html for SPA routes.
app.use('/studio', studioAssetLimiter);
app.use('/studio', express.static(studioDistPath));
app.get(['/studio', '/studio/*'], (_req, res) => {
  res.sendFile(path.join(studioDistPath, 'index.html'), (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Studio browser assets are not built. Run the web build first.',
          code: 'STUDIO_ASSETS_MISSING',
        },
      });
    }
  });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({
    success: false,
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    },
  });
});

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Endpoint not found',
      code: 'NOT_FOUND',
    },
  });
});

async function start() {
  try {
    await initializeDefaultTemplates();
    const { manifest } = await initializeWorkspace();
    const port = process.env.PORT || manifest.config.port;

    if (process.env.PORT) {
      logger.info(
        `PORT environment variable (${process.env.PORT}) overrides workspace manifest port (${manifest.config.port})`
      );
    }

    app.listen(port, () => {
      logger.info(`Shadcn Tweaker Backend running on http://localhost:${port}`);
      logger.info('Available endpoints:');
      logger.info('  GET  /api/components/scan - Scan for components');
      logger.info('  GET  /api/components - List all components');
      logger.info('  GET  /api/components/:name - Get component details');
      logger.info('  POST /api/edit/preview - Preview changes');
      logger.info('  POST /api/edit/apply - Apply changes');
      logger.info('  POST /api/edit/batch-action - Apply batch action');
      logger.info('  POST /api/parser/analyze - Analyze component structure');
      logger.info('  POST /api/imports/plan - Generate import plan');
      logger.info('  POST /api/imports/apply - Apply approved import plan');
      logger.info('  GET  /api/primitive-starters - List primitive starter templates');
      logger.info('  POST /api/primitive-starters/preview - Preview primitive starter files');
      logger.info('  POST /api/primitive-starters/apply - Apply primitive starter files');
      logger.info('  GET  /api/tokens/sets - List design token sets');
      logger.info('  POST /api/tokens/sets - Create design token set');
      logger.info('  GET  /api/tokens/sets/:id - Get design token set');
      logger.info('  PUT  /api/tokens/sets/:id - Update design token set');
      logger.info('  DELETE /api/tokens/sets/:id - Delete design token set');
      logger.info('  POST /api/tokens/extract - Extract token candidates');
      logger.info('  GET  /api/tokens/reports/frequency - Report token frequency');
      logger.info('  GET  /api/tokens/reports/inconsistencies - Report token inconsistencies');
      logger.info('  POST /api/tokens/patch/preview - Preview token patch');
      logger.info('  POST /api/tokens/patch/apply - Apply token patch');
      logger.info('  GET  /api/tokens/components/overrides - Get token overrides');
      logger.info('  PUT  /api/tokens/components/overrides - Update token overrides');
      logger.info('  GET  /api/variants/components - List component variant summaries');
      logger.info('  GET  /api/variants/components/:identifier - Get component variant detail');
      logger.info('  POST /api/variants/preview - Preview variant generation');
      logger.info('  GET  /api/templates - List templates');
      logger.info('  POST /api/templates - Create template');
      logger.info('  DELETE /api/templates/:id - Delete template');
      logger.info('  POST /api/backup/create - Create backup');
      logger.info('  GET  /api/backup/list - List backups');
      logger.info('  POST /api/backup/restore - Restore backup');
      logger.info('  GET  /api/workspace - Get workspace manifest');
      logger.info('  POST /api/workspace/initialize - Initialize workspace manifest');
      logger.info('  PUT  /api/workspace/config - Update workspace config');
      logger.info('  GET  /api/workspace/registry-sources - List registry sources');
      logger.info('  GET  /api/workspace/registry-sources/health - Check registry source health');
      logger.info('  POST /api/workspace/registry-sources - Create or update registry source');
      logger.info('  DELETE /api/workspace/registry-sources/:id - Delete registry source');
      logger.info('  GET  /api/workspace/registry-items - List registry items');
      logger.info('  GET  /api/workspace/registry-items/:itemName - Find registry item by name');
      logger.info('  GET  /api/workspace/registry-items/:sourceId/:itemName - Fetch registry item');
      logger.info('  GET  /api/studio/summary - Get local studio summary');
      logger.info('  GET  /studio - Open browser studio shell');
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  start();
}

export { app };
