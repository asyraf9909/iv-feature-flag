import { Pool } from 'pg';
import { IFeatureFlagRepository } from '../core/IFeatureFlagRepository';
import { FeatureFlag, Override, CreateFlagInput, OverrideType } from '../core/types';

// ── Raw DB row shapes ───────────────────────────────────────────────────────

interface FlagRow {
  id: number;
  name: string;
  description: string | null;
  global_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

interface OverrideRow {
  id: number;
  flag_name: string;
  override_type: string;
  target_id: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

// ── Mappers ─────────────────────────────────────────────────────────────────

function toFlag(row: FlagRow, overrideRows: OverrideRow[]): FeatureFlag {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    globalEnabled: row.global_enabled,
    overrides: overrideRows.map(toOverride),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOverride(row: OverrideRow): Override {
  return {
    id: row.id,
    flagName: row.flag_name,
    type: row.override_type as OverrideType,
    targetId: row.target_id,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Repository ──────────────────────────────────────────────────────────────

export class PostgresFeatureFlagRepository implements IFeatureFlagRepository {
  constructor(private readonly db: Pool) {}

  async create(data: CreateFlagInput): Promise<FeatureFlag> {
    const { rows } = await this.db.query<FlagRow>(
      `INSERT INTO feature_flags (name, description, global_enabled)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.name, data.description ?? null, data.globalEnabled ?? false],
    );
    return toFlag(rows[0], []);
  }

  async findByName(name: string): Promise<FeatureFlag | null> {
    const { rows: flagRows } = await this.db.query<FlagRow>(
      'SELECT * FROM feature_flags WHERE name = $1',
      [name],
    );
    if (flagRows.length === 0) return null;

    const { rows: overrideRows } = await this.db.query<OverrideRow>(
      'SELECT * FROM overrides WHERE flag_name = $1',
      [name],
    );
    return toFlag(flagRows[0], overrideRows);
  }

  async findAll(): Promise<FeatureFlag[]> {
    const { rows: flagRows } = await this.db.query<FlagRow>(
      'SELECT * FROM feature_flags ORDER BY name',
    );
    if (flagRows.length === 0) return [];

    const names = flagRows.map(r => r.name);
    const { rows: overrideRows } = await this.db.query<OverrideRow>(
      'SELECT * FROM overrides WHERE flag_name = ANY($1)',
      [names],
    );

    return flagRows.map(flagRow => {
      const overrides = overrideRows.filter(o => o.flag_name === flagRow.name);
      return toFlag(flagRow, overrides);
    });
  }

  async update(
    name: string,
    data: Partial<Pick<FeatureFlag, 'globalEnabled' | 'description'>>,
  ): Promise<FeatureFlag> {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (data.globalEnabled !== undefined) {
      setClauses.push(`global_enabled = $${paramIdx++}`);
      values.push(data.globalEnabled);
    }
    if (data.description !== undefined) {
      setClauses.push(`description = $${paramIdx++}`);
      values.push(data.description);
    }

    values.push(name);
    const { rows } = await this.db.query<FlagRow>(
      `UPDATE feature_flags SET ${setClauses.join(', ')} WHERE name = $${paramIdx} RETURNING *`,
      values,
    );

    const { rows: overrideRows } = await this.db.query<OverrideRow>(
      'SELECT * FROM overrides WHERE flag_name = $1',
      [name],
    );
    return toFlag(rows[0], overrideRows);
  }

  async delete(name: string): Promise<void> {
    await this.db.query('DELETE FROM feature_flags WHERE name = $1', [name]);
  }

  async upsertOverride(
    flagName: string,
    type: OverrideType,
    targetId: string,
    enabled: boolean,
  ): Promise<Override> {
    const { rows } = await this.db.query<OverrideRow>(
      `INSERT INTO overrides (flag_name, override_type, target_id, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (flag_name, override_type, target_id)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
       RETURNING *`,
      [flagName, type, targetId, enabled],
    );
    return toOverride(rows[0]);
  }

  async deleteOverride(flagName: string, type: OverrideType, targetId: string): Promise<void> {
    await this.db.query(
      'DELETE FROM overrides WHERE flag_name = $1 AND override_type = $2 AND target_id = $3',
      [flagName, type, targetId],
    );
  }
}
