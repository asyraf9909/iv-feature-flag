import { IFeatureFlagRepository } from './IFeatureFlagRepository';
import { EvaluationEngine } from './EvaluationEngine';
import { NotFoundError, ConflictError, ValidationError } from './errors';
import {
  FeatureFlag,
  Override,
  CreateFlagInput,
  UpdateFlagInput,
  OverrideType,
  EvaluationContext,
  EvaluationResult,
  UpsertOverrideInput,
} from './types';

// Re-export errors so callers have a single import point
export { NotFoundError, ConflictError, ValidationError };

const FLAG_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** TTL for the in-process flag cache (Phase 2 performance). */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  flag: FeatureFlag;
  expiresAt: number;
}

/**
 * Application service that orchestrates the repository and the evaluation engine.
 * Owns the in-process TTL cache so that the hot evaluation path avoids DB round-trips.
 */
export class FeatureFlagService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly engine: EvaluationEngine;

  constructor(
    private readonly repository: IFeatureFlagRepository,
    engine?: EvaluationEngine,
  ) {
    this.engine = engine ?? new EvaluationEngine();
  }

  async createFlag(input: CreateFlagInput): Promise<FeatureFlag> {
    this.validateName(input.name);

    const existing = await this.repository.findByName(input.name);
    if (existing !== null) {
      throw new ConflictError(`Feature flag '${input.name}' already exists`);
    }

    const flag = await this.repository.create(input);
    this.setCache(flag);
    return flag;
  }

  async getFlag(name: string): Promise<FeatureFlag> {
    const cached = this.getCache(name);
    if (cached !== null) return cached;

    const flag = await this.repository.findByName(name);
    if (flag === null) throw new NotFoundError(`Feature flag '${name}' not found`);

    this.setCache(flag);
    return flag;
  }

  async listFlags(): Promise<FeatureFlag[]> {
    return this.repository.findAll();
  }

  async updateFlag(name: string, input: UpdateFlagInput): Promise<FeatureFlag> {
    const hasChanges = input.globalEnabled !== undefined || input.description !== undefined;
    if (!hasChanges) {
      throw new ValidationError('No update fields provided');
    }

    const exists = await this.repository.findByName(name);
    if (exists === null) throw new NotFoundError(`Feature flag '${name}' not found`);

    const updated = await this.repository.update(name, input);
    this.setCache(updated);
    return updated;
  }

  async deleteFlag(name: string): Promise<void> {
    const exists = await this.repository.findByName(name);
    if (exists === null) throw new NotFoundError(`Feature flag '${name}' not found`);

    await this.repository.delete(name);
    this.cache.delete(name);
  }

  async upsertOverride(flagName: string, input: UpsertOverrideInput): Promise<Override> {
    const flag = await this.repository.findByName(flagName);
    if (flag === null) throw new NotFoundError(`Feature flag '${flagName}' not found`);

    const override = await this.repository.upsertOverride(
      flagName,
      input.type,
      input.targetId,
      input.enabled,
    );
    this.cache.delete(flagName); // invalidate so next read is fresh
    return override;
  }

  async deleteOverride(flagName: string, type: OverrideType, targetId: string): Promise<void> {
    const flag = await this.repository.findByName(flagName);
    if (flag === null) throw new NotFoundError(`Feature flag '${flagName}' not found`);

    const exists = flag.overrides.some(o => o.type === type && o.targetId === targetId);
    if (!exists) {
      throw new NotFoundError(`Override of type '${type}' for '${targetId}' not found on flag '${flagName}'`);
    }

    await this.repository.deleteOverride(flagName, type, targetId);
    this.cache.delete(flagName);
  }

  async evaluate(flagName: string, context: EvaluationContext): Promise<EvaluationResult> {
    const flag = await this.getFlag(flagName);
    return this.engine.evaluate(flag, context);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private validateName(name: string): void {
    if (!FLAG_NAME_PATTERN.test(name)) {
      throw new ValidationError(
        'Flag name may only contain letters, numbers, underscores, and hyphens',
      );
    }
  }

  private getCache(name: string): FeatureFlag | null {
    const entry = this.cache.get(name);
    if (entry === undefined) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(name);
      return null;
    }
    return entry.flag;
  }

  private setCache(flag: FeatureFlag): void {
    this.cache.set(flag.name, { flag, expiresAt: Date.now() + CACHE_TTL_MS });
  }
}
