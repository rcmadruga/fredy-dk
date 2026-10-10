/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { buildDanishFinanceFacts, buildSaleFacts } from '../../ui/src/views/listings/listingFacts.js';
import { computeDanishResult } from '../../lib/services/finance/dk/result.js';
import { formatPrice } from '../../ui/src/services/price/priceService.js';

// Echoes the key and its values, so an assertion can say which line carries what without depending
// on wording.
const t = (key, params) => (params ? `${key}(${Object.values(params).join(',')})` : key);
const money = (n) => formatPrice(Math.round(n), 'en', null, 'DKK');

const profile = {
  personA: { label: 'A', enabled: true, age: 35, primaryIncome: 40000, secondaryIncome: 0 },
  livingCosts: 12000,
  financing: { purchasePrice: 2000000, equity: 300000, market: 'dk' },
};
const result = (terms = null) => computeDanishResult(profile, { saleTerms: terms });
const byId = (facts) => Object.fromEntries(facts.map((fact) => [fact.id, fact]));

describe('buildDanishFinanceFacts', () => {
  it('leads with the monthly cost after tax relief, in kroner', () => {
    const r = result({ ownerCostMonthly: 3000 });
    const { facts } = buildDanishFinanceFacts(r, { t, locale: 'en' });

    expect(facts[0]).toMatchObject({ id: 'monthly', emphasis: true, value: money(r.dk.totalMonthly.net) });
    expect(facts[0].note).toBeUndefined();
    expect(byId(facts).loans.value).toBe(money(r.dk.payment.net));
    expect(byId(facts).loans.note).toContain(money(r.dk.payment.gross));
    expect(byId(facts).cash.value).toBe(money(141250));
  });

  it('says so when the monthly cost is the loans alone', () => {
    const { facts } = buildDanishFinanceFacts(result(), { t, locale: 'en' });

    expect(byId(facts).monthly.note).toBe('listing.detail.dkMonthlyLoansOnly');
    expect(byId(facts).ownerCost.value).toBe('listing.detail.dkOwnerCostUnknown');
  });

  it('labels a tax estimate and what it leaves out', () => {
    // Valuation but no ejerudgift and no land value: ejendomsvaerdiskat only.
    const { facts } = buildDanishFinanceFacts(result({ publicValuation: 3000000 }), { t, locale: 'en' });

    // 3,000,000 * 0.8 * 0.0051 / 12 = 1,020 a month.
    expect(byId(facts).ownerCost.value).toBe(money(1020));
    expect(byId(facts).ownerCost.note).toBe('listing.detail.dkOwnerCostEstimateNoLand');
  });

  it('flags a shortfall against the cash on hand', () => {
    const poor = computeDanishResult({ ...profile, financing: { ...profile.financing, equity: 100000 } });
    const { facts } = buildDanishFinanceFacts(poor, { t, locale: 'en' });

    // Needs 141,250 and has 100,000.
    expect(byId(facts).cash.note).toBe(`listing.detail.dkCashShortfall(${money(41250)})`);
  });

  it('names the debt-free age and the rates the figures rest on', () => {
    const { facts, footnote } = buildDanishFinanceFacts(result(), { t, locale: 'en' });

    expect(byId(facts).debtFree.value).toBe('A 65');
    expect(footnote).toBe('listing.detail.dkFootnote(4,6)');
  });
});

describe('the sale card with your own figures', () => {
  const listing = {
    dealType: 'buy',
    price: 2000000,
    sale_terms: { ownerCostMonthly: 3900, grossPaymentMonthly: 35406, netPaymentMonthly: 28476 },
  };
  const ctx = { t, locale: 'en', currency: 'DKK' };

  it('puts the household’s monthly payments beside the realtor’s example', () => {
    const mine = result({ ownerCostMonthly: 3900 });
    const { costs } = buildSaleFacts(listing, { ...ctx, yourFinance: mine });
    const rows = byId(costs);

    expect(rows.yourGross.value).toBe(money(mine.dk.payment.gross));
    expect(rows.yourNet.value).toBe(money(mine.dk.payment.net));
    // Beside the example, not instead of it.
    expect(rows.grossPayment.value).toBe(money(35406));
    const ids = costs.map((row) => row.id);
    expect(ids.indexOf('yourGross')).toBeGreaterThan(ids.indexOf('netPayment'));
  });

  it('shows nothing of the kind before a profile exists', () => {
    const { costs } = buildSaleFacts(listing, { ...ctx, yourFinance: null });
    expect(costs.map((row) => row.id)).not.toContain('yourGross');
  });

  it('ignores a German result', () => {
    const { costs } = buildSaleFacts(listing, { ...ctx, yourFinance: { financing: {}, model: undefined } });
    expect(costs.map((row) => row.id)).not.toContain('yourNet');
  });
});
