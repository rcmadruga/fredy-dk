/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { DEAL_TYPES } from '../dealType.js';
import { METRICS } from './metrics/index.js';

/**
 * The listing score: pure arithmetic over metric descriptors, with no database, no cache and no
 * network. `context.js` is the one module that fetches what the descriptors need; everything here
 * can be tested with plain objects.
 *
 * A listing is scored in groups, each the weighted mean of its metrics, and the total is the
 * weighted mean of the groups. Every metric turns a raw value into 0-100 against two numbers the
 * user owns, an ideal and a worst, with a straight line between them.
 */

/**
 * What a metric with no value scores. Neutral on purpose: an unknown is neither good nor bad, and
 * it is flagged `missing` so the UI can say so instead of passing a guess off as a measurement.
 */
export const MISSING_SCORE = 50;

/**
 * The groups, in the fixed order of the radar's spokes. The same corner always means the same
 * group, so nobody has to re-read the chart for every listing.
 *
 * @type {ReadonlyArray<import('./metrics/types.js').GroupId>}
 */
export const GROUP_IDS = Object.freeze(['money', 'schools', 'work', 'home', 'area', 'deal']);

/** The group that only exists for a purchase. */
const BUY_ONLY_GROUPS = Object.freeze(['deal']);

/**
 * The groups a listing of this deal type is scored in, in spoke order.
 *
 * A purchase gets all six, a rental the five without Deal. The set depends on the deal type and on
 * nothing else, so the radar's shape never changes with weights or data.
 *
 * @param {string|null|undefined} dealType
 * @returns {Array<import('./metrics/types.js').GroupId>}
 */
export function groupsFor(dealType) {
  return dealType === DEAL_TYPES.BUY ? [...GROUP_IDS] : GROUP_IDS.filter((id) => !BUY_ONLY_GROUPS.includes(id));
}

/**
 * Turn a measured value into 0-100 against the user's two targets.
 *
 * ```
 * clamp(0, 100, 100 x (worst - value) / (worst - ideal))
 * ```
 *
 * One line covers both directions: `ideal < worst` means lower is better and `ideal > worst` means
 * higher is better. Past the ideal scores 100, past the worst scores 0. A boolean metric uses ideal
 * 1 and worst 0.
 *
 * @param {number} value
 * @param {number} ideal
 * @param {number} worst
 * @returns {number|null} `null` when any input is not a finite number or the targets coincide,
 *   since the line between them then has no slope to read a value off.
 */
export function targetScore(value, ideal, worst) {
  if (![value, ideal, worst].every((n) => typeof n === 'number' && Number.isFinite(n)) || ideal === worst) {
    return null;
  }
  const score = (100 * (worst - value)) / (worst - ideal);
  return Math.min(100, Math.max(0, score));
}

/**
 * A weight from a config, or the fallback when it is not usable. Zero is usable and switches the
 * thing off; negative, non-numeric and non-finite values are not.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function weightOf(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {number} n
 * @returns {number} Rounded to one decimal, which is all the precision the inputs carry.
 */
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * The targets a metric is scored with: the job's, falling back per field to the metric's defaults.
 *
 * @param {import('./metrics/types.js').MetricDescriptor} metric
 * @param {Object|null|undefined} config
 * @param {import('./metrics/types.js').ScoreContext} ctx
 * @returns {{ideal: number, worst: number, custom: boolean}|null} `null` when either end is unknown.
 */
function resolveTarget(metric, config, ctx) {
  let defaults = null;
  try {
    defaults = metric.defaults(ctx) ?? null;
  } catch {
    defaults = null;
  }
  const override = config?.targets?.[`${metric.group}.${metric.id}`];
  const ideal = finiteOrNull(override?.ideal) ?? finiteOrNull(defaults?.ideal);
  const worst = finiteOrNull(override?.worst) ?? finiteOrNull(defaults?.worst);
  if (ideal == null || worst == null) return null;
  return {
    ideal,
    worst,
    custom: finiteOrNull(override?.ideal) != null || finiteOrNull(override?.worst) != null,
  };
}

/**
 * @typedef {Object} ScoredMetric
 * @property {string} id
 * @property {import('./metrics/types.js').GroupId} group
 * @property {string} key `<group>.<id>`, as the config spells it.
 * @property {string} labelKey
 * @property {string} unit
 * @property {'lower'|'higher'} direction
 * @property {'kommune'|'estimate'|null} qualifier
 * @property {number|null} raw The measured value, `null` when there is none.
 * @property {number|null} score 0-100; `null` only for a metric switched off.
 * @property {boolean} missing No value (or no usable targets): the score is the neutral 50.
 * @property {boolean} off Weight 0: left out of its group.
 * @property {number} weight
 * @property {number|null} ideal
 * @property {number|null} worst
 * @property {boolean} customTarget Whether the job overrides the default targets.
 */

