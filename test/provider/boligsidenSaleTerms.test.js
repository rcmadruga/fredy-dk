/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as provider from '../../lib/provider/boligsiden.js';
import { providerConfig } from '../utils.js';

/**
 * What Boligsiden states beyond the price becomes the listing's `sale` terms. Driven through
 * `normalize` with the recorded cases, so the field names are the API's, not ones assumed here.
 */
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../testFixtures/boligsiden_cases.json'),
    'utf-8',
  ),
);
const { normalize } = provider.createConfig(providerConfig.boligsiden, []);
const normalized = fixture.cases.map((c) => normalize(c));
const bare = () => ({
  caseID: 'bare-1',
  priceCash: 2500000,
  descriptionTitle: 'Bare',
  caseUrl: 'https://www.edc.dk/sag/?sagsnr=1',
  housingArea: 100,
  numberOfRooms: 3,
});

describe('boligsiden normalize, the sale terms', () => {
  it('reads the figures of a complete case', () => {
    expect(normalized[0].sale).toEqual({
      ownerCostMonthly: 3900,
      downPayment: 325000,
      grossPaymentMonthly: 35406,
      netPaymentMonthly: 28476,
      pricePerM2: 26322,
      publicValuation: 2700000,
      sales: [{ date: '2013-04-24', amount: 1450000, type: 'normal', area: 229 }],
      daysOnMarket: { current: 20, total: 406 },
      previousRealtors: ['home Odense - Skibhus'],
      priceChangePct: 0,
      energyLabel: 'B',
      lotArea: 355,
      basementArea: 106,
      bathrooms: 3,
      yearBuilt: 1934,
      yearRenovated: 2015,
      heating: 'Fjernvarme/blokvarme',
      landTaxPerMille: 5.7,
      municipalTaxPct: 25.5,
      propertyType: 'villa',
      floorPlanUrl: expect.stringMatching(/^https:\/\//),
      nextOpenHouse: {
        date: '2026-09-12T08:00:00Z',
        signUpUrl: 'http://www.edc.dk/50007074?aid=a3b31b22-e970-44f5-856a-b476c9228d08',
      },
    });
  });

  it('carries terms on every recorded case, with numbers as numbers', () => {
    for (const listing of normalized) {
      expect(listing.sale, listing.id).toBeTruthy();
      expect(typeof listing.sale.ownerCostMonthly, listing.id).toBe('number');
      expect(typeof listing.sale.publicValuation, listing.id).toBe('number');
    }
  });

  it('keeps the hash a function of strings only, with the terms outside it', () => {
    for (const listing of normalized) {
      expect(typeof listing.id).toBe('string');
      expect(listing.id).toMatch(/^[0-9a-f]+$/);
    }
    const [a, b] = [normalize(bare()), normalize({ ...bare(), monthlyExpense: 4000 })];
    expect(a.id).toBe(b.id);
  });

  it('labels the sales that are not free ones', () => {
    const family = normalized[2].sale.sales;

    expect(family.map((s) => s.type)).toEqual(['family', 'family', 'family', 'normal']);
    expect(family[0]).toEqual({ date: '2023-08-29', amount: expect.any(Number), type: 'family', area: 170 });
    const auction = normalized[8].sale.sales.filter((s) => s.type === 'auction');
    expect(auction).toHaveLength(4);
  });

  it('lists the sales newest first and leaves out a missing area as null', () => {
    const { sales } = normalized[6].sale;

    expect(sales.map((s) => s.date)).toEqual(['2018-08-30', '2016-03-09']);
    expect(sales[1].area).toBeNull();
  });

  it('reads a price reduction as a negative percentage', () => {
    expect(normalized[2].sale.priceChangePct).toBe(-4.09);
    expect(normalized[7].sale.priceChangePct).toBe(-7.04);
  });

  it('names no previous realtor for a home that was never relisted', () => {
    expect(normalized[1].sale.daysOnMarket).toEqual({ current: 22, total: 22 });
    expect(normalized[1].sale.previousRealtors).toEqual([]);
  });

  it('judges the home by its largest building, not by a garage', () => {
    // Case 0 lists a 1934 house of 229 m² and a later, smaller building of 1971.
    expect(normalized[0].sale.yearBuilt).toBe(1934);
  });

  it('has no sales for a home with none on record', () => {
    expect(normalized[3].sale.sales).toEqual([]);
  });

  describe('a case that states almost nothing', () => {
    it('carries no terms at all', () => {
      expect(normalize(bare()).sale).toBeUndefined();
    });

    it('leaves every optional field null, never 0', () => {
      const { sale } = normalize({ ...bare(), perAreaPrice: 25000 });

      expect(sale).toMatchObject({
        ownerCostMonthly: null,
        downPayment: null,
        grossPaymentMonthly: null,
        netPaymentMonthly: null,
        publicValuation: null,
        daysOnMarket: { current: null, total: null },
        priceChangePct: null,
        energyLabel: null,
        lotArea: null,
        basementArea: null,
        bathrooms: null,
        yearBuilt: null,
        yearRenovated: null,
        heating: null,
        landTaxPerMille: null,
        municipalTaxPct: null,
        propertyType: null,
        floorPlanUrl: null,
        nextOpenHouse: null,
        sales: [],
        previousRealtors: [],
      });
      expect(sale.pricePerM2).toBe(25000);
    });

    it('survives null where the API sends a block', () => {
      const listing = normalize({
        ...bare(),
        monthlyExpense: 3100,
        address: null,
        realEstate: null,
        timeOnMarket: null,
        nextOpenHouse: null,
        utilitiesConnectionFee: { includedInPrice: null },
      });

      expect(listing.sale.ownerCostMonthly).toBe(3100);
      expect(listing.sale.downPayment).toBeNull();
      expect(listing.sale.daysOnMarket).toEqual({ current: null, total: null });
    });

    it('falls back to the case-level day count when the market block is missing', () => {
      expect(normalize({ ...bare(), daysOnMarket: 12 }).sale.daysOnMarket).toEqual({ current: 12, total: null });
    });

    it('drops the sign-up link of an open house that needs no sign-up', () => {
      const listing = normalize({
        ...bare(),
        nextOpenHouse: { date: '2026-11-01T10:00:00Z', signUp: false, signUpUrl: 'http://x.example/' },
      });

      expect(listing.sale.nextOpenHouse).toEqual({ date: '2026-11-01T10:00:00Z', signUpUrl: null });
    });
  });
});
