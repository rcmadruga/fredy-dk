/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import Fastify from 'fastify';

import { up } from '../../lib/services/storage/migrations/sql/52.job-score-config.js';

let db;

vi.mock('../../lib/services/storage/SqliteConnection.js', () => ({
  default: {
    query: (sql, params = {}) => db.prepare(sql).all(params),
    execute: (sql, params = {}) => db.prepare(sql).run(params),
    withTransaction: (cb) => db.transaction(() => cb(db))(),
  },
}));

vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: async () => ({ demoMode: false }),
  upsertSettings: () => {},
}));

const ALICE = { id: 'u1', username: 'alice', isAdmin: false };

const JOBS_WITHOUT_SCORE = `
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY, user_id TEXT, enabled INTEGER DEFAULT 1, name TEXT, blacklist TEXT, provider TEXT,
    notification_adapter TEXT, shared_with_user TEXT DEFAULT '[]', spatial_filter TEXT, spec_filter TEXT,
    commute_filter TEXT, deal_type TEXT, last_run_at INTEGER
  );
`;

describe('migration 52 - score_config on jobs', () => {
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(JOBS_WITHOUT_SCORE);
  });

  afterEach(() => db.close());

  const columns = () =>
    db
      .prepare(`PRAGMA table_info(jobs)`)
      .all()
      .map((c) => c.name);

  it('adds a nullable column', () => {
    up(db);
    expect(columns()).toContain('score_config');
    db.prepare(`INSERT INTO jobs (id) VALUES ('j1')`).run();
    expect(db.prepare(`SELECT score_config FROM jobs`).get().score_config).toBeNull();
  });

  it('leaves every existing job on the defaults', () => {
    db.prepare(`INSERT INTO jobs (id, name) VALUES ('old', 'Old job')`).run();
    up(db);
    expect(db.prepare(`SELECT score_config FROM jobs WHERE id = 'old'`).get().score_config).toBeNull();
  });

  it('can run twice', () => {
    up(db);
    expect(() => up(db)).not.toThrow();
    expect(columns().filter((name) => name === 'score_config')).toHaveLength(1);
  });
});

describe('score_config through jobStorage and POST /api/jobs', () => {
  let app;
  let storage;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(JOBS_WITHOUT_SCORE);
    up(db);
    db.exec(`
      CREATE TABLE configured_adapter (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, adapter_id TEXT NOT NULL, name TEXT NOT NULL,
        fields TEXT NOT NULL DEFAULT '{}', visibility TEXT NOT NULL DEFAULT 'private',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE listings (job_id TEXT, is_active INTEGER, manually_deleted INTEGER);
    `);
    storage = await import('../../lib/services/storage/jobStorage.js');
    const plugin = (await import('../../lib/api/routes/jobRouter.js')).default;
    app = Fastify();
    app.addHook('preHandler', async (request) => {
      request.currentUser = ALICE;
      request.session = { currentUser: ALICE.id };
    });
    await app.register(plugin, { prefix: '/api/jobs' });
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  const payload = (over = {}) => ({
    jobId: 'j1',
    name: 'Job',
    provider: [],
    blacklist: [],
    shareWithUsers: [],
    notificationAdapter: [],
    dealType: 'buy',
    ...over,
  });
  const post = (body) => app.inject({ method: 'POST', url: '/api/jobs', payload: body });
  const stored = () => db.prepare(`SELECT score_config FROM jobs WHERE id = 'j1'`).get().score_config;

  const CONFIG = {
    groups: { money: 2, deal: 0 },
    metrics: { 'home.parking': 0 },
    targets: { 'work.commute': { ideal: 15, worst: 45 } },
    commute: { label: 'Work' },
  };

  it('stores the config and reads it back on all three read paths', async () => {
    expect((await post(payload({ scoreConfig: CONFIG }))).statusCode).toBe(200);
    expect(JSON.parse(stored())).toEqual(CONFIG);
    expect(storage.getJob('j1').scoreConfig).toEqual(CONFIG);
    expect(storage.getJobs({ includeDisabled: true })[0].scoreConfig).toEqual(CONFIG);
    expect(storage.queryJobs({ userId: 'u1' }).result[0].scoreConfig).toEqual(CONFIG);
  });

  it('reads null for a job that never had one', async () => {
    await post(payload());
    expect(stored()).toBeNull();
    expect(storage.getJob('j1').scoreConfig).toBeNull();
  });

  it('keeps the config when an update does not mention it', async () => {
    await post(payload({ scoreConfig: CONFIG }));
    await post(payload({ name: 'Renamed' }));
    expect(JSON.parse(stored())).toEqual(CONFIG);
    expect(storage.getJob('j1').name).toBe('Renamed');
  });

  it('clears the config when the update sends null', async () => {
    await post(payload({ scoreConfig: CONFIG }));
    await post(payload({ scoreConfig: null }));
    expect(stored()).toBeNull();
  });

  it('stores an empty config as null', async () => {
    await post(payload({ scoreConfig: { groups: {}, metrics: {} } }));
    expect(stored()).toBeNull();
  });

  it('rejects an invalid config with 400 and writes nothing', async () => {
    const response = await post(payload({ scoreConfig: { metrics: { 'home.pool': 1 }, groups: { money: -1 } } }));
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('unknown metric "home.pool"');
    expect(response.json().error).toContain('scoreConfig.groups.money');
    expect(db.prepare(`SELECT COUNT(1) AS c FROM jobs`).get().c).toBe(0);
  });

  it('does not touch an existing config when a later update is rejected', async () => {
    await post(payload({ scoreConfig: CONFIG }));
    const response = await post(payload({ scoreConfig: 'nonsense' }));
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(stored())).toEqual(CONFIG);
  });

  it('upsertJob without a score config on insert stores null, and keeps an existing one on update', () => {
    storage.upsertJob({
      jobId: 'j1',
      userId: 'u1',
      name: 'A',
      provider: [],
      notificationAdapter: [],
      scoreConfig: CONFIG,
    });
    storage.upsertJob({ jobId: 'j1', userId: 'u1', name: 'B', provider: [], notificationAdapter: [] });
    expect(storage.getJob('j1').scoreConfig).toEqual(CONFIG);
    storage.upsertJob({
      jobId: 'j1',
      userId: 'u1',
      name: 'C',
      provider: [],
      notificationAdapter: [],
      scoreConfig: null,
    });
    expect(storage.getJob('j1').scoreConfig).toBeNull();
  });
});
