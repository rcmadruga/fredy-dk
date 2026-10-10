/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

/**
 * The sale filters read the stored sale terms, the way the move-in window reads the rental terms, and
 * the map is filtered by the same code as the overview.
 */
describe('listings filtered by what a for-sale advert states', () => {
  let db;
  let storage;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE listings (
        id TEXT PRIMARY KEY, hash TEXT, provider TEXT, job_id TEXT, price REAL, charges_included INTEGER,
        charges REAL, rental_terms TEXT, sale_terms TEXT, size REAL, rooms REAL, title TEXT, address TEXT,
        link TEXT, image_url TEXT, description TEXT, created_at INTEGER, published_at INTEGER, is_active INTEGER,
        manually_deleted INTEGER DEFAULT 0, latitude REAL, longitude REAL, status TEXT
      );
      CREATE TABLE jobs (id TEXT PRIMARY KEY, name TEXT, deal_type TEXT);
      CREATE TABLE watch_list (id TEXT PRIMARY KEY, listing_id TEXT, user_id TEXT);
      CREATE TABLE listing_attachments (listing_id TEXT);
      CREATE TABLE listing_travel_times (listing_id TEXT, mode TEXT, label TEXT, seconds INTEGER, meters INTEGER, geometry TEXT);
    `);
    db.prepare("INSERT INTO jobs VALUES ('job-1', 'Odense', 'buy')").run();

    const add = (id, terms, over = {}) =>
      db
        .prepare(
          `INSERT INTO listings (id, hash, provider, job_id, price, sale_terms, title, created_at, is_active,
                                 manually_deleted, latitude, longitude)
           VALUES (@id, @id, 'boligsiden', 'job-1', 2000000, @terms, @id, 1, @active, 0, @lat, @lng)`,
        )
        .run({ id, terms: terms == null ? null : JSON.stringify(terms), active: 1, lat: 55.4, lng: 10.4, ...over });

    // ownerCostMonthly / energyLabel / daysOnMarket / priceChangePct, one home each.
    add('cheap-a', {
      ownerCostMonthly: 2500,
      energyLabel: 'A2020',
      daysOnMarket: { current: 10, total: 10 },
      priceChangePct: 0,
    });
    add('mid-b', {
      ownerCostMonthly: 3900,
      energyLabel: 'B',
      daysOnMarket: { current: 20, total: 406 },
      priceChangePct: -4.09,
    });
    add('dear-d', {
      ownerCostMonthly: 6200,
      energyLabel: 'D',
      daysOnMarket: { current: 50, total: 100 },
      priceChangePct: 2,
    });
    add('edge-gap', {
      ownerCostMonthly: 3000,
      energyLabel: 'c',
      daysOnMarket: { current: 40, total: 100 },
      priceChangePct: -1,
    });
    add('just-short', {
      ownerCostMonthly: 3000,
      energyLabel: 'G',
      daysOnMarket: { current: 41, total: 100 },
      priceChangePct: null,
    });
    add('silent', { energyLabel: null, daysOnMarket: { current: null, total: null } });
    add('no-terms', null);
    add('mid-b-inactive', { ownerCostMonthly: 3900, energyLabel: 'B' }, { active: 0 });
    add('mid-b-nocoords', { ownerCostMonthly: 3900, energyLabel: 'B' }, { lat: null, lng: null });

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
  const map = (filters) =>
    storage
      .getListingsForMap({ isAdmin: true, filters })
      .listings.map((row) => row.id)
      .sort();

  it('keeps the homes whose ejerudgift is at or under the ceiling, and drops the ones that state none', () => {
    expect(overview({ saleOwnerCostMax: 3000 })).toEqual(['cheap-a', 'edge-gap', 'just-short']);
    // Ends included.
    expect(overview({ saleOwnerCostMax: 3900 })).toContain('mid-b');
    expect(overview({ saleOwnerCostMax: 3899 })).not.toContain('mid-b');
    // A home with no ejerudgift is not "under" anything.
    expect(overview({ saleOwnerCostMax: 1e9 })).not.toContain('silent');
    expect(overview({ saleOwnerCostMax: 1e9 })).not.toContain('no-terms');
  });

  it('keeps the homes with an energy label at least as good as the one chosen', () => {
    // A2020 counts as an A; the label is stored in either case.
    expect(overview({ saleEnergyMin: 'A' })).toEqual(['cheap-a']);
    // `mid-b-nocoords` is on the overview, which does not need a position, and absent from the map below.
    expect(overview({ saleEnergyMin: 'B' })).toEqual(['cheap-a', 'mid-b', 'mid-b-nocoords']);
    expect(overview({ saleEnergyMin: 'C' })).toEqual(['cheap-a', 'edge-gap', 'mid-b', 'mid-b-nocoords']);
    expect(overview({ saleEnergyMin: 'G' })).toEqual([
      'cheap-a',
      'dear-d',
      'edge-gap',
      'just-short',
      'mid-b',
      'mid-b-nocoords',
    ]);
  });

  it('keeps the relisted homes: at least 60 days longer in total than with the current realtor', () => {
    // 406 - 20 = 386 and 100 - 40 = 60 qualify; 100 - 41 = 59, 10 - 10 = 0 and 100 - 50 = 50 do not.
    expect(overview({ saleRelistedOnly: true })).toEqual(['edge-gap', 'mid-b']);
  });

  it('keeps the homes whose price is down since first listed', () => {
    expect(overview({ salePriceReducedOnly: true })).toEqual(['edge-gap', 'mid-b']);
  });

  it('combines the filters with each other', () => {
    expect(overview({ saleOwnerCostMax: 3500, saleRelistedOnly: true })).toEqual(['edge-gap']);
    expect(overview({ saleEnergyMin: 'B', salePriceReducedOnly: true })).toEqual(['mid-b']);
  });

  it('is not narrowed by any of them when they are off', () => {
    const all = overview({});
    expect(
      overview({ saleOwnerCostMax: null, saleEnergyMin: null, saleRelistedOnly: false, salePriceReducedOnly: false }),
    ).toEqual(all);
    expect(all).toContain('no-terms');
  });

  it('treats a bad value as data, never as SQL', () => {
    expect(() => overview({ saleEnergyMin: "A' OR 1=1 --" })).not.toThrow();
    expect(overview({ saleEnergyMin: "A' OR 1=1 --" })).toEqual(overview({}));
    expect(() => overview({ saleOwnerCostMax: '1; DROP TABLE listings' })).not.toThrow();
  });

  it('filters the map with the same code, and also needs a position and active listings', () => {
    expect(map({ saleEnergyMin: 'B' })).toEqual(['cheap-a', 'mid-b']);
    expect(map({ saleRelistedOnly: true })).toEqual(['edge-gap', 'mid-b']);
    expect(map({ saleOwnerCostMax: 3900 })).toEqual(['cheap-a', 'edge-gap', 'just-short', 'mid-b']);
  });
});
