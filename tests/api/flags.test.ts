import http from 'http';
import request from 'supertest';
import { createApp } from '../../src/api/app';
import { FeatureFlagService } from '../../src/core/FeatureFlagService';
import { IFeatureFlagRepository } from '../../src/core/IFeatureFlagRepository';
import { FeatureFlag, Override, CreateFlagInput, OverrideType } from '../../src/core/types';

// ── In-memory repository ─────────────────────────────────────────────────────

class InMemoryRepository implements IFeatureFlagRepository {
  private flags = new Map<string, Omit<FeatureFlag, 'overrides'>>();
  private overrides = new Map<string, Override>();
  private nextId = 1;

  async create(data: CreateFlagInput): Promise<FeatureFlag> {
    const flag: Omit<FeatureFlag, 'overrides'> = {
      id: this.nextId++,
      name: data.name,
      description: data.description ?? null,
      globalEnabled: data.globalEnabled ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.flags.set(flag.name, flag);
    return this.hydrate(flag);
  }

  async findByName(name: string): Promise<FeatureFlag | null> {
    const flag = this.flags.get(name);
    return flag ? this.hydrate(flag) : null;
  }

  async findAll(): Promise<FeatureFlag[]> {
    return Array.from(this.flags.values()).map(f => this.hydrate(f));
  }

  async update(
    name: string,
    data: Partial<Pick<FeatureFlag, 'globalEnabled' | 'description'>>,
  ): Promise<FeatureFlag> {
    const flag = this.flags.get(name)!;
    const updated = { ...flag, ...data, updatedAt: new Date() };
    this.flags.set(name, updated);
    return this.hydrate(updated);
  }

  async delete(name: string): Promise<void> {
    this.flags.delete(name);
    for (const [key, o] of this.overrides) {
      if (o.flagName === name) this.overrides.delete(key);
    }
  }

  async upsertOverride(
    flagName: string,
    type: OverrideType,
    targetId: string,
    enabled: boolean,
  ): Promise<Override> {
    const key = `${flagName}:${type}:${targetId}`;
    const existing = this.overrides.get(key);
    const override: Override = {
      id: existing?.id ?? this.nextId++,
      flagName,
      type,
      targetId,
      enabled,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.overrides.set(key, override);
    return override;
  }

  async deleteOverride(flagName: string, type: OverrideType, targetId: string): Promise<void> {
    this.overrides.delete(`${flagName}:${type}:${targetId}`);
  }

  private hydrate(flag: Omit<FeatureFlag, 'overrides'>): FeatureFlag {
    return {
      ...flag,
      overrides: Array.from(this.overrides.values()).filter(o => o.flagName === flag.name),
    };
  }
}

// ── Test helpers ─────────────────────────────────────────────────────────────

function buildApp() {
  const repo = new InMemoryRepository();
  const service = new FeatureFlagService(repo);
  return createApp(service);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Feature Flags API', () => {
  let server: http.Server;
  let app: ReturnType<typeof buildApp>;

  beforeEach(done => {
    app = buildApp();
    server = app.listen(0, done);
  });

  afterEach(done => {
    server.closeAllConnections();
    server.close(done);
  });

  // ── Health ──────────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns 200 ok', async () => {
      const res = await request(server).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  // ── Create flag ─────────────────────────────────────────────────────────

  describe('POST /api/flags', () => {
    it('creates a flag and returns 201', async () => {
      const res = await request(server)
        .post('/api/flags')
        .send({ name: 'dark-mode', description: 'Toggle dark theme', globalEnabled: true });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('dark-mode');
      expect(res.body.globalEnabled).toBe(true);
      expect(res.body.description).toBe('Toggle dark theme');
      expect(res.body.overrides).toEqual([]);
    });

    it('defaults globalEnabled to false when omitted', async () => {
      const res = await request(server).post('/api/flags').send({ name: 'my-flag' });
      expect(res.status).toBe(201);
      expect(res.body.globalEnabled).toBe(false);
    });

    it('returns 409 when flag already exists', async () => {
      await request(server).post('/api/flags').send({ name: 'dark-mode' });
      const res = await request(server).post('/api/flags').send({ name: 'dark-mode' });
      expect(res.status).toBe(409);
    });

    it('returns 400 when name contains invalid characters', async () => {
      const res = await request(server).post('/api/flags').send({ name: 'bad name!' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(server).post('/api/flags').send({ globalEnabled: true });
      expect(res.status).toBe(400);
    });

    it('returns 400 when name is empty string', async () => {
      const res = await request(server).post('/api/flags').send({ name: '' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for malformed JSON body', async () => {
      const res = await request(server)
        .post('/api/flags')
        .set('Content-Type', 'application/json')
        .send('{invalid json');
      expect(res.status).toBe(400);
    });
  });

  // ── List flags ──────────────────────────────────────────────────────────

  describe('GET /api/flags', () => {
    it('returns an empty array when no flags exist', async () => {
      const res = await request(server).get('/api/flags');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns all created flags', async () => {
      await request(server).post('/api/flags').send({ name: 'flag-a' });
      await request(server).post('/api/flags').send({ name: 'flag-b' });

      const res = await request(server).get('/api/flags');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });
  });

  // ── Get flag ────────────────────────────────────────────────────────────

  describe('GET /api/flags/:name', () => {
    it('returns the flag by name', async () => {
      await request(server).post('/api/flags').send({ name: 'dark-mode' });
      const res = await request(server).get('/api/flags/dark-mode');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('dark-mode');
    });

    it('returns 404 for a non-existent flag', async () => {
      const res = await request(server).get('/api/flags/nope');
      expect(res.status).toBe(404);
    });
  });

  // ── Update flag ─────────────────────────────────────────────────────────

  describe('PATCH /api/flags/:name', () => {
    it('updates the global state', async () => {
      await request(server).post('/api/flags').send({ name: 'dark-mode', globalEnabled: false });
      const res = await request(server)
        .patch('/api/flags/dark-mode')
        .send({ globalEnabled: true });
      expect(res.status).toBe(200);
      expect(res.body.globalEnabled).toBe(true);
    });

    it('updates the description', async () => {
      await request(server).post('/api/flags').send({ name: 'dark-mode' });
      const res = await request(server)
        .patch('/api/flags/dark-mode')
        .send({ description: 'Updated description' });
      expect(res.status).toBe(200);
      expect(res.body.description).toBe('Updated description');
    });

    it('returns 404 for a non-existent flag', async () => {
      const res = await request(server).patch('/api/flags/missing').send({ globalEnabled: true });
      expect(res.status).toBe(404);
    });

    it('returns 400 when body is empty', async () => {
      await request(server).post('/api/flags').send({ name: 'dark-mode' });
      const res = await request(server).patch('/api/flags/dark-mode').send({});
      expect(res.status).toBe(400);
    });
  });

  // ── Delete flag ─────────────────────────────────────────────────────────

  describe('DELETE /api/flags/:name', () => {
    it('deletes the flag and returns 204', async () => {
      await request(server).post('/api/flags').send({ name: 'dark-mode' });
      const res = await request(server).delete('/api/flags/dark-mode');
      expect(res.status).toBe(204);
    });

    it('makes the flag inaccessible after deletion', async () => {
      await request(server).post('/api/flags').send({ name: 'dark-mode' });
      await request(server).delete('/api/flags/dark-mode');
      const res = await request(server).get('/api/flags/dark-mode');
      expect(res.status).toBe(404);
    });

    it('returns 404 for a non-existent flag', async () => {
      const res = await request(server).delete('/api/flags/missing');
      expect(res.status).toBe(404);
    });
  });

  // ── Upsert override ─────────────────────────────────────────────────────

  describe('PUT /api/flags/:name/overrides', () => {
    beforeEach(() => request(server).post('/api/flags').send({ name: 'dark-mode' }));

    it('adds a user override', async () => {
      const res = await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'user', targetId: 'user-1', enabled: true });
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('user');
      expect(res.body.targetId).toBe('user-1');
      expect(res.body.enabled).toBe(true);
    });

    it('adds a group override', async () => {
      const res = await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'group', targetId: 'beta', enabled: true });
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('group');
    });

    it('adds a region override', async () => {
      const res = await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'region', targetId: 'us-east-1', enabled: true });
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('region');
    });

    it('updates an existing override', async () => {
      await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'user', targetId: 'user-1', enabled: true });
      const res = await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'user', targetId: 'user-1', enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });

