/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let db;
let queries;

vi.mock('../../lib/services/storage/SqliteConnection.js', () => ({
  default: {
    query: (sql, params = {}) => {
      queries.push(sql);
      return db.prepare(sql).all(params);
    },
    execute: (sql, params = {}) => db.prepare(sql).run(params),
    withTransaction: (cb) => db.transaction(() => cb(db))(),
  },
}));

/**
 * The two reads the listing score makes of the database, each of which must answer a whole page with
 * a single statement.
 */
describe('reads for the listing score', () => {
  let listingsStorage;
  let jobStorage;

  beforeEach(async () => {
    queries = [];
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, deal_type TEXT, spec_filter TEXT, commute_filter TEXT, score_config TEXT
      );
      CREATE TABLE listings (
        id TEXT PRIMARY KEY, job_id TEXT, is_active INTEGER DEFAULT 1, manually_deleted INTEGER DEFAULT 0,
        price_per_sqm REAL
      );
    `);
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
    jobStorage = await import('../../lib/services/storage/jobStorage.js');
  });

  afterEach(() => db.close());

  const addListing = (id, jobId, pricePerSqm, extra = '') => {
    db.prepare(`INSERT INTO listings (id, job_id, price_per_sqm) VALUES (?, ?, ?)`).run(id, jobId, pricePerSqm);
    if (extra) db.exec(`UPDATE listings SET ${extra} WHERE id = '${id}'`);
  };

  describe('getPricePerSqmByJob', () => {
    it('groups the prices by job in one query', () => {
      addListing('a', 'j1', 10);
      addListing('b', 'j1', 20);
      addListing('c', 'j2', 30);
      addListing('d', 'j3', 40);

      const byJob = listingsStorage.getPricePerSqmByJob(['j1', 'j2']);

      expect([...byJob.keys()].sort()).toEqual(['j1', 'j2']);
      expect(byJob.get('j1').sort()).toEqual([10, 20]);
      expect(byJob.get('j2')).toEqual([30]);
      expect(queries).toHaveLength(1);
    });

    it('leaves out listings that are offline, deleted or have no figure', () => {
      addListing('ok', 'j1', 10);
      addListing('offline', 'j1', 99, 'is_active = 0');
      addListing('deleted', 'j1', 99, 'manually_deleted = 1');
      addListing('blank', 'j1', null);

      expect(listingsStorage.getPricePerSqmByJob(['j1']).get('j1')).toEqual([10]);
    });

    it('leaves out a job with nothing to report', () => {
      expect(listingsStorage.getPricePerSqmByJob(['j1']).size).toBe(0);
    });

    it('asks nothing for nothing, and ignores junk ids', () => {
      expect(listingsStorage.getPricePerSqmByJob([]).size).toBe(0);
      expect(listingsStorage.getPricePerSqmByJob(null).size).toBe(0);
      expect(listingsStorage.getPricePerSqmByJob([null, '', 5]).size).toBe(0);
      expect(queries).toHaveLength(0);
    });

    it('reads the same job once, however often it is named', () => {
      addListing('a', 'j1', 10);
      expect(listingsStorage.getPricePerSqmByJob(['j1', 'j1', 'j1']).get('j1')).toEqual([10]);
    });
  });

  describe('getJobsForScoring', () => {
    it('reads the narrow shape of every job in one query', () => {
      db.prepare(`INSERT INTO jobs VALUES (?, ?, ?, ?, ?)`).run(
        'j1',
        'buy',
        '{"maxPrice":3000000}',
        '{"action":"notify","limits":{"Work":35}}',
        '{"groups":{"money":2}}',
      );
      db.prepare(`INSERT INTO jobs VALUES (?, ?, ?, ?, ?)`).run('j2', 'rent', null, null, null);

      const byId = jobStorage.getJobsForScoring(['j1', 'j2', 'unknown']);

      expect(byId.get('j1')).toEqual({
        dealType: 'buy',
        specFilter: { maxPrice: 3000000 },
        commuteFilter: { action: 'notify', limits: { Work: 35 } },
        scoreConfig: { groups: { money: 2 } },
      });
      expect(byId.get('j2')).toEqual({ dealType: 'rent', specFilter: null, commuteFilter: null, scoreConfig: null });
      expect(byId.has('unknown')).toBe(false);
      expect(queries).toHaveLength(1);
    });

    it('survives a column that holds something that is not JSON', () => {
      db.prepare(`INSERT INTO jobs VALUES (?, ?, ?, ?, ?)`).run('j1', 'rent', '{nope', '', 'x');
      const job = jobStorage.getJobsForScoring(['j1']).get('j1');
      expect(job.specFilter).toBeNull();
      expect(job.scoreConfig).toBeNull();
    });

    it('asks nothing for nothing', () => {
      expect(jobStorage.getJobsForScoring([]).size).toBe(0);
      expect(jobStorage.getJobsForScoring(undefined).size).toBe(0);
      expect(queries).toHaveLength(0);
    });
  });
});
