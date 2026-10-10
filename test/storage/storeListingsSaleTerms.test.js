/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { buildSaleTerms } from '../../lib/services/sale/saleTerms.js';

/**
 * What a for-sale advert states beside the price (owner's costs, earlier sales, time on the market)
 * is stored as JSON with the listing, comes back parsed, and is filled in on a row stored before a
 * provider read it - without ever overwriting what the row already holds.
 */
describe('storeListings, the terms of a sale', () => {
  let db;
  let listingsStorage;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE listings (
        id TEXT PRIMARY KEY,
        hash TEXT,
        provider TEXT,
        job_id TEXT,
        price REAL,
        charges_included INTEGER,
        charges REAL,
        rental_terms TEXT,
        sale_terms TEXT,
        size REAL,
        rooms REAL,
        build_year INTEGER,
        energy_class TEXT,
        title TEXT,
        image_url TEXT,
        description TEXT,
        description_en TEXT,
        description_lang TEXT,
        address TEXT,
        link TEXT,
        created_at INTEGER,
        published_at INTEGER,
        is_active INTEGER,
        manually_deleted INTEGER DEFAULT 0,
        latitude REAL,
        longitude REAL,
        price_per_sqm REAL,
        UNIQUE (job_id, hash)
      );
      CREATE TABLE jobs (id TEXT PRIMARY KEY, name TEXT, deal_type TEXT);
      CREATE TABLE watch_list (id TEXT PRIMARY KEY, listing_id TEXT, user_id TEXT);
      CREATE TABLE listing_travel_times (listing_id TEXT, mode TEXT, label TEXT, seconds INTEGER, meters INTEGER, geometry TEXT);
    `);

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
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  });

  afterEach(() => {
    db.close();
  });

  const listing = (hash, overrides = {}) => ({
    id: hash,
    price: 6495000,
    size: 229,
    rooms: 9,
    title: `House ${hash}`,
    image: null,
    description: 'nice',
    address: 'Åløkkevænget 2C, 5000 Odense C',
    link: `https://example.com/${hash}`,
    ...overrides,
  });

  const raw = (hash) => db.prepare('SELECT sale_terms FROM listings WHERE hash = ?').get(hash);
  const { sale } = buildSaleTerms({
    ownerCostMonthly: 3900,
    sales: [{ date: '2013-04-24', amount: 1450000, type: 'normal', area: 229 }],
    daysOnMarket: { current: 20, total: 406 },
  });

  it('stores the terms as JSON', () => {
    listingsStorage.storeListings('job-1', 'boligsiden', [listing('a', { sale })]);

    expect(JSON.parse(raw('a').sale_terms)).toEqual(sale);
  });

  it('stores NULL, not an empty object, when the advert states nothing', () => {
    listingsStorage.storeListings('job-1', 'boligsiden', [listing('none'), listing('empty', { sale: {} })]);

    expect(raw('none').sale_terms).toBeNull();
    expect(raw('empty').sale_terms).toBeNull();
  });

  it('hands the terms back parsed when the listing is read, and null when it has none', () => {
    db.prepare("INSERT INTO jobs VALUES ('job-1', 'Odense', 'buy')").run();
    listingsStorage.storeListings('job-1', 'boligsiden', [listing('a', { sale }), listing('b')]);
    const idOf = (hash) => db.prepare('SELECT id FROM listings WHERE hash = ?').get(hash).id;

    expect(listingsStorage.getListingById(idOf('a'), null, true).sale_terms).toEqual(sale);
    expect(listingsStorage.getListingById(idOf('b'), null, true).sale_terms).toBeNull();
  });

  it('hands back null for a stored value that is not valid JSON', () => {
    db.prepare("INSERT INTO jobs VALUES ('job-1', 'Odense', 'buy')").run();
    listingsStorage.storeListings('job-1', 'boligsiden', [listing('a', { sale })]);
    db.prepare("UPDATE listings SET sale_terms = '{broken' WHERE hash = 'a'").run();
    const id = db.prepare("SELECT id FROM listings WHERE hash = 'a'").get().id;

    expect(listingsStorage.getListingById(id, null, true).sale_terms).toBeNull();
  });

  it('fills in the terms on a row stored before they were read', () => {
    listingsStorage.storeListings('job-1', 'boligsiden', [listing('a')]);
    expect(raw('a').sale_terms).toBeNull();

    listingsStorage.storeListings('job-1', 'boligsiden', [listing('a', { sale })]);

    expect(JSON.parse(raw('a').sale_terms)).toEqual(sale);
  });

  it('does not overwrite what the row already has, so a later edit cannot rewrite what the user saw', () => {
    listingsStorage.storeListings('job-1', 'boligsiden', [listing('a', { sale })]);

    listingsStorage.storeListings('job-1', 'boligsiden', [
      listing('a', { sale: buildSaleTerms({ ownerCostMonthly: 99999 }).sale }),
    ]);

    expect(JSON.parse(raw('a').sale_terms)).toEqual(sale);
  });
});