/**
 * @typedef {Object} ScoredGroup
 * @property {import('./metrics/types.js').GroupId} id
 * @property {number|null} score 0-100; `null` when the group is off.
 * @property {number} weight
 * @property {boolean} off Weighted 0, or every metric in it is: it keeps its spoke but takes no part.
 * @property {boolean} missing Every metric that counts is missing, so the score is the neutral 50.
 * @property {ScoredMetric[]} metrics
 */

/**
 * @typedef {Object} ListingScore
 * @property {number|null} total 0-100, `null` when every group is off.
 * @property {'rent'|'buy'} dealType Which shape the groups take.
 * @property {ScoredGroup[]} groups In spoke order: six for a purchase, five for a rental.
 */

/**
 * Score one metric of one listing.
 *
 * @param {import('./metrics/types.js').MetricDescriptor} metric
 * @param {Object} listing
 * @param {Object|null|undefined} config
 * @param {import('./metrics/types.js').ScoreContext} ctx
 * @returns {ScoredMetric}
 */
function scoreMetric(metric, listing, config, ctx) {
  const key = `${metric.group}.${metric.id}`;
  const weight = weightOf(config?.metrics?.[key], weightOf(metric.defaultWeight, 1));
  const target = resolveTarget(metric, config, ctx);

  let raw = null;
  try {
    raw = finiteOrNull(metric.raw(listing, ctx));
  } catch {
    // A metric that cannot be read is an unknown, not a reason to lose the whole score.
    raw = null;
  }

  const base = {
    id: metric.id,
    group: metric.group,
    key,
    labelKey: metric.labelKey,
    unit: metric.unit,
    direction: metric.direction,
    qualifier: metric.qualifier ?? null,
    raw,
    weight,
    ideal: target?.ideal ?? null,
    worst: target?.worst ?? null,
    customTarget: target?.custom ?? false,
  };

  if (weight === 0) {
    return { ...base, score: null, missing: false, off: true };
  }
  const scored = raw == null || target == null ? null : targetScore(raw, target.ideal, target.worst);
  if (scored == null) {
    return { ...base, score: MISSING_SCORE, missing: true, off: false };
  }
  return { ...base, score: round1(scored), missing: false, off: false };
}

/**
 * Score a listing.
 *
 * The groups follow {@link groupsFor}: a purchase is scored in six, a rental in five, and buy-only
 * metrics are left out of a rental altogether rather than counted as missing, so a rental is judged
 * over what applies to it. A group weighted 0, or whose metrics are all weighted 0, stays in the
 * result flagged `off` so the shape of the chart does not change with the user's weights.
 *
 * @param {Object} listing A listing row; `dealType` decides the shape.
 * @param {Object|null} [config] The job's `score_config`, every part optional.
 * @param {import('./metrics/types.js').ScoreContext} [ctx] Data the metrics need, see `context.js`.
 * @param {import('./metrics/types.js').MetricDescriptor[]} [metrics] The registry; tests pass their own.
 * @returns {ListingScore}
 */
export function scoreListing(listing, config = null, ctx = {}, metrics = METRICS) {
  const isBuy = listing?.dealType === DEAL_TYPES.BUY;
  const dealType = isBuy ? DEAL_TYPES.BUY : DEAL_TYPES.RENT;

  const groups = groupsFor(dealType).map((id) => {
    const weight = weightOf(config?.groups?.[id], 1);
    const scored = metrics
      .filter((metric) => metric.group === id && (isBuy || !metric.buyOnly))
      .map((metric) => scoreMetric(metric, listing, config, ctx));
    const counted = scored.filter((metric) => !metric.off);

    if (weight === 0 || counted.length === 0) {
      return { id, score: null, weight, off: true, missing: false, metrics: scored };
    }
    const weightSum = counted.reduce((sum, metric) => sum + metric.weight, 0);
    const mean = counted.reduce((sum, metric) => sum + metric.score * metric.weight, 0) / weightSum;
    const allMissing = counted.every((metric) => metric.missing);
    return {
      id,
      score: allMissing ? MISSING_SCORE : round1(mean),
      weight,
      off: false,
      missing: allMissing,
      metrics: scored,
    };
  });

  const counted = groups.filter((group) => !group.off);
  const weightSum = counted.reduce((sum, group) => sum + group.weight, 0);
  const total =
    counted.length === 0
      ? null
      : round1(counted.reduce((sum, group) => sum + group.score * group.weight, 0) / weightSum);

  return { total, dealType, groups };
}
