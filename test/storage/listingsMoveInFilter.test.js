/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

/**
 * The move-in window filters on the date in the stored rental terms, and the map is filtered by the
 * same code as the overview - which is what these assert, since the two used to disagree.
 */
describe('listings filtered by when the home is free', () => {
  let db;
  let storage;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE listings (
        id TEXT PRIMARY KEY, hash TEXT, provider TEXT, job_id TEXT, price REAL, charges_included INTEGER,
        charges REAL, rental_terms TEXT, size REAL, rooms REAL, title TEXT, address TEXT, link TEXT,
        image_url TEXT, description TEXT, created_at INTEGER, published_at INTEGER, is_active INTEGER,
        manually_deleted INTEGER DEFAULT 0, latitude REAL, longitude REAL, status TEXT
      );
      CREATE TABLE jobs (id TEXT PRIMARY KEY, name TEXT, deal_type TEXT);
      CREATE TABLE watch_list (id TEXT PRIMARY KEY, listing_id TEXT, user_id TEXT);
      CREATE TABLE listing_attachments (listing_id TEXT);
      CREATE TABLE listing_travel_times (listing_id TEXT, mode TEXT, label TEXT, seconds INTEGER, meters INTEGER, geometry TEXT);
    `);
    db.prepare("INSERT INTO jobs VALUES ('job-1', 'Zealand', 'rent')").run();

    const add = (id, terms, over = {}) =>
      db
        .prepare(
          `INSERT INTO listings (id, hash, provider, job_id, price, rental_terms, title, created_at, is_active,
                                 manually_deleted, latitude, longitude)
           VALUES (@id, @id, @provider, 'job-1', 5000, @terms, @id, @created, @active, 0, @lat, @lng)`,
        )
        .run({
          id,
          terms: terms == null ? null : JSON.stringify(terms),
          provider: 'boligportal',
          created: 1,
          active: 1,
          lat: 55.9,
          lng: 12.3,
          ...over,
        });
    add('dec26', { availableFrom: '2026-12-01' });
    add('jan27', { availableFrom: '2027-01-15' });
    add('mar27', { availableFrom: '2027-03-31' });
    add('apr27', { availableFrom: '2027-04-01' });
    add('undated-rental', { deposit: 15000 });
    add('no-terms', null);
    add('jan27-inactive', { availableFrom: '2027-01-20' }, { active: 0 });
    add('jan27-nocoords', { availableFrom: '2027-01-25' }, { lat: null, lng: null });
    add('jan27-other-provider', { availableFrom: '2027-02-01' }, { provider: 'lejebolig' });

    vi.resetModules();
    vi.doMock('../../lib/services/storage/SqliteConnection.js', () => ({
      default: {
        getConnection: () => db,
        query: (sql, params) => (params == null ? db.prepare(sql).all() : db.prepare(sql).all(params)),
        execute: (sql, params) => db.prepare(sql).run(params),
        withTransaction: (callback) => db.transaction(() => callback(db))(),
      },
    }));
    vi.doMock('../../lib/services/similarity-check/similarityCache.js', () => ({ removeEntry: vi.fn() }));
    storage = await import('../../lib/services/storage/listingsStorage.js');
  });

  afterEach(() => db.close());

  const overview = (filters) =>
    storage
      .queryListings({ isAdmin: true, activityFilter: true, ...filters })
      .result.map((row) => row.id)
      .sort();
  const map = (filters, extra = {}) =>
    storage
      .getListingsForMap({ isAdmin: true, filters, ...extra })
      .listings.map((row) => row.id)
      .sort();

  describe('the overview', () => {
    it('keeps the homes free inside the window, ends included, and the ones that state no date', () => {
      expect(overview({ moveInFrom: '2027-01-01', moveInTo: '2027-03-31' })).toEqual([
        'jan27',
        'jan27-nocoords',
        'jan27-other-provider',
        'mar27',
        'no-terms',
        'undated-rental',
      ]);
    });

    it('can leave out the listings that state no date', () => {
      expect(overview({ moveInFrom: '2027-01-01', moveInTo: '2027-03-31', moveInDatedOnly: true })).toEqual([
        'jan27',
        'jan27-nocoords',
        'jan27-other-provider',
        'mar27',
      ]);
    });

    it('takes an open start and an open end', () => {
      expect(overview({ moveInFrom: '2027-03-31', moveInDatedOnly: true })).toEqual(['apr27', 'mar27']);
      expect(overview({ moveInTo: '2026-12-31', moveInDatedOnly: true })).toEqual(['dec26']);
    });

    it('is not narrowed at all by the dated-only flag without a window', () => {
      expect(overview({ moveInDatedOnly: true })).toHaveLength(overview({}).length);
    });

    it('treats the dates as data, never as SQL', () => {
      expect(() => overview({ moveInFrom: "2027-01-01' OR 1=1 --" })).not.toThrow();
    });
  });

  describe('the map, filtered by the same code', () => {
    it('applies the same window, and also needs a position and shows active listings by default', () => {
      // Not in the overview's answer above: jan27-inactive (inactive) and jan27-nocoords (no position).
      expect(map({ moveInFrom: '2027-01-01', moveInTo: '2027-03-31', moveInDatedOnly: true })).toEqual([
        'jan27',
        'jan27-other-provider',
        'mar27',
      ]);
    });

    it('answers every other overview filter the same way too, not only this one', () => {
      expect(overview({ providerFilter: 'lejebolig' })).toEqual(['jan27-other-provider']);
      expect(map({ providerFilter: 'lejebolig' })).toEqual(['jan27-other-provider']);
      expect(map({ moveInFrom: '2027-01-01', moveInTo: '2027-03-31', providerFilter: 'lejebolig' })).toEqual([
        'jan27-other-provider',
      ]);
    });

    it('filters by watched, which the map could not before', () => {
      db.prepare("INSERT INTO watch_list VALUES ('w1', 'mar27', 'user-1')").run();

      expect(map({ watchListFilter: true }, { userId: 'user-1' })).toEqual(['mar27']);
      expect(map({ watchListFilter: false }, { userId: 'user-1' })).not.toContain('mar27');
    });

    it('shows active listings when the caller names no activity filter, and every listing when it says null', () => {
      expect(map({})).not.toContain('jan27-inactive');
      expect(map({ activityFilter: null })).toContain('jan27-inactive');
      expect(map({ activityFilter: false })).toEqual(['jan27-inactive']);
    });

    it('still takes a job on its own', () => {
      expect(map({}, { jobId: 'job-1' }).length).toBeGreaterThan(0);
      expect(map({}, { jobId: 'nobody' })).toEqual([]);
    });

    it('leaves out a listing without a position however it is filtered', () => {
      expect(map({ activityFilter: null })).not.toContain('jan27-nocoords');
      expect(overview({})).toContain('jan27-nocoords');
    });
  });
});
