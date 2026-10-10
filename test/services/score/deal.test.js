/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { DEAL_METRICS, RELISTED_GAP_DAYS, lastFreeMarketSale } from '../../../lib/services/score/metrics/deal.js';
import { scoreListing } from '../../../lib/services/score/score.js';

const byId = (id) => DEAL_METRICS.find((metric) => metric.id === id);
const buy = (terms, extra = {}) => ({ dealType: 'buy', price: 3000000, sale_terms: terms, ...extra });
const dealGroup = (listing, ids = DEAL_METRICS.map((m) => m.id), ctx = {}) =>
  scoreListing(
    listing,
    null,
    ctx,
    DEAL_METRICS.filter((m) => ids.includes(m.id)),
  ).groups[5];

describe('lastFreeMarketSale', () => {
  it('takes the newest sale of type normal', () => {
    const terms = {
      sales: [
        { date: '2021-05-01', amount: 2500000, type: 'normal' },
        { date: '2023-02-01', amount: 2600000, type: 'family' },
        { date: '2018-01-01', amount: 2000000, type: 'normal' },
      ],
    };
    expect(lastFreeMarketSale(terms)).toEqual({ date: '2021-05-01', amount: 2500000 });
  });

  it('ignores sales that are not a market price', () => {
    expect(lastFreeMarketSale({ sales: [{ date: '2021-05-01', amount: 1, type: 'auction' }] })).toBeNull();
    expect(lastFreeMarketSale({ sales: [{ date: '2021-05-01', amount: 1 }] })).toBeNull();
  });

  it('is null without sales', () => {
    expect(lastFreeMarketSale({ sales: [] })).toBeNull();
    expect(lastFreeMarketSale({})).toBeNull();
    expect(lastFreeMarketSale(null)).toBeNull();
  });

  it('ignores a sale without an amount or a date', () => {
    expect(lastFreeMarketSale({ sales: [{ date: '2021-05-01', amount: 0, type: 'normal' }] })).toBeNull();
    expect(lastFreeMarketSale({ sales: [{ amount: 5, type: 'normal' }] })).toBeNull();
  });
});

describe('deal.vsValuation', () => {
  const vsValuation = byId('vsValuation');

  it('is the asking price over the public valuation', () => {
    expect(vsValuation.raw(buy({ publicValuation: 2500000 }))).toBe(1.2);
  });

  it('is missing without a valuation or a price, or on a listing without sale terms', () => {
    expect(vsValuation.raw(buy({ publicValuation: null }))).toBeNull();
    expect(vsValuation.raw(buy({}, { price: null }))).toBeNull();
    expect(vsValuation.raw({ dealType: 'buy', price: 3000000 })).toBeNull();
  });

  it('scores 1.0 as 100 and 1.6 as 0', () => {
    expect(dealGroup(buy({ publicValuation: 3000000 }), ['vsValuation']).score).toBe(100);
    expect(dealGroup(buy({ publicValuation: 3000000 / 1.3 }), ['vsValuation']).score).toBe(50);
    expect(dealGroup(buy({ publicValuation: 3000000 / 1.6 }), ['vsValuation']).score).toBe(0);
  });
});

describe('deal.vsLastSale', () => {
  const vsLastSale = byId('vsLastSale');
  const terms = { sales: [{ date: '2020-06-01', amount: 2500000, type: 'normal' }] };

  it('is the plain ratio until a trend exists', () => {
    expect(vsLastSale.raw(buy(terms), {})).toBe(1.2);
  });

  it('inflates the last sale by the area trend since that date', () => {
    const seen = [];
    const ctx = {
      appreciationSince: (date) => {
        seen.push(date);
        return 1.2;
      },
    };
    expect(vsLastSale.raw(buy(terms), ctx)).toBe(1);
    expect(seen).toEqual(['2020-06-01']);
  });

  it('ignores an unusable trend factor', () => {
    expect(vsLastSale.raw(buy(terms), { appreciationSince: () => null })).toBe(1.2);
    expect(vsLastSale.raw(buy(terms), { appreciationSince: () => 0 })).toBe(1.2);
    expect(vsLastSale.raw(buy(terms), { appreciationSince: () => NaN })).toBe(1.2);
  });

  it('is missing without a free-market sale', () => {
    expect(vsLastSale.raw(buy({ sales: [] }), {})).toBeNull();
    expect(vsLastSale.raw(buy({ sales: [{ date: '2020-06-01', amount: 1, type: 'other' }] }), {})).toBeNull();
    expect(vsLastSale.raw({ dealType: 'buy', price: 1 }, {})).toBeNull();
  });
});

