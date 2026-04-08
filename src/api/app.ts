import express from 'express';
import { FeatureFlagService } from '../core/FeatureFlagService';
import { createFlagsRouter } from './routes/flags';
import { errorHandler } from './middleware/errorHandler';

export function createApp(service: FeatureFlagService): express.Application {
  const app = express();

  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/flags', createFlagsRouter(service));

  app.use(errorHandler);

  return app;
}