    it('returns 404 for a non-existent flag', async () => {
      const res = await request(server)
        .put('/api/flags/missing/overrides')
        .send({ type: 'user', targetId: 'user-1', enabled: true });
      expect(res.status).toBe(404);
    });

    it('returns 400 for an invalid override type', async () => {
      const res = await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'department', targetId: 'eng', enabled: true });
      expect(res.status).toBe(400);
    });

    it('returns 400 when targetId is empty', async () => {
      const res = await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'user', targetId: '', enabled: true });
      expect(res.status).toBe(400);
    });

    it('returns 400 when enabled is missing', async () => {
      const res = await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'user', targetId: 'user-1' });
      expect(res.status).toBe(400);
    });
  });

  // ── Delete override ─────────────────────────────────────────────────────

  describe('DELETE /api/flags/:name/overrides/:type/:targetId', () => {
    beforeEach(async () => {
      await request(server).post('/api/flags').send({ name: 'dark-mode' });
      await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'user', targetId: 'user-1', enabled: true });
    });

    it('removes an existing override and returns 204', async () => {
      const res = await request(server).delete('/api/flags/dark-mode/overrides/user/user-1');
      expect(res.status).toBe(204);
    });

    it('makes the override absent from the flag after deletion', async () => {
      await request(server).delete('/api/flags/dark-mode/overrides/user/user-1');
      const res = await request(server).get('/api/flags/dark-mode');
      expect(res.body.overrides).toHaveLength(0);
    });

    it('returns 404 when override does not exist', async () => {
      const res = await request(server).delete('/api/flags/dark-mode/overrides/user/unknown');
      expect(res.status).toBe(404);
    });

    it('returns 400 for an invalid override type', async () => {
      const res = await request(server).delete('/api/flags/dark-mode/overrides/invalid/user-1');
      expect(res.status).toBe(400);
    });
  });

  // ── Evaluate ────────────────────────────────────────────────────────────

  describe('POST /api/flags/:name/evaluate', () => {
    beforeEach(() =>
      request(server).post('/api/flags').send({ name: 'dark-mode', globalEnabled: false }),
    );

    it('returns global default when no context is provided', async () => {
      const res = await request(server).post('/api/flags/dark-mode/evaluate').send({});
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect(res.body.reason).toBe('global_default');
      expect(res.body.flagName).toBe('dark-mode');
    });

    it('returns user override when userId matches', async () => {
      await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'user', targetId: 'user-1', enabled: true });

      const res = await request(server)
        .post('/api/flags/dark-mode/evaluate')
        .send({ userId: 'user-1' });
      expect(res.body.enabled).toBe(true);
      expect(res.body.reason).toBe('user_override');
    });

    it('returns group override when groupId matches', async () => {
      await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'group', targetId: 'beta', enabled: true });

      const res = await request(server)
        .post('/api/flags/dark-mode/evaluate')
        .send({ groupId: 'beta' });
      expect(res.body.enabled).toBe(true);
      expect(res.body.reason).toBe('group_override');
    });

    it('returns region override when region matches', async () => {
      await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'region', targetId: 'us-east-1', enabled: true });

      const res = await request(server)
        .post('/api/flags/dark-mode/evaluate')
        .send({ region: 'us-east-1' });
      expect(res.body.enabled).toBe(true);
      expect(res.body.reason).toBe('region_override');
    });

    it('user override takes priority over group override', async () => {
      await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'user', targetId: 'user-1', enabled: true });
      await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'group', targetId: 'beta', enabled: false });

      const res = await request(server)
        .post('/api/flags/dark-mode/evaluate')
        .send({ userId: 'user-1', groupId: 'beta' });
      expect(res.body.enabled).toBe(true);
      expect(res.body.reason).toBe('user_override');
    });

    it('group override takes priority over region override', async () => {
      await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'group', targetId: 'restricted', enabled: false });
      await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'region', targetId: 'us-east-1', enabled: true });

      const res = await request(server)
        .post('/api/flags/dark-mode/evaluate')
        .send({ groupId: 'restricted', region: 'us-east-1' });
      expect(res.body.enabled).toBe(false);
      expect(res.body.reason).toBe('group_override');
    });

    it('falls back to global default when context does not match any override', async () => {
      await request(server)
        .put('/api/flags/dark-mode/overrides')
        .send({ type: 'user', targetId: 'user-999', enabled: true });

      const res = await request(server)
        .post('/api/flags/dark-mode/evaluate')
        .send({ userId: 'user-1' });
      expect(res.body.enabled).toBe(false);
      expect(res.body.reason).toBe('global_default');
    });

    it('returns 404 for a non-existent flag', async () => {
      const res = await request(server).post('/api/flags/missing/evaluate').send({});
      expect(res.status).toBe(404);
    });
  });
});
