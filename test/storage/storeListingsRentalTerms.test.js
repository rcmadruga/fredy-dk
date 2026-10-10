/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

/**
 * What a rental advert states beside the rent (deposit, prepaid rent, lease, when the home is free)
 * is stored as JSON with the listing, comes back parsed, and is filled in on a row stored before a
 * provider read it - without ever overwriting what the row already holds.
 */
describe('storeListings, the terms of a rental', () => {
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
    price: 5900,
    size: 37,
    rooms: 2,
    title: `Flat ${hash}`,
    image: null,
    description: 'nice',
    address: '3400 Hillerød',
    link: `https://example.com/${hash}`,
    ...overrides,
  });

  const raw = (hash) =>
    db.prepare('SELECT charges_included, charges, rental_terms FROM listings WHERE hash = ?').get(hash);
  const terms = { deposit: 17700, prepaidRent: 5900, leasePeriodMonths: 0, availableFrom: '2027-01-15' };

  it('stores the terms as JSON', () => {
    listingsStorage.storeListings('job-1', 'boligportal', [listing('a', { rental: terms })]);

    expect(JSON.parse(raw('a').rental_terms)).toEqual(terms);
  });

  it('stores NULL, not an empty object, when the advert states nothing', () => {
    listingsStorage.storeListings('job-1', 'boligportal', [listing('none'), listing('empty', { rental: {} })]);

    expect(raw('none').rental_terms).toBeNull();
    expect(raw('empty').rental_terms).toBeNull();
  });

  it('hands the terms back parsed when the listing is read, and null when it has none', () => {
    db.prepare("INSERT INTO jobs VALUES ('job-1', 'Hillerød', 'rent')").run();
    listingsStorage.storeListings('job-1', 'boligportal', [listing('a', { rental: terms }), listing('b')]);
    const idOf = (hash) => db.prepare('SELECT id FROM listings WHERE hash = ?').get(hash).id;

    expect(listingsStorage.getListingById(idOf('a'), null, true).rental_terms).toEqual(terms);
    expect(listingsStorage.getListingById(idOf('b'), null, true).rental_terms).toBeNull();
  });

  it('fills in the terms, the basis and the charges on a row stored before they were read', () => {
    listingsStorage.storeListings('job-1', 'boligportal', [listing('a')]);
    expect(raw('a')).toEqual({ charges_included: null, charges: null, rental_terms: null });

    listingsStorage.storeListings('job-1', 'boligportal', [
      listing('a', { rental: terms, chargesIncluded: false, charges: 450 }),
    ]);

    expect(raw('a').charges_included).toBe(0);
    expect(raw('a').charges).toBe(450);
    expect(JSON.parse(raw('a').rental_terms)).toEqual(terms);
  });

  it('does not overwrite what the row already has, so a later edit cannot rewrite what the user saw', () => {
    listingsStorage.storeListings('job-1', 'boligportal', [
      listing('a', { rental: terms, chargesIncluded: false, charges: 450 }),
    ]);

    listingsStorage.storeListings('job-1', 'boligportal', [
      listing('a', { rental: { deposit: 99999 }, chargesIncluded: true, charges: 9 }),
    ]);

    expect(raw('a').charges_included).toBe(0);
    expect(raw('a').charges).toBe(450);
    expect(JSON.parse(raw('a').rental_terms)).toEqual(terms);
  });
});
