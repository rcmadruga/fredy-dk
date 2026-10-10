/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { affordabilityBandFor } from '../../lib/services/finance/listingFilter.js';
import { thresholdsFor, verdictForListing } from '../../lib/services/finance/affordability.js';
import { danishVerdictForListing } from '../../lib/services/finance/dk/listingVerdict.js';

/**
 * The affordability filter on a mix of German and Danish purchases, against a real in-memory SQLite.
 * A Danish verdict depends on the home's own ejerudgift as well as its price, so it cannot be a price
 * window; this suite checks that what the filter returns is exactly what the verdict chip says, for
 * every listing and every band.
 */

let db;

vi.mock('../../lib/services/storage/SqliteConnection.js', () => ({
  default: {
    query: (sql, params) => db.prepare(sql).all(params ?? {}),
    execute: (sql, params) => db.prepare(sql).run(params ?? {}),
    withTransaction: (fn) => db.transaction(fn)(db),
  },
}));
vi.mock('../../lib/services/similarity-check/similarityCache.js', () => ({ removeEntry: vi.fn() }));

const USER = 'user-1';

const PROFILE = {
  personA: { label: 'A', enabled: true, age: 35, primaryIncome: 40000, secondaryIncome: 0 },
  livingCosts: 12000,
  financing: {
    equity: 300000,
    bundesland: 'NW',
    purchasePriceThreshold: 30000,
    scenarios: [{ id: 'mid', annualRate: 3.8, tilgung: 2, fixedYears: 10 }],
  },
};

const DKK_PROVIDERS = ['boligsiden'];

/** One price, three ejerudgifter: the same number lands in every Danish band. */
const DANISH = [
  { id: 'dk-no-cost', price: 2500000, saleTerms: { ownerCostMonthly: 0 } },
  { id: 'dk-mid-cost', price: 2500000, saleTerms: { ownerCostMonthly: 4000 } },
  { id: 'dk-high-cost', price: 2500000, saleTerms: { ownerCostMonthly: 9000 } },
  { id: 'dk-unstated', price: 2000000, saleTerms: null },
  { id: 'dk-far', price: 4000000, saleTerms: null },
  { id: 'dk-no-price', price: null, saleTerms: null },
];

/** 3,000,000 is a German "stretch" and, with no ejerudgift, a Danish "affordable". */
const GERMAN = [
  { id: 'de-affordable', price: 200000 },
  { id: 'de-stretch', price: 3000000 },
  { id: 'de-far', price: 9000000 },
];

