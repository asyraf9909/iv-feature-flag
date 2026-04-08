import path from 'path';
import express from 'express';
import { FeatureFlagService } from '../core/FeatureFlagService';
import { createFlagsRouter } from './routes/flags';
import { errorHandler } from './middleware/errorHandler';

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

export function createApp(service: FeatureFlagService): express.Application {
  const app = express();

  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/flags', createFlagsRouter(service));

  app.use(errorHandler);

  return app;
}
