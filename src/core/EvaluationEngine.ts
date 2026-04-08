import { FeatureFlag, EvaluationContext, EvaluationResult } from './types';

/**
 * Stateless evaluation engine — pure function over domain objects.
 * No I/O, no side effects. Can be unit tested in isolation.
 *
 * Precedence (highest → lowest):
 *   1. User-level override
 *   2. Group-level override
 *   3. Region-level override  (Phase 2)
 *   4. Global default
 */
export class EvaluationEngine {
  evaluate(flag: FeatureFlag, context: EvaluationContext = {}): EvaluationResult {
    const { userId, groupId, region } = context;

    if (userId !== undefined) {
      const match = flag.overrides.find(o => o.type === 'user' && o.targetId === userId);
      if (match !== undefined) {
        return { flagName: flag.name, enabled: match.enabled, reason: 'user_override' };
      }
    }

    if (groupId !== undefined) {
      const match = flag.overrides.find(o => o.type === 'group' && o.targetId === groupId);
      if (match !== undefined) {
        return { flagName: flag.name, enabled: match.enabled, reason: 'group_override' };
      }
    }

    if (region !== undefined) {
      const match = flag.overrides.find(o => o.type === 'region' && o.targetId === region);
      if (match !== undefined) {
        return { flagName: flag.name, enabled: match.enabled, reason: 'region_override' };
      }
    }

    return { flagName: flag.name, enabled: flag.globalEnabled, reason: 'global_default' };
  }
}
