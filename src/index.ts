import 'dotenv/config';
import { getDb, closeDb } from './infrastructure/db';
import { runMigrations } from './infrastructure/migrations';
import { PostgresFeatureFlagRepository } from './infrastructure/PostgresFeatureFlagRepository';
import { FeatureFlagService } from './core/FeatureFlagService';
import { createApp } from './api/app';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('Fatal: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const db = getDb();
  await runMigrations(db);

  const repository = new PostgresFeatureFlagRepository(db);
  const service = new FeatureFlagService(repository);
  const app = createApp(service);

  const server = app.listen(PORT, () => {
    console.log(`Feature Flag Engine listening on port ${PORT}`);
  });

  const shutdown = async (): Promise<void> => {
    server.close();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
