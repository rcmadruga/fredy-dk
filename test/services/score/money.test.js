/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import {
  MIN_BAND_SAMPLE,
  MONEY_METRICS,
  affordabilityRatio,
  listingPricePerSqm,
  pricePerSqmBand,
} from '../../../lib/services/score/metrics/money.js';
import { scoreListing } from '../../../lib/services/score/score.js';

const byId = (id) => MONEY_METRICS.find((metric) => metric.id === id);

// 5800 net, 1400 living costs, 250 debt service: headroom 1780, disposable 4150, so 1780 is the ceiling.
const buyProfile = (overrides = {}) => ({
  personA: { label: 'A', enabled: true, age: 34, primaryIncome: 3200, secondaryIncome: 200 },
  personB: { label: 'B', enabled: true, age: 36, primaryIncome: 2400, secondaryIncome: 0 },
  livingCosts: 1400,
  existingDebt: 8000,
  existingDebtRate: 250,
  existingDebtInterest: 6.9,
  financing: {
    equity: 80000,
    bundesland: 'NW',
    notaryPct: 1.5,
    maklerPct: 3.57,
    purchasePriceThreshold: 30000,
    scenarios: [{ id: 'mid', annualRate: 3.8, tilgung: 2, fixedYears: 10 }],
  },
  ...overrides,
});

// 4000 net, 1400 living costs: 35 % of 4000 is 1400, disposable 2600.
const rentProfile = (overrides = {}) => ({
  personA: { label: 'A', enabled: true, age: 34, primaryIncome: 4000, secondaryIncome: 0 },
  livingCosts: 1400,
  renting: { nebenkostenPct: 25 },
  ...overrides,
});

describe('pricePerSqmBand', () => {
  it('takes the 25th and 90th percentile', () => {
    const prices = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110];
    const band = pricePerSqmBand(prices);
    expect(band.low).toBe(35);
    expect(band.high).toBe(100);
  });

  it('interpolates between neighbours', () => {
    const band = pricePerSqmBand([100, 200, 300, 400, 500]);
    expect(band.low).toBe(200);
    expect(band.high).toBeCloseTo(460, 6);
  });

  it('ignores listings with no usable price per m2', () => {
    const band = pricePerSqmBand([null, undefined, 0, -3, NaN, 100, 200, 300, 400, 500]);
    expect(band).not.toBeNull();
    expect(band.low).toBe(200);
  });

  it('has no band for a sample too small to mean anything', () => {
    expect(pricePerSqmBand(Array.from({ length: MIN_BAND_SAMPLE - 1 }, (_, i) => 100 + i))).toBeNull();
    expect(pricePerSqmBand([])).toBeNull();
    expect(pricePerSqmBand(null)).toBeNull();
  });

  it('has no band when every listing costs the same', () => {
    expect(pricePerSqmBand([100, 100, 100, 100, 100, 100])).toBeNull();
  });
});

describe('listingPricePerSqm', () => {
  it('prefers the stored column', () => {
    expect(listingPricePerSqm({ price_per_sqm: 12.5, price: 1000, size: 50 })).toBe(12.5);
  });

  it('falls back to price over size', () => {
    expect(listingPricePerSqm({ price: 1000, size: 50 })).toBe(20);
  });

  it('is null without both', () => {
    expect(listingPricePerSqm({ price: 1000 })).toBeNull();
    expect(listingPricePerSqm({ price: 1000, size: 0 })).toBeNull();
    expect(listingPricePerSqm({})).toBeNull();
  });
});

describe('money.value', () => {
  const value = byId('value');

  it('reads the price per m2 and scores it against the job percentiles', () => {
    const ctx = { pricePerSqm: { low: 10, high: 30 } };
    const result = scoreListing({ dealType: 'rent', price_per_sqm: 20 }, null, ctx, [value]);
    expect(result.groups[0].metrics[0]).toMatchObject({ raw: 20, ideal: 10, worst: 30, score: 50 });
  });

  it('is missing without percentiles', () => {
    const result = scoreListing({ dealType: 'rent', price_per_sqm: 20 }, null, {}, [value]);
    expect(result.groups[0].metrics[0].missing).toBe(true);
  });

  it('scores against targets the job set even without percentiles', () => {
    const config = { targets: { 'money.value': { ideal: 10, worst: 30 } } };
    const result = scoreListing({ dealType: 'rent', price_per_sqm: 10 }, config, {}, [value]);
    expect(result.groups[0].metrics[0].score).toBe(100);
  });
});

describe('money.budget', () => {
  const budget = byId('budget');
  const ctx = { job: { maxPrice: 1000, minSize: null } };

  it('is the price over the job cap', () => {
    expect(budget.raw({ price: 800 }, ctx)).toBe(0.8);
    expect(budget.raw({ price: 1200 }, ctx)).toBe(1.2);
  });

  it('scores 100 at 80 % of the cap and 0 at the cap', () => {
    const score = (price) => scoreListing({ dealType: 'rent', price }, null, ctx, [budget]).groups[0].score;
    expect(score(800)).toBe(100);
    expect(score(900)).toBe(50);
    expect(score(1000)).toBe(0);
    expect(score(700)).toBe(100);
  });

  it('is missing when the job has no price cap or the listing no price', () => {
    expect(budget.raw({ price: 800 }, { job: { maxPrice: null } })).toBeNull();
    expect(budget.raw({ price: 800 }, {})).toBeNull();
    expect(budget.raw({}, ctx)).toBeNull();
    expect(budget.raw({ price: 0 }, ctx)).toBeNull();
  });
});