describe('deal.priceDrop', () => {
  const priceDrop = byId('priceDrop');

  it('is the change since first listed', () => {
    expect(priceDrop.raw(buy({ priceChangePct: -8 }))).toBe(-8);
    expect(priceDrop.raw(buy({ priceChangePct: 0 }))).toBe(0);
  });

  it('is missing when the portal did not say', () => {
    expect(priceDrop.raw(buy({ priceChangePct: null }))).toBeNull();
    expect(priceDrop.raw({ dealType: 'buy' })).toBeNull();
  });

  it('scores a 10 % cut as 100 and no change as 0', () => {
    expect(dealGroup(buy({ priceChangePct: -10 }), ['priceDrop']).score).toBe(100);
    expect(dealGroup(buy({ priceChangePct: -5 }), ['priceDrop']).score).toBe(50);
    expect(dealGroup(buy({ priceChangePct: 0 }), ['priceDrop']).score).toBe(0);
    expect(dealGroup(buy({ priceChangePct: 4 }), ['priceDrop']).score).toBe(0);
  });
});

describe('deal.onMarket', () => {
  const onMarket = byId('onMarket');

  it('is the total days on the market', () => {
    expect(onMarket.raw(buy({ daysOnMarket: { current: 30, total: 200 } }))).toBe(200);
  });

  it('is missing without it', () => {
    expect(onMarket.raw(buy({ daysOnMarket: { current: null, total: null } }))).toBeNull();
    expect(onMarket.raw(buy({}))).toBeNull();
  });

  it('scores 120 days as 100 and a week as 0', () => {
    expect(dealGroup(buy({ daysOnMarket: { total: 120 } }), ['onMarket']).score).toBe(100);
    expect(dealGroup(buy({ daysOnMarket: { total: 7 } }), ['onMarket']).score).toBe(0);
    expect(dealGroup(buy({ daysOnMarket: { total: 400 } }), ['onMarket']).score).toBe(100);
  });
});

describe('deal.relisted', () => {
  const relisted = byId('relisted');

  it('is 1 when the total exceeds the current stay by the gap', () => {
    expect(relisted.raw(buy({ daysOnMarket: { current: 20, total: 20 + RELISTED_GAP_DAYS } }))).toBe(1);
    expect(relisted.raw(buy({ daysOnMarket: { current: 10, total: 400 } }))).toBe(1);
  });

  it('is 0 below the gap', () => {
    expect(relisted.raw(buy({ daysOnMarket: { current: 20, total: 20 + RELISTED_GAP_DAYS - 1 } }))).toBe(0);
    expect(relisted.raw(buy({ daysOnMarket: { current: 90, total: 90 } }))).toBe(0);
  });

  it('is missing when either figure is', () => {
    expect(relisted.raw(buy({ daysOnMarket: { current: null, total: 100 } }))).toBeNull();
    expect(relisted.raw(buy({ daysOnMarket: { total: 100 } }))).toBeNull();
    expect(relisted.raw(buy({}))).toBeNull();
  });
});

describe('the Deal group', () => {
  it('registers five buy-only metrics', () => {
    expect(DEAL_METRICS.map((metric) => metric.id)).toEqual([
      'vsValuation',
      'vsLastSale',
      'priceDrop',
      'onMarket',
      'relisted',
    ]);
    expect(DEAL_METRICS.every((metric) => metric.group === 'deal' && metric.buyOnly)).toBe(true);
  });

  it('is entirely missing for a listing with no sale terms', () => {
    const group = dealGroup({ dealType: 'buy', price: 3000000 });
    expect(group).toMatchObject({ id: 'deal', missing: true, score: 50 });
  });

  it('does not exist for a rental', () => {
    const result = scoreListing({ dealType: 'rent' }, null, {}, DEAL_METRICS);
    expect(result.groups.map((g) => g.id)).not.toContain('deal');
  });
});
