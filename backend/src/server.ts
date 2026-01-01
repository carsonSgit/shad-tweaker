import express from 'express';
import cors from 'cors';
import componentsRouter from './routes/components.js';
import editRouter from './routes/edit.js';
import backupRouter from './routes/backup.js';
import templatesRouter from './routes/templates.js';
import { initializeDefaultTemplates } from './services/template.js';
import { logger } from './utils/logger.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/components', componentsRouter);
app.use('/api/edit', editRouter);
app.use('/api/backup', backupRouter);
app.use('/api/templates', templatesRouter);

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

    app.listen(PORT, () => {
      logger.info(`Shadcn Tweaker Backend running on http://localhost:${PORT}`);
      logger.info('Available endpoints:');
      logger.info('  GET  /api/components/scan - Scan for components');
      logger.info('  GET  /api/components - List all components');
      logger.info('  GET  /api/components/:name - Get component details');
      logger.info('  POST /api/edit/preview - Preview changes');
      logger.info('  POST /api/edit/apply - Apply changes');
      logger.info('  POST /api/edit/batch-action - Apply batch action');
      logger.info('  GET  /api/templates - List templates');
      logger.info('  POST /api/templates - Create template');
      logger.info('  DELETE /api/templates/:id - Delete template');
      logger.info('  POST /api/backup/create - Create backup');
      logger.info('  GET  /api/backup/list - List backups');
      logger.info('  POST /api/backup/restore - Restore backup');
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

start();
