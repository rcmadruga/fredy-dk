/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeFinanceResult, validateProfile } from '../../../../lib/services/finance/calculate.js';
import {
  computeDanishResult,
  danishParamsFor,
  isDanishMarket,
  isDanishProfileComplete,
} from '../../../../lib/services/finance/dk/result.js';
import { normalizeProfile } from '../../../../lib/services/finance/profile.js';

/**
 * 40,000 kr net a month and 12,000 kr of living costs: the 35 % rule allows 14,000 kr of housing a
 * month, and 28,000 kr is left after living costs.
 */
const household = (financing = {}) => ({
  personA: { label: 'A', enabled: true, age: 35, primaryIncome: 40000, secondaryIncome: 0 },
  livingCosts: 12000,
  financing: { purchasePrice: 2000000, equity: 300000, market: 'dk', ...financing },
});

describe('computeFinanceResult picks the model by currency', () => {
  it('answers a DKK listing with the Danish model', () => {
    const result = computeFinanceResult(household(), { currency: 'DKK' });
    expect(result.model).toBe('dk');
    expect(result.currency).toBe('DKK');
    expect(result.dk.purchasePrice).toBe(2000000);
  });

  afterEach(() => vi.useRealTimers());

  it('leaves every other currency on the German model, untouched', () => {
    // The debt-free date reads the clock; freeze it so two calls can be compared.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
    const profile = household({ bundesland: 'NW' });
    const german = computeFinanceResult(profile);
    expect(german.model).toBeUndefined();
    expect(german.financing.primary).toBeDefined();
    // Asking explicitly for euros, or for nothing, is the same call.
    expect(computeFinanceResult(profile, { currency: 'EUR' })).toEqual(german);
    expect(computeFinanceResult(profile, {})).toEqual(german);
  });
});

describe('computeDanishResult', () => {
  it('takes the price and cash from the profile and the home facts from the advert', () => {
    const result = computeDanishResult(household(), {
      saleTerms: { ownerCostMonthly: 3900, publicValuation: 2700000, landTaxPerMille: 5.7 },
    });
    expect(result.dk.running).toMatchObject({ ownerCostMonthly: 3900, source: 'advert' });
    expect(result.dk.params.publicValuation).toBe(2700000);
    expect(result.dk.params.landTaxPerMille).toBe(5.7);
    // Cash on hand is the profile's equity; skoede on 2,700,000 (the valuation beats the price):
    // 1,850 + 0.6 % of 2,700,000 = 1,850 + 16,200 = 18,050.
    expect(result.dk.params.cashAvailable).toBe(300000);
    expect(result.dk.oneOff.skoede.total).toBe(18050);
  });

  it('lets the advert win over the figures typed into the calculator page', () => {
    const profile = household({ dk: { ownerCostMonthly: 1000, publicValuation: 1000000 } });
    const result = computeDanishResult(profile, { saleTerms: { ownerCostMonthly: 3900 } });
    expect(result.dk.running.ownerCostMonthly).toBe(3900);
    // The advert states no valuation, so the typed one stands.
    expect(result.dk.params.publicValuation).toBe(1000000);
  });

  it('applies the user’s own choices from financing.dk', () => {
    const result = computeDanishResult(household({ dk: { downPaymentPct: 10, realkredit: { rate: 3 } } }));
    expect(result.dk.funding.downPayment).toBe(200000);
    expect(result.dk.loans.realkredit.annualRate).toBe(3);
  });

  it('shares the deduction threshold between two people', () => {
    const couple = household();
    couple.personB = { label: 'B', enabled: true, age: 33, primaryIncome: 20000, secondaryIncome: 0 };
    expect(danishParamsFor(normalizeProfile(couple)).persons).toBe(2);
    expect(danishParamsFor(normalizeProfile(household())).persons).toBe(1);
  });

  it('judges the monthly cost against the 35 % rule', () => {
    // 2,000,000 kr on the defaults: loans 10,738 gross, 8,379 net of rentefradrag. Plus a 3,000 kr
    // ejerudgift = 11,379 of the 14,000 kr ceiling: 28 % of 40,000 net income -> affordable.
    const result = computeDanishResult(household(), { saleTerms: { ownerCostMonthly: 3000 } });
    expect(result.dk.totalMonthly.net).toBeCloseTo(11379, -1);
    expect(result.verdict).toBe('affordable');
    expect(result.rateShareOfNetIncome).toBeCloseTo(11379 / 40000, 2);
    // A dearer home on the same household is a stretch, then out of reach.
    const dear = computeDanishResult(household({ purchasePrice: 3200000 }), { saleTerms: { ownerCostMonthly: 3000 } });
    expect(['stretch', 'unaffordable']).toContain(dear.verdict);
    const absurd = computeDanishResult(household({ purchasePrice: 9000000 }), {
      saleTerms: { ownerCostMonthly: 3000 },
    });
    expect(absurd.verdict).toBe('unaffordable');
  });

  it('reports the highest price inside the budget', () => {
    const result = computeDanishResult(household(), { saleTerms: { ownerCostMonthly: 3000 } });
    const max = result.recommendation.maxAffordablePrice;
    expect(max).toBeGreaterThan(2000000);
    const atMax = computeDanishResult(household({ purchasePrice: max }), { saleTerms: { ownerCostMonthly: 3000 } });
    expect(atMax.dk.totalMonthly.net).toBeLessThanOrEqual(result.budget.headroom);
  });

  it('gives each person a debt-free age from the longer loan', () => {
    const result = computeDanishResult(household());
    // 30-year realkredit is the longest: 35 + 30 = 65.
    expect(result.debtFreeAges[0].ageWhenDebtFree).toBe(65);
  });
});

describe('isDanishMarket / isDanishProfileComplete', () => {
  it('reads the market off the buying block', () => {
    expect(isDanishMarket({ financing: { market: 'dk' } })).toBe(true);
    expect(isDanishMarket({ financing: { market: 'de' } })).toBe(false);
    expect(isDanishMarket({ financing: {} })).toBe(false);
    expect(isDanishMarket(null)).toBe(false);
  });

  it('needs an income, living costs and a saved buying block, not equity or a Bundesland', () => {
    expect(isDanishProfileComplete(household())).toBe(true);
    expect(isDanishProfileComplete({ ...household(), livingCosts: null })).toBe(false);
    expect(isDanishProfileComplete({ ...household(), financing: undefined })).toBe(false);
    expect(isDanishProfileComplete({ ...household(), personA: { enabled: true, primaryIncome: 0 } })).toBe(false);
    expect(isDanishProfileComplete(null)).toBe(false);
  });
});

describe('validateProfile with Danish inputs', () => {
  it('accepts a profile without a Danish block exactly as before', () => {
    expect(validateProfile(household())).toBeNull();
  });

  it('refuses a rate or amount that makes no sense', () => {
    expect(validateProfile(household({ dk: { realkredit: { rate: 400 } } }))).toMatch(/between 0 and 100/);
    expect(validateProfile(household({ dk: { lenderFees: -5 } }))).toMatch(/negative/);
  });
});