describe('money.affordable', () => {
  const affordable = byId('affordable');

  it('is missing without a finance profile', () => {
    expect(affordable.raw({ dealType: 'buy', price: 300000 }, {})).toBeNull();
    expect(affordable.raw({ dealType: 'buy', price: 300000 }, { financeProfile: null })).toBeNull();
  });

  it('is missing when the purchase half of the profile is incomplete', () => {
    expect(affordable.raw({ dealType: 'buy', price: 300000 }, { financeProfile: rentProfile() })).toBeNull();
  });

  it('is missing without a usable price', () => {
    expect(affordable.raw({ dealType: 'buy' }, { financeProfile: buyProfile() })).toBeNull();
  });

  it('divides a purchase instalment by the ceiling of the stricter limit', () => {
    const profile = buyProfile();
    const ratio = affordabilityRatio({ dealType: 'buy', price: 300000 }, profile);
    expect(ratio).toBeGreaterThan(0);
    const doubled = affordabilityRatio({ dealType: 'buy', price: 600000 }, profile);
    expect(doubled).toBeGreaterThan(ratio);
  });

  it('agrees with the verdict: an affordable purchase is under 1, an unaffordable one over', () => {
    const profile = buyProfile();
    expect(affordabilityRatio({ dealType: 'buy', price: 100000 }, profile)).toBeLessThan(1);
    expect(affordabilityRatio({ dealType: 'buy', price: 2000000 }, profile)).toBeGreaterThan(1);
  });

  it('uses the warm rent for a rental, with the Nebenkosten surcharge', () => {
    // 1000 cold + 25 % = 1250 warm, over a ceiling of min(1400, 2600).
    expect(affordabilityRatio({ dealType: 'rent', price: 1000 }, rentProfile())).toBeCloseTo(1250 / 1400, 6);
  });

  it('does not add the surcharge to a rent quoted with the charges', () => {
    const quoted = { dealType: 'rent', price: 1000, charges_included: 1 };
    expect(affordabilityRatio(quoted, rentProfile())).toBeCloseTo(1000 / 1400, 6);
  });

  it('judges a purchase priced in kroner with the Danish model, as the verdict chip does', () => {
    // 40,000 kr net, 12,000 kr living costs, 300,000 kr cash: the profile of listingVerdict.test.js.
    const dkProfile = {
      personA: { label: 'A', enabled: true, age: 35, primaryIncome: 40000, secondaryIncome: 0 },
      livingCosts: 12000,
      financing: {
        equity: 300000,
        market: 'dk',
        bundesland: 'NW',
        scenarios: [{ id: 'mid', annualRate: 3.8, tilgung: 2, fixedYears: 10 }],
      },
    };
    const affordableHome = { dealType: 'buy', price: 2000000 };
    const outOfReach = { dealType: 'buy', price: 4000000 };
    // The German model reads the price as euros with German loans and costs: a different answer.
    const german = affordabilityRatio(affordableHome, dkProfile);
    const danish = affordabilityRatio(affordableHome, dkProfile, { danish: true });
    expect(danish).not.toBeCloseTo(german, 2);
    expect(affordabilityRatio(affordableHome, dkProfile, { danish: true })).toBeLessThan(1);
    expect(affordabilityRatio(outOfReach, dkProfile, { danish: true })).toBeGreaterThan(1);
    expect(affordable.raw(affordableHome, { financeProfile: dkProfile, danish: true })).toBeLessThan(1);
  });

  it('reports the worst ratio for a household with no room at all', () => {
    const broke = rentProfile({ livingCosts: 4000 });
    expect(affordabilityRatio({ dealType: 'rent', price: 500 }, broke)).toBe(2);
  });

  it('scores a rent inside the comfort band 100 and one at the ceiling 0', () => {
    const ctx = { financeProfile: rentProfile() };
    const score = (price) => scoreListing({ dealType: 'rent', price }, null, ctx, [affordable]).groups[0].score;
    // 800 cold = 1000 warm = 0.714 of the ceiling.
    expect(score(800)).toBe(100);
    // 1120 cold = 1400 warm = exactly the ceiling.
    expect(score(1120)).toBe(0);
  });
});

describe('money.trend', () => {
  it('is a buy-only descriptor that stays unknown until the valuation source exists', () => {
    const trend = byId('trend');
    expect(trend.buyOnly).toBe(true);
    expect(trend.qualifier).toBe('kommune');
    expect(trend.raw({ dealType: 'buy' }, {})).toBeNull();
    const result = scoreListing({ dealType: 'buy' }, null, {}, [trend]);
    expect(result.groups[0].metrics[0]).toMatchObject({ missing: true, score: 50, ideal: 15, worst: -5 });
  });

  it('is not part of a rental at all', () => {
    const result = scoreListing({ dealType: 'rent' }, null, {}, [byId('trend')]);
    expect(result.groups[0].metrics).toEqual([]);
  });
});

describe('MONEY_METRICS', () => {
  it('registers value, affordable, budget and trend, in that order', () => {
    expect(MONEY_METRICS.map((metric) => metric.id)).toEqual(['value', 'affordable', 'budget', 'trend']);
    expect(MONEY_METRICS.every((metric) => metric.group === 'money')).toBe(true);
  });
});
