/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { buildSaleTerms, parseSaleTerms } from '../../../lib/services/sale/saleTerms.js';
import { up } from '../../../lib/services/storage/migrations/sql/51.listing-sale-terms.js';

const full = () => ({
  ownerCostMonthly: 3900,
  downPayment: 325000,
  grossPaymentMonthly: 35406,
  netPaymentMonthly: 28476,
  pricePerM2: 26322,
  publicValuation: 2700000,
  sales: [{ date: '2013-04-24', amount: 1450000, type: 'normal', area: 229 }],
  daysOnMarket: { current: 20, total: 406 },
  previousRealtors: ['home Odense - Skibhus'],
  priceChangePct: -4.09,
  energyLabel: 'b',
  lotArea: 355,
  basementArea: 106,
  bathrooms: 3,
  yearBuilt: 1934,
  yearRenovated: 2015,
  heating: 'Fjernvarme/blokvarme',
  landTaxPerMille: 5.7,
  municipalTaxPct: 25.5,
  propertyType: 'villa',
  floorPlanUrl: 'https://images.boligsiden.dk/floor.webp',
  nextOpenHouse: { date: '2026-09-12T08:00:00Z', signUpUrl: 'http://www.edc.dk/50007074' },
});

describe('buildSaleTerms', () => {
  it('keeps every figure a complete advert states, numbers as numbers', () => {
    const { sale } = buildSaleTerms(full());

    expect(sale).toEqual({ ...full(), energyLabel: 'B' });
    expect(typeof sale.ownerCostMonthly).toBe('number');
  });

  it('states nothing when nothing is stated: no object, not an object of nulls', () => {
    for (const input of [undefined, null, {}, { ownerCostMonthly: null, sales: [], daysOnMarket: {} }]) {
      expect(buildSaleTerms(input), JSON.stringify(input)).toEqual({});
    }
  });

  it('turns every missing field into null, never zero', () => {
    const { sale } = buildSaleTerms({ pricePerM2: 26000 });

    expect(sale.pricePerM2).toBe(26000);
    expect(sale.ownerCostMonthly).toBeNull();
    expect(sale.downPayment).toBeNull();
    expect(sale.publicValuation).toBeNull();
    expect(sale.daysOnMarket).toEqual({ current: null, total: null });
    expect(sale.priceChangePct).toBeNull();
    expect(sale.yearBuilt).toBeNull();
    expect(sale.sales).toEqual([]);
    expect(sale.previousRealtors).toEqual([]);
    expect(sale.nextOpenHouse).toBeNull();
  });

  it('drops what is not usable instead of rejecting the rest', () => {
    const { sale } = buildSaleTerms({
      ownerCostMonthly: 'lots',
      downPayment: -5,
      pricePerM2: Number.NaN,
      publicValuation: 0,
      yearBuilt: 12,
      bathrooms: 1.5,
      floorPlanUrl: 'javascript:alert(1)',
      nextOpenHouse: { date: 'soon' },
      energyLabel: '  ',
      priceChangePct: -4,
    });

    expect(sale).toMatchObject({
      ownerCostMonthly: null,
      downPayment: null,
      pricePerM2: null,
      publicValuation: null,
      yearBuilt: null,
      bathrooms: null,
      floorPlanUrl: null,
      nextOpenHouse: null,
      energyLabel: null,
      priceChangePct: -4,
    });
  });

  it('keeps a price change of zero, which is a statement', () => {
    expect(buildSaleTerms({ priceChangePct: 0 }).sale.priceChangePct).toBe(0);
  });

  describe('earlier sales', () => {
    it('sorts newest first and keeps the type and the area', () => {
      const { sale } = buildSaleTerms({
        sales: [
          { date: '1994-02-02', amount: 900000, type: 'normal', area: 198 },
          { date: '2023-08-29T00:00:00Z', amount: 1500000, type: 'Family', area: null },
          { date: '2003-11-05', amount: 1000000, type: 'family' },
        ],
      });

      expect(sale.sales).toEqual([
        { date: '2023-08-29', amount: 1500000, type: 'family', area: null },
        { date: '2003-11-05', amount: 1000000, type: 'family', area: null },
        { date: '1994-02-02', amount: 900000, type: 'normal', area: 198 },
      ]);
    });

    it('never lets a sale without a stated type pass for a free sale', () => {
      const { sale } = buildSaleTerms({ sales: [{ date: '2020-01-01', amount: 1 }] });

      expect(sale.sales[0].type).toBe('other');
    });

    it('skips entries without a real date or a positive amount', () => {
      const { sale } = buildSaleTerms({
        sales: [
          { date: '2021-02-30', amount: 1000000, type: 'normal' },
          { date: 'yesterday', amount: 1000000, type: 'normal' },
          { date: '2021-05-01', amount: 0, type: 'normal' },
          { date: '2021-05-01', amount: null, type: 'normal' },
          null,
          'x',
          { date: '2021-05-01', amount: 1200000, type: 'normal' },
        ],
      });

      expect(sale.sales).toEqual([{ date: '2021-05-01', amount: 1200000, type: 'normal', area: null }]);
    });

    it('is empty for anything that is not a list', () => {
      expect(buildSaleTerms({ pricePerM2: 1, sales: 'x' }).sale.sales).toEqual([]);
    });
  });
});

describe('parseSaleTerms', () => {
  it('round-trips what buildSaleTerms produced, through JSON', () => {
    const { sale } = buildSaleTerms(full());

    expect(parseSaleTerms(JSON.stringify(sale))).toEqual(sale);
    expect(parseSaleTerms(sale)).toEqual(sale);
  });

  it('is null for nothing stored and for nothing in it', () => {
    expect(parseSaleTerms(null)).toBeNull();
    expect(parseSaleTerms(undefined)).toBeNull();
    expect(parseSaleTerms('{}')).toBeNull();
  });

  it('is null for malformed JSON and for a value that is not an object', () => {
    for (const stored of ['{not json', '[1,2]', '"text"', '42', 'null', [], 7]) {
      expect(parseSaleTerms(stored), String(stored)).toBeNull();
    }
  });

  it('reads an older or hand-edited row defensively', () => {
    const parsed = parseSaleTerms(JSON.stringify({ ownerCostMonthly: 3900, sales: 'oops', unknownField: 1 }));

    expect(parsed.ownerCostMonthly).toBe(3900);
    expect(parsed.sales).toEqual([]);
    expect(parsed.unknownField).toBeUndefined();
  });
});

describe('migration 51 - sale_terms', () => {
  it('adds the column, once, and leaves existing rows NULL', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE listings (id TEXT PRIMARY KEY, rental_terms TEXT)`);
    db.prepare(`INSERT INTO listings (id) VALUES ('old')`).run();

    up(db);
    up(db);

    expect(
      db
        .prepare(`PRAGMA table_info(listings)`)
        .all()
        .filter((c) => c.name === 'sale_terms'),
    ).toHaveLength(1);
    expect(db.prepare(`SELECT sale_terms FROM listings WHERE id = 'old'`).get().sale_terms).toBeNull();
    db.close();
  });
});
