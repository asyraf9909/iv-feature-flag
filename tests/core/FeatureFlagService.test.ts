import { FeatureFlagService, NotFoundError, ConflictError, ValidationError } from '../../src/core/FeatureFlagService';
import { IFeatureFlagRepository } from '../../src/core/IFeatureFlagRepository';
import { FeatureFlag, Override } from '../../src/core/types';

// ── Factories ────────────────────────────────────────────────────────────────

const makeFlag = (overrides?: Partial<FeatureFlag>): FeatureFlag => ({
  id: 1,
  name: 'dark-mode',
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
  flagName: 'dark-mode',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...partial,
});

function mockRepo(partial?: Partial<IFeatureFlagRepository>): IFeatureFlagRepository {
  return {
    create: jest.fn(),
    findByName: jest.fn().mockResolvedValue(null),
    findAll: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
    upsertOverride: jest.fn(),
    deleteOverride: jest.fn().mockResolvedValue(undefined),
    ...partial,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FeatureFlagService', () => {
  describe('createFlag', () => {
    it('creates a flag with valid input', async () => {
      const flag = makeFlag();
      const repo = mockRepo({
        findByName: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(flag),
      });
      const service = new FeatureFlagService(repo);

      await expect(service.createFlag({ name: 'dark-mode' })).resolves.toEqual(flag);
      expect(repo.create).toHaveBeenCalledWith({ name: 'dark-mode' });
    });

    it('throws ConflictError when flag name already exists', async () => {
      const repo = mockRepo({ findByName: jest.fn().mockResolvedValue(makeFlag()) });
      const service = new FeatureFlagService(repo);

      await expect(service.createFlag({ name: 'dark-mode' })).rejects.toThrow(ConflictError);
    });

    it('throws ValidationError for a name with spaces', async () => {
      const service = new FeatureFlagService(mockRepo());
      await expect(service.createFlag({ name: 'has spaces' })).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for a name with special characters', async () => {
      const service = new FeatureFlagService(mockRepo());
      await expect(service.createFlag({ name: 'flag!' })).rejects.toThrow(ValidationError);
    });

    it('accepts names with underscores and hyphens', async () => {
      const flag = makeFlag({ name: 'my_feature-flag' });
      const repo = mockRepo({
        findByName: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(flag),
      });
      const service = new FeatureFlagService(repo);
      await expect(service.createFlag({ name: 'my_feature-flag' })).resolves.toBeDefined();
    });

    it('does not call repository when name is invalid', async () => {
      const repo = mockRepo();
      const service = new FeatureFlagService(repo);
      await expect(service.createFlag({ name: 'bad name!' })).rejects.toThrow();
      expect(repo.findByName).not.toHaveBeenCalled();
    });
  });

  describe('getFlag', () => {
    it('returns the flag when it exists', async () => {
      const flag = makeFlag();
      const repo = mockRepo({ findByName: jest.fn().mockResolvedValue(flag) });
      const service = new FeatureFlagService(repo);

      await expect(service.getFlag('dark-mode')).resolves.toEqual(flag);
    });

    it('throws NotFoundError when flag does not exist', async () => {
      const repo = mockRepo({ findByName: jest.fn().mockResolvedValue(null) });
      const service = new FeatureFlagService(repo);

      await expect(service.getFlag('missing')).rejects.toThrow(NotFoundError);
    });

    it('returns cached result on second call without hitting the DB', async () => {
      const flag = makeFlag();
      const findByName = jest.fn().mockResolvedValue(flag);
      const service = new FeatureFlagService(mockRepo({ findByName }));

      await service.getFlag('dark-mode');
      await service.getFlag('dark-mode');

      expect(findByName).toHaveBeenCalledTimes(1);
    });
  });

  describe('listFlags', () => {
    it('returns all flags from the repository', async () => {
      const flags = [makeFlag({ name: 'flag-a' }), makeFlag({ name: 'flag-b', id: 2 })];
      const repo = mockRepo({ findAll: jest.fn().mockResolvedValue(flags) });
      const service = new FeatureFlagService(repo);

      await expect(service.listFlags()).resolves.toEqual(flags);
    });
  });

  describe('updateFlag', () => {
    it('updates the flag when valid input is provided', async () => {
      const updated = makeFlag({ globalEnabled: true });
      const repo = mockRepo({
        findByName: jest.fn().mockResolvedValue(makeFlag()),
        update: jest.fn().mockResolvedValue(updated),
      });
      const service = new FeatureFlagService(repo);

      await expect(service.updateFlag('dark-mode', { globalEnabled: true })).resolves.toEqual(updated);
    });

    it('throws NotFoundError when flag does not exist', async () => {
      const repo = mockRepo({ findByName: jest.fn().mockResolvedValue(null) });
      const service = new FeatureFlagService(repo);

      await expect(service.updateFlag('missing', { globalEnabled: true })).rejects.toThrow(NotFoundError);
    });

    it('throws ValidationError when no update fields are provided', async () => {
      const repo = mockRepo({ findByName: jest.fn().mockResolvedValue(makeFlag()) });
      const service = new FeatureFlagService(repo);

      await expect(service.updateFlag('dark-mode', {})).rejects.toThrow(ValidationError);
    });

    it('invalidates cache after update', async () => {
      const original = makeFlag({ globalEnabled: false });
      const updated = makeFlag({ globalEnabled: true });
      const findByName = jest.fn()
        .mockResolvedValueOnce(original) // update check
        .mockResolvedValueOnce(updated); // post-cache-bust read

      const repo = mockRepo({
        findByName,
        update: jest.fn().mockResolvedValue(updated),
      });
      const service = new FeatureFlagService(repo);

      // Warm the cache
      await service.getFlag('dark-mode');
      // Update clears cache and writes updated flag
      await service.updateFlag('dark-mode', { globalEnabled: true });
      // Read should return updated value from cache immediately
      const result = await service.getFlag('dark-mode');
      expect(result.globalEnabled).toBe(true);
    });
  });

  describe('deleteFlag', () => {
    it('deletes the flag successfully', async () => {
      const repo = mockRepo({ findByName: jest.fn().mockResolvedValue(makeFlag()) });
      const service = new FeatureFlagService(repo);

      await service.deleteFlag('dark-mode');
      expect(repo.delete).toHaveBeenCalledWith('dark-mode');
    });

    it('throws NotFoundError when flag does not exist', async () => {
      const repo = mockRepo({ findByName: jest.fn().mockResolvedValue(null) });
      const service = new FeatureFlagService(repo);

      await expect(service.deleteFlag('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('upsertOverride', () => {
    it('creates an override for an existing flag', async () => {
      const override = makeOverride({ type: 'user', targetId: 'user-1', enabled: true });
      const repo = mockRepo({
        findByName: jest.fn().mockResolvedValue(makeFlag()),
        upsertOverride: jest.fn().mockResolvedValue(override),
      });
      const service = new FeatureFlagService(repo);

      await expect(
        service.upsertOverride('dark-mode', { type: 'user', targetId: 'user-1', enabled: true }),
      ).resolves.toEqual(override);
    });

    it('throws NotFoundError when flag does not exist', async () => {
      const repo = mockRepo({ findByName: jest.fn().mockResolvedValue(null) });
      const service = new FeatureFlagService(repo);

      await expect(
        service.upsertOverride('missing', { type: 'user', targetId: 'user-1', enabled: true }),
      ).rejects.toThrow(NotFoundError);
    });

    it('invalidates cache after upsert', async () => {
      const findByName = jest.fn().mockResolvedValue(makeFlag());
      const repo = mockRepo({
        findByName,
        upsertOverride: jest.fn().mockResolvedValue(makeOverride({ type: 'user', targetId: 'u', enabled: true })),
      });
      const service = new FeatureFlagService(repo);

      await service.getFlag('dark-mode'); // warm cache
      expect(findByName).toHaveBeenCalledTimes(1);

      await service.upsertOverride('dark-mode', { type: 'user', targetId: 'u', enabled: true });

      await service.getFlag('dark-mode'); // should hit DB again after invalidation
      expect(findByName).toHaveBeenCalledTimes(3); // initial + upsert check + post-invalidation get
    });
  });

  describe('deleteOverride', () => {
    it('deletes an existing override', async () => {
      const flag = makeFlag({
        overrides: [makeOverride({ type: 'user', targetId: 'user-1', enabled: true })],
      });
      const repo = mockRepo({ findByName: jest.fn().mockResolvedValue(flag) });
      const service = new FeatureFlagService(repo);

      await service.deleteOverride('dark-mode', 'user', 'user-1');
      expect(repo.deleteOverride).toHaveBeenCalledWith('dark-mode', 'user', 'user-1');
    });

    it('throws NotFoundError when flag does not exist', async () => {
      const repo = mockRepo({ findByName: jest.fn().mockResolvedValue(null) });
      const service = new FeatureFlagService(repo);

      await expect(service.deleteOverride('missing', 'user', 'user-1')).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when the specific override does not exist', async () => {
      const repo = mockRepo({ findByName: jest.fn().mockResolvedValue(makeFlag()) });
      const service = new FeatureFlagService(repo);

      await expect(service.deleteOverride('dark-mode', 'user', 'user-1')).rejects.toThrow(NotFoundError);
    });
  });

  describe('evaluate', () => {
    it('delegates to the evaluation engine with the flag and context', async () => {
      const flag = makeFlag({
        globalEnabled: false,
        overrides: [makeOverride({ type: 'user', targetId: 'user-1', enabled: true })],
      });
      const repo = mockRepo({ findByName: jest.fn().mockResolvedValue(flag) });
      const service = new FeatureFlagService(repo);

      const result = await service.evaluate('dark-mode', { userId: 'user-1' });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('user_override');
    });

    it('throws NotFoundError when flag does not exist', async () => {
      const repo = mockRepo({ findByName: jest.fn().mockResolvedValue(null) });
      const service = new FeatureFlagService(repo);

      await expect(service.evaluate('missing', {})).rejects.toThrow(NotFoundError);
    });
  });
});
