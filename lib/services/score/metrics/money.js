/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { scoreDanishListing } from '../../finance/dk/listingVerdict.js';
import { DEAL_TYPES } from '../../dealType.js';
import {
  computeBudget,
  isProfileComplete,
  isRentProfileComplete,
  scoreListing as financeVerdict,
  scoreRentListing as financeRentVerdict,
} from '../../finance/affordability.js';

/**
 * The Money group. Three metrics, three different questions, so the price is not counted three
 * times over: `value` is the price against the market, `budget` is the price against the job's own
 * cap, and `affordable` is the monthly burden against the household's income.
 */

/** The smallest sample a percentile band is worth drawing from. Fewer listings say nothing about a market. */
export const MIN_BAND_SAMPLE = 5;

/**
 * The value at a fraction of a sorted list, interpolating between neighbours.
 *
 * @param {number[]} sorted Ascending.
 * @param {number} fraction 0 to 1.
 * @returns {number}
 */
function percentile(sorted, fraction) {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * The default targets of `money.value`: the 25th and 90th percentile of the price per m² across a
 * job's active listings. Cheaper than three quarters of what the job finds scores close to full,
 * dearer than nine in ten scores zero.
 *
 * @param {Array<number|null|undefined>} prices Price per m² of each listing in the sample.
 * @returns {{low: number, high: number}|null} `null` for a sample too small to mean anything, or
 *   one where every listing costs the same (no line to score on).
 */
export function pricePerSqmBand(prices) {
  const sorted = (Array.isArray(prices) ? prices : [])
    .filter((price) => typeof price === 'number' && Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);
  if (sorted.length < MIN_BAND_SAMPLE) return null;
  const low = percentile(sorted, 0.25);
  const high = percentile(sorted, 0.9);
  return high > low ? { low, high } : null;
}

/**
 * Price per m² of a listing: the stored column, else worked out from price and size.
 *
 * @param {Object} listing
 * @returns {number|null}
 */
export function listingPricePerSqm(listing) {
  const stored = Number(listing?.price_per_sqm);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const price = Number(listing?.price);
  const size = Number(listing?.size);
  return Number.isFinite(price) && Number.isFinite(size) && price > 0 && size > 0 ? price / size : null;
}

/**
 * The monthly cost of a listing over the most the household's finances allow for housing.
 *
 * Reads the existing affordability verdict and never recomputes it: a purchase is its first
 * instalment, a rental its warm rent (with the Nebenkosten surcharge unless the rent is quoted with
 * the charges, exactly as the verdict does). The ceiling is the stricter of the two limits the
 * verdict's classifier applies, the 35 % rule's headroom and what is physically left after living
 * costs. A household with no room at all scores the worst ratio the metric reports.
 *
 * @param {Object} listing
 * @param {Object|null|undefined} profile
 * @param {{danish?: boolean}} [options] `danish` for a listing whose provider prices in kroner.
 * @returns {number|null} `null` without a complete profile or a usable price.
 */
export function affordabilityRatio(listing, profile, { danish = false } = {}) {
  const isRent = listing?.dealType === DEAL_TYPES.RENT;
  // A purchase priced in kroner is judged by the Danish model, as the verdict chip and the
  // affordability filter judge it. The German model would read a krone price as euros.
  const verdict =
    danish && !isRent
      ? scoreDanishListing(listing, profile)
      : (isRent ? isRentProfileComplete(profile) : isProfileComplete(profile))
        ? isRent
          ? financeRentVerdict(listing, profile)
          : financeVerdict(listing, profile)
        : null;
  if (verdict == null || !Number.isFinite(verdict.monthlyPayment)) return null;
  const budget = computeBudget(profile);
  const ceiling = Math.min(budget.headroom, budget.disposable);
  return ceiling > 0 ? verdict.monthlyPayment / ceiling : MAX_RATIO;
}

/** What `money.affordable` reports for a household with no room for housing at all. */
const MAX_RATIO = 2;

/** @type {import('./types.js').MetricDescriptor[]} */
export const MONEY_METRICS = [
  {
    id: 'value',
    group: 'money',
    labelKey: 'score.metric.money.value',
    unit: 'eurPerM2',
    direction: 'lower',
    raw: (listing) => listingPricePerSqm(listing),
    defaults: (ctx) => (ctx?.pricePerSqm ? { ideal: ctx.pricePerSqm.low, worst: ctx.pricePerSqm.high } : null),
  },
  {
    id: 'affordable',
    group: 'money',
    labelKey: 'score.metric.money.affordable',
    unit: 'ratio',
    direction: 'lower',
    raw: (listing, ctx) => affordabilityRatio(listing, ctx?.financeProfile, { danish: ctx?.danish === true }),
    defaults: () => ({ ideal: 0.75, worst: 1 }),
  },
  {
    id: 'budget',
    group: 'money',
    labelKey: 'score.metric.money.budget',
    unit: 'ratio',
    direction: 'lower',
    raw: (listing, ctx) => {
      const price = Number(listing?.price);
      const cap = Number(ctx?.job?.maxPrice);
      return Number.isFinite(price) && price > 0 && Number.isFinite(cap) && cap > 0 ? price / cap : null;
    },
    defaults: () => ({ ideal: 0.8, worst: 1 }),
  },
  {
    // TODO(Phase C, step 14): the 3-year change in the area's price per m2. Until the valuation
    // trend source exists there is nothing to read, so it scores missing (50) and shows as unknown.
    id: 'trend',
    group: 'money',
    labelKey: 'score.metric.money.trend',
    unit: 'pct',
    direction: 'higher',
    buyOnly: true,
    qualifier: 'kommune',
    raw: () => null,
    defaults: () => ({ ideal: 15, worst: -5 }),
  },
];
