/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { finiteNumber, saleTermsOf } from '../saleTermsReader.js';
import { ageInYears, estimateUpkeep } from '../upkeep.js';
import { parkingForListing } from '../parkingText.js';

/**
 * The Home group: the dwelling itself. The building metrics read `sale_terms` (the Danish purchase
 * facts) and are missing for a listing without them; `upkeep` and `parking` are heuristics and are
 * labelled as estimates wherever they are shown.
 */

/**
 * The year ages are counted to. The context may pin it, which keeps scores reproducible in tests.
 *
 * @param {import('./types.js').ScoreContext} ctx
 * @returns {number}
 */
const yearOf = (ctx) => finiteNumber(ctx?.currentYear) ?? new Date().getFullYear();

/** @type {import('./types.js').MetricDescriptor[]} */
export const HOME_METRICS = [
  {
    id: 'size',
    group: 'home',
    labelKey: 'score.metric.home.size',
    unit: 'm2',
    direction: 'higher',
    raw: (listing) => {
      const size = finiteNumber(listing?.size);
      return size != null && size > 0 ? size : null;
    },
    // 40 % above the job's minimum is the ideal; the minimum itself is the worst the job accepts.
    defaults: (ctx) => {
      const min = finiteNumber(ctx?.job?.minSize);
      return min != null && min > 0 ? { ideal: Math.round(min * 1.4 * 10) / 10, worst: min } : null;
    },
  },
  {
    id: 'bathrooms',
    group: 'home',
    labelKey: 'score.metric.home.bathrooms',
    unit: 'count',
    direction: 'higher',
    raw: (listing) => finiteNumber(saleTermsOf(listing)?.bathrooms),
    defaults: () => ({ ideal: 2, worst: 1 }),
  },
  {
    id: 'internet',
    group: 'home',
    labelKey: 'score.metric.home.internet',
    unit: 'mbit',
    direction: 'higher',
    raw: (listing) => {
      const down = finiteNumber(listing?.connectivity_max_down);
      return down != null && down > 0 ? down : null;
    },
    defaults: () => ({ ideal: 1000, worst: 50 }),
  },
  {
    id: 'newBuild',
    group: 'home',
    labelKey: 'score.metric.home.newBuild',
    unit: 'years',
    direction: 'lower',
    buyOnly: true,
    raw: (listing, ctx) => {
      const terms = saleTermsOf(listing) ?? {};
      // The advert's own build year (the listing column) stands in when the sale terms give none.
      return ageInYears(
        { yearBuilt: terms.yearBuilt ?? listing?.build_year, yearRenovated: terms.yearRenovated },
        yearOf(ctx),
      );
    },
    defaults: () => ({ ideal: 5, worst: 60 }),
  },
  {
    id: 'upkeep',
    group: 'home',
    labelKey: 'score.metric.home.upkeep',
    unit: 'krPerM2',
    direction: 'lower',
    buyOnly: true,
    qualifier: 'estimate',
    raw: (listing, ctx) => {
      const terms = saleTermsOf(listing);
      return terms == null ? null : estimateUpkeep(terms, { currentYear: yearOf(ctx) });
    },
    defaults: () => ({ ideal: 100, worst: 400 }),
  },
  {
    // A mention in the advert says there is parking, a negation says there is none, and silence says
    // nothing (missing), so half weight by default.
    id: 'parking',
    group: 'home',
    labelKey: 'score.metric.home.parking',
    unit: 'bool',
    direction: 'higher',
    qualifier: 'estimate',
    defaultWeight: 0.5,
    raw: (listing) => parkingForListing(listing),
    defaults: () => ({ ideal: 1, worst: 0 }),
  },
];
