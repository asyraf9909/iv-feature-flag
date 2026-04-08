import { EvaluationEngine } from '../../src/core/EvaluationEngine';
import { FeatureFlag, Override } from '../../src/core/types';

// ── Factories ────────────────────────────────────────────────────────────────

const makeFlag = (overrides?: Partial<FeatureFlag>): FeatureFlag => ({
  id: 1,
  name: 'test-flag',
  description: null,
  globalEnabled: false,
  overrides: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeOverride = (
  partial: Pick<Override, 'type' | 'targetId' | 'enabled'> & Partial<Override>,
): Override => ({
  id: 1,
  flagName: 'test-flag',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...partial,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('EvaluationEngine', () => {
  let engine: EvaluationEngine;

  beforeEach(() => {
    engine = new EvaluationEngine();
  });

  describe('global default', () => {
    it('returns false for a globally disabled flag with no context', () => {
      const result = engine.evaluate(makeFlag({ globalEnabled: false }), {});
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('global_default');
    });

    it('returns true for a globally enabled flag with no context', () => {
      const result = engine.evaluate(makeFlag({ globalEnabled: true }), {});
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('global_default');
    });

    it('includes the flag name in the result', () => {
      const result = engine.evaluate(makeFlag({ name: 'my-feature', globalEnabled: true }), {});
      expect(result.flagName).toBe('my-feature');
    });

    it('uses global default when context provides no matching overrides', () => {
      const flag = makeFlag({ globalEnabled: true });
      expect(engine.evaluate(flag, { userId: 'user-1' }).reason).toBe('global_default');
    });

    it('defaults context to {} when omitted', () => {
      const result = engine.evaluate(makeFlag({ globalEnabled: true }));
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('global_default');
    });
  });

  describe('user overrides', () => {
    it('returns the user override when one exists', () => {
      const flag = makeFlag({
        globalEnabled: false,
        overrides: [makeOverride({ type: 'user', targetId: 'user-1', enabled: true })],
      });
      const result = engine.evaluate(flag, { userId: 'user-1' });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('user_override');
    });

    it('can disable a flag for a specific user while it is globally enabled', () => {
      const flag = makeFlag({
        globalEnabled: true,
        overrides: [makeOverride({ type: 'user', targetId: 'user-1', enabled: false })],
      });
      const result = engine.evaluate(flag, { userId: 'user-1' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('user_override');
    });

    it('does not apply another user\'s override', () => {
      const flag = makeFlag({
        globalEnabled: false,
        overrides: [makeOverride({ type: 'user', targetId: 'user-2', enabled: true })],
      });
      const result = engine.evaluate(flag, { userId: 'user-1' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('global_default');
    });

    it('ignores a user override when userId is undefined', () => {
      const flag = makeFlag({
        globalEnabled: false,
        overrides: [makeOverride({ type: 'user', targetId: 'user-1', enabled: true })],
      });
      const result = engine.evaluate(flag, { userId: undefined });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('global_default');
    });
  });

  describe('group overrides', () => {
    it('returns the group override when one exists', () => {
      const flag = makeFlag({
        globalEnabled: false,
        overrides: [makeOverride({ type: 'group', targetId: 'beta-users', enabled: true })],
      });
      const result = engine.evaluate(flag, { groupId: 'beta-users' });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('group_override');
    });

    it('falls back to global when no matching group override', () => {
      const flag = makeFlag({
        globalEnabled: true,
        overrides: [makeOverride({ type: 'group', targetId: 'other-group', enabled: false })],
      });
      const result = engine.evaluate(flag, { groupId: 'beta-users' });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('global_default');
    });
  });

  describe('region overrides (Phase 2)', () => {
    it('returns the region override when one exists', () => {
      const flag = makeFlag({
        globalEnabled: false,
        overrides: [makeOverride({ type: 'region', targetId: 'us-east-1', enabled: true })],
      });
      const result = engine.evaluate(flag, { region: 'us-east-1' });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('region_override');
    });

    it('falls back to global when no matching region override', () => {
      const flag = makeFlag({
        globalEnabled: true,
        overrides: [makeOverride({ type: 'region', targetId: 'eu-west-1', enabled: false })],
      });
      const result = engine.evaluate(flag, { region: 'us-east-1' });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('global_default');
    });
  });

  describe('override precedence', () => {
    it('user override beats group override', () => {
      const flag = makeFlag({
        globalEnabled: false,
        overrides: [
          makeOverride({ id: 1, type: 'user', targetId: 'user-1', enabled: true }),
          makeOverride({ id: 2, type: 'group', targetId: 'restricted', enabled: false }),
        ],
      });
      const result = engine.evaluate(flag, { userId: 'user-1', groupId: 'restricted' });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('user_override');
    });

    it('user override beats region override', () => {
      const flag = makeFlag({
        globalEnabled: false,
        overrides: [
          makeOverride({ id: 1, type: 'user', targetId: 'user-1', enabled: true }),
          makeOverride({ id: 2, type: 'region', targetId: 'us-east-1', enabled: false }),
        ],
      });
      const result = engine.evaluate(flag, { userId: 'user-1', region: 'us-east-1' });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('user_override');
    });

    it('group override beats region override', () => {
      const flag = makeFlag({
        globalEnabled: true,
        overrides: [
          makeOverride({ id: 1, type: 'group', targetId: 'restricted', enabled: false }),
          makeOverride({ id: 2, type: 'region', targetId: 'us-east-1', enabled: true }),
        ],
      });
      const result = engine.evaluate(flag, { groupId: 'restricted', region: 'us-east-1' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('group_override');
    });

    it('group override beats global default', () => {
      const flag = makeFlag({
        globalEnabled: true,
        overrides: [makeOverride({ type: 'group', targetId: 'restricted', enabled: false })],
      });
      const result = engine.evaluate(flag, { groupId: 'restricted' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('group_override');
    });

    it('region override beats global default', () => {
      const flag = makeFlag({
        globalEnabled: false,
        overrides: [makeOverride({ type: 'region', targetId: 'eu-west-1', enabled: true })],
      });
      const result = engine.evaluate(flag, { region: 'eu-west-1' });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('region_override');
    });

    it('returns global default when context fields are all undefined', () => {
      const flag = makeFlag({ globalEnabled: true });
      const result = engine.evaluate(flag, {
        userId: undefined,
        groupId: undefined,
        region: undefined,
      });
      expect(result.reason).toBe('global_default');
    });
  });

  describe('multiple overrides of same type', () => {
    it('only matches the correct user from multiple user overrides', () => {
      const flag = makeFlag({
        globalEnabled: false,
        overrides: [
          makeOverride({ id: 1, type: 'user', targetId: 'user-A', enabled: true }),
          makeOverride({ id: 2, type: 'user', targetId: 'user-B', enabled: false }),
        ],
      });
      expect(engine.evaluate(flag, { userId: 'user-A' }).enabled).toBe(true);
      expect(engine.evaluate(flag, { userId: 'user-B' }).enabled).toBe(false);
    });
  });
});
