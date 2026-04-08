import { Pool } from 'pg';

export async function runMigrations(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS feature_flags (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(255) UNIQUE NOT NULL,
      description TEXT,
      global_enabled BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS overrides (
      id            SERIAL PRIMARY KEY,
      flag_name     VARCHAR(255) NOT NULL
                      REFERENCES feature_flags(name) ON DELETE CASCADE,
      override_type VARCHAR(50)  NOT NULL,
      target_id     VARCHAR(255) NOT NULL,
      enabled       BOOLEAN      NOT NULL,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      UNIQUE(flag_name, override_type, target_id)
    );

    CREATE INDEX IF NOT EXISTS idx_overrides_flag_name ON overrides(flag_name);
  `);
}
