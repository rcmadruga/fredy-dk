/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The metrics of the listing score, as the job form needs to know them.
 *
 * The browser cannot import from `lib/`, so the part of the server's metric descriptors the form
 * reads is copied here: which metrics exist, in which group, in what unit, at what default weight and
 * with which default targets. `test/ui/scoreMetricCatalog.test.js` fails if the two drift apart.
 *
 * A default target of `null` means the server works it out per job (`money.value` from the spread of
 * the job's own listings, `home.size` from the job's minimum size), and the form shows "automatic".
 */

/**
 * The groups, in the fixed order of the radar's spokes.
 * @type {ReadonlyArray<'money'|'schools'|'work'|'home'|'area'|'deal'>}
 */
export const SCORE_GROUPS = Object.freeze(['money', 'schools', 'work', 'home', 'area', 'deal']);

/**
 * @typedef {Object} CatalogMetric
 * @property {string} key `<group>.<id>`, as the stored config spells it.
 * @property {string} group
 * @property {string} id
 * @property {string} labelKey
 * @property {string} unit
 * @property {boolean} buyOnly
 * @property {number} defaultWeight
 * @property {number|null} ideal Default target, `null` when it depends on the job.
 * @property {number|null} worst
 */

const metric = (group, id, unit, ideal, worst, extra = {}) => ({
  key: `${group}.${id}`,
  group,
  id,
  labelKey: `score.metric.${group}.${id}`,
  unit,
  buyOnly: false,
  defaultWeight: 1,
  ideal,
  worst,
  ...extra,
});

/** @type {ReadonlyArray<CatalogMetric>} */
export const SCORE_METRICS = Object.freeze([
  metric('money', 'value', 'eurPerM2', null, null),
  metric('money', 'affordable', 'ratio', 0.75, 1),
  metric('money', 'budget', 'ratio', 0.8, 1),
  metric('money', 'trend', 'pct', 15, -5, { buyOnly: true }),
  metric('schools', 'nearby', 'grade', 7, 4),
  metric('schools', 'special', 'km', 2, 10),
  metric('schools', 'area', 'grade', 0.5, -0.5),
  metric('work', 'commute', 'min', 20, 60),
  metric('work', 'jobs', 'count', 20, 0, { defaultWeight: 0.5 }),
  metric('work', 'options', 'count', 6, 0),
  metric('home', 'size', 'm2', null, null),
  metric('home', 'bathrooms', 'count', 2, 1),
  metric('home', 'internet', 'mbit', 1000, 50),
  metric('home', 'newBuild', 'years', 5, 60, { buyOnly: true }),
  metric('home', 'upkeep', 'krPerM2', 100, 400, { buyOnly: true }),
  metric('home', 'parking', 'bool', 1, 0, { defaultWeight: 0.5 }),
  metric('area', 'grocery', 'min', 5, 20),
  metric('area', 'park', 'min', 5, 20),
  metric('area', 'green', 'pct', 30, 5),
  metric('area', 'quiet', 'm', 500, 50),
  metric('area', 'social', 'pct', 10, -10),
  metric('area', 'safety', 'pct', -25, 25),
  metric('deal', 'vsValuation', 'ratio', 1, 1.6, { buyOnly: true }),
  metric('deal', 'vsLastSale', 'ratio', 1, 1.4, { buyOnly: true }),
  metric('deal', 'priceDrop', 'pct', -10, 0, { buyOnly: true }),
  metric('deal', 'onMarket', 'days', 120, 7, { buyOnly: true }),
  metric('deal', 'relisted', 'bool', 1, 0, { buyOnly: true }),
]);

/**
 * The groups a job of this deal type is scored in. A purchase has all six, a rental the five
 * without Deal.
 *
 * @param {string|null|undefined} dealType
 * @returns {string[]}
 */
export function groupsForDealType(dealType) {
  return dealType === 'buy' ? [...SCORE_GROUPS] : SCORE_GROUPS.filter((group) => group !== 'deal');
}

/**
 * The metrics of one group that apply to a job of this deal type.
 *
 * @param {string} group
 * @param {string|null|undefined} dealType
 * @returns {CatalogMetric[]}
 */
export function metricsOfGroup(group, dealType) {
  return SCORE_METRICS.filter((entry) => entry.group === group && (dealType === 'buy' || !entry.buyOnly));
}