describe('queryListings affordability band with homes priced in kroner', () => {
  let listingsStorage;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        name TEXT,
        shared_with_user TEXT DEFAULT '[]',
        deal_type TEXT
      );
      CREATE TABLE listings (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        price REAL,
        charges_included INTEGER,
        charges REAL,
        sale_terms TEXT,
        size REAL,
        title TEXT,
        address TEXT,
        provider TEXT,
        link TEXT,
        status TEXT,
        distances TEXT,
        created_at INTEGER DEFAULT 0,
        published_at INTEGER,
        is_active INTEGER DEFAULT 1,
        manually_deleted INTEGER DEFAULT 0
      );
      CREATE TABLE watch_list (id TEXT PRIMARY KEY, listing_id TEXT, user_id TEXT);
      CREATE TABLE listing_attachments (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL,
        filename TEXT,
        mime_type TEXT,
        size INTEGER,
        content BLOB,
        created_at INTEGER
      );
      CREATE TABLE listing_travel_times (
        listing_id TEXT NOT NULL,
        label TEXT NOT NULL,
        origin_lat REAL,
        origin_lng REAL,
        transit_minutes INTEGER,
        transit_transfers INTEGER,
        car_minutes INTEGER,
        car_distance_meters INTEGER,
        car_geometry TEXT,
        bike_minutes INTEGER,
        walk_minutes INTEGER,
        is_estimate INTEGER NOT NULL DEFAULT 1,
        reference_time INTEGER,
        computed_at INTEGER,
        PRIMARY KEY (listing_id, label)
      );
    `);
    db.prepare(`INSERT INTO jobs (id, user_id, name, shared_with_user, deal_type) VALUES (?, ?, ?, '[]', ?)`).run(
      'job-buy',
      USER,
      'Buying job',
      'buy',
    );

    const insert = db.prepare(
      `INSERT INTO listings (id, job_id, price, provider, sale_terms, title) VALUES (?, 'job-buy', ?, ?, ?, ?)`,
    );
    for (const row of DANISH) {
      insert.run(row.id, row.price, 'boligsiden', row.saleTerms ? JSON.stringify(row.saleTerms) : null, row.id);
    }
    for (const row of GERMAN) {
      insert.run(row.id, row.price, 'immoscout', null, row.id);
    }

    vi.resetModules();
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  });

  afterEach(() => db.close());

  const idsFor = (band) =>
    listingsStorage
      .queryListings({
        userId: USER,
        pageSize: 100,
        affordabilityBand: affordabilityBandFor(band, PROFILE, { dkkProviders: DKK_PROVIDERS }),
      })
      .result.map((row) => row.id)
      .sort();

  /** What the chip says about a seeded row, by the same functions the listings route uses. */
  const chipOf = (row, provider) =>
    provider === 'boligsiden'
      ? danishVerdictForListing({ price: row.price, sale_terms: row.saleTerms ?? null }, PROFILE)
      : verdictForListing(row.price, 'buy', thresholdsFor(PROFILE));

  it('returns, per band, exactly the listings whose chip says that band', () => {
    for (const band of ['affordable', 'stretch', 'unaffordable']) {
      const expected = [
        ...DANISH.filter((row) => chipOf(row, 'boligsiden') === band),
        ...GERMAN.filter((row) => chipOf(row, 'immoscout') === band),
      ]
        .map((row) => row.id)
        .sort();
      expect(idsFor(band), band).toEqual(expected);
    }
  });

  it('puts one Danish price in different bands according to its ejerudgift', () => {
    expect(idsFor('affordable')).toContain('dk-no-cost');
    expect(idsFor('stretch')).toContain('dk-mid-cost');
    expect(idsFor('unaffordable')).toContain('dk-high-cost');
  });

  it('does not judge a Danish price by the German thresholds', () => {
    // 3,000,000 is a German "stretch"; the Danish home at 2.5 M without costs is not, and a German
    // listing at 3 M still is.
    expect(idsFor('stretch')).toContain('de-stretch');
    expect(idsFor('affordable')).not.toContain('de-stretch');
    // 2.5 M with no ejerudgift sits under the German affordable ceiling too, so the exclusion is what
    // keeps the German window from also returning the two dearer-to-run homes of the same price.
    expect(idsFor('affordable')).not.toContain('dk-high-cost');
    expect(idsFor('affordable')).not.toContain('dk-mid-cost');
  });

  it('never returns a Danish listing without a price', () => {
    for (const band of ['affordable', 'stretch', 'unaffordable']) {
      expect(idsFor(band)).not.toContain('dk-no-price');
    }
  });

  it('leaves the German listings exactly where the price windows put them without Danish providers', () => {
    const germanOnly = (band) =>
      listingsStorage
        .queryListings({ userId: USER, pageSize: 100, affordabilityBand: affordabilityBandFor(band, PROFILE) })
        .result.map((row) => row.id)
        .filter((id) => id.startsWith('de-'))
        .sort();
    for (const band of ['affordable', 'stretch', 'unaffordable']) {
      expect(
        idsFor(band).filter((id) => id.startsWith('de-')),
        band,
      ).toEqual(germanOnly(band));
    }
  });

  it('judges Danish homes when the profile has only the Danish half', () => {
    const danishOnly = { ...PROFILE, financing: { equity: 300000, market: 'dk' } };
    const ids = listingsStorage
      .queryListings({
        userId: USER,
        pageSize: 100,
        affordabilityBand: affordabilityBandFor('affordable', danishOnly, { dkkProviders: DKK_PROVIDERS }),
      })
      .result.map((row) => row.id)
      .sort();
    expect(ids).toEqual(['dk-no-cost', 'dk-unstated']);
  });
});
