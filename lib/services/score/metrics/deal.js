/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { finiteNumber, saleTermsOf } from '../saleTermsReader.js';

/**
 * The Deal group, purchases only: how good and how safe the purchase is as a transaction. Every
 * metric reads `sale_terms` (the Danish purchase facts from `feat/dk-buying`), so for now it is
 * Boligsiden-only; any other listing scores the whole group missing (50).
 *
 * `onMarket`, `priceDrop` and `relisted` reward negotiating room: a home that has sat for months,
 * or been relisted or reduced, is one where the buyer has leverage. That is a buyer's view, and the
 * tooltip says so. The scam flag stays out of it: that is rental-fraud detection and a separate badge.
 */

/**
 * A home offered this many days longer in total than with its current realtor has been relisted.
 * The same figure as `RELISTED_GAP_DAYS` in `services/sale/saleTerms.js` on the `feat/dk-buying`
 * branch, which is not merged here; reconcile the two at merge.
 */
export const RELISTED_GAP_DAYS = 60;

/**
 * The asking price over a positive figure, or null.
 *
 * @param {unknown} price
 * @param {unknown} base
 * @returns {number|null}
 */
function ratio(price, base) {
  const p = finiteNumber(price);
  const b = finiteNumber(base);
  return p != null && p > 0 && b != null && b > 0 ? p / b : null;
}

/**
 * The most recent free-market sale of the address. Sales of another type (family, auction) are not
 * a market price and are never compared as one.
 *
 * @param {Object|null} terms
 * @returns {{date: string, amount: number}|null}
 */
export function lastFreeMarketSale(terms) {
  const sales = Array.isArray(terms?.sales) ? terms.sales : [];
  const normal = sales
    .filter((sale) => sale?.type === 'normal' && finiteNumber(sale.amount) > 0 && typeof sale.date === 'string')
    .sort((a, b) => b.date.localeCompare(a.date));
  return normal.length === 0 ? null : { date: normal[0].date, amount: finiteNumber(normal[0].amount) };
}

/** @type {import('./types.js').MetricDescriptor[]} */
export const DEAL_METRICS = [
  {
    id: 'vsValuation',
    group: 'deal',
    labelKey: 'score.metric.deal.vsValuation',
    unit: 'ratio',
    direction: 'lower',
    buyOnly: true,
    raw: (listing) => ratio(listing?.price, saleTermsOf(listing)?.publicValuation),
    defaults: () => ({ ideal: 1, worst: 1.6 }),
  },
  {
    // The last sale, inflated by the area's price trend since that date. Until the trend source
    // exists (Phase C, step 14) `ctx.appreciationSince` is absent and the ratio is the plain one.
    id: 'vsLastSale',
    group: 'deal',
    labelKey: 'score.metric.deal.vsLastSale',
    unit: 'ratio',
    direction: 'lower',
    buyOnly: true,
    raw: (listing, ctx) => {
      const sale = lastFreeMarketSale(saleTermsOf(listing));
      if (sale == null) return null;
      const factor =
        typeof ctx?.appreciationSince === 'function' ? finiteNumber(ctx.appreciationSince(sale.date)) : null;
      return ratio(listing?.price, sale.amount * (factor != null && factor > 0 ? factor : 1));
    },
    defaults: () => ({ ideal: 1, worst: 1.4 }),
  },
  {
    id: 'priceDrop',
    group: 'deal',
    labelKey: 'score.metric.deal.priceDrop',
    unit: 'pct',
    direction: 'lower',
    buyOnly: true,
    raw: (listing) => finiteNumber(saleTermsOf(listing)?.priceChangePct),
    defaults: () => ({ ideal: -10, worst: 0 }),
  },
  {
    id: 'onMarket',
    group: 'deal',
    labelKey: 'score.metric.deal.onMarket',
    unit: 'days',
    direction: 'higher',
    buyOnly: true,
    raw: (listing) => finiteNumber(saleTermsOf(listing)?.daysOnMarket?.total),
    defaults: () => ({ ideal: 120, worst: 7 }),
  },
  {
    id: 'relisted',
    group: 'deal',
    labelKey: 'score.metric.deal.relisted',
    unit: 'bool',
    direction: 'higher',
    buyOnly: true,
    raw: (listing) => {
      const days = saleTermsOf(listing)?.daysOnMarket;
      const total = finiteNumber(days?.total);
      const current = finiteNumber(days?.current);
      return total != null && current != null ? Number(total - current >= RELISTED_GAP_DAYS) : null;
    },
    defaults: () => ({ ideal: 1, worst: 0 }),
  },
];
