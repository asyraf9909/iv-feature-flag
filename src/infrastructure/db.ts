import { Pool } from 'pg';

let pool: Pool | null = null;

export function getDb(): Pool {
  if (pool === null) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool !== null) {
    await pool.end();
    pool = null;
  }
}
