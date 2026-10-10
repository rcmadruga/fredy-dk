/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * How a listing score is shown: the colour band a number falls in, a metric's value with its unit,
 * and the target band underneath it. Pure functions of the score the API sent, so the card, the chip
 * and their tests share one reading of it.
 */

/** Totals at or above this are "good". */
export const GOOD_FROM = 70;

/** Totals at or above this, and below {@link GOOD_FROM}, are "fair"; below it, "poor". */
export const FAIR_FROM = 40;

/**
 * The band a score falls in: at least 70 is good, 40 to 69 fair, below 40 poor.
 *
 * @param {number|null|undefined} score
 * @returns {'good'|'fair'|'poor'|null} `null` when there is no score to band.
 */
export function bandOf(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  const rounded = Math.round(score);
  if (rounded >= GOOD_FROM) return 'good';
  return rounded >= FAIR_FROM ? 'fair' : 'poor';
}

/**
 * @param {number} value
 * @param {string} locale
 * @param {number} [digits]
 * @returns {string}
 */
function number(value, locale, digits = 0) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

/**
 * A metric's value with its unit, as the breakdown shows it.
 *
 * @param {number|null|undefined} value
 * @param {string} unit The unit of the metric descriptor (`min`, `km`, `ratio`, ...).
 * @param {Object} env
 * @param {(key: string, vars?: Record<string, string>) => string} env.t
 * @param {string} env.locale
 * @param {string} [env.currency='EUR'] For prices per m².
 * @returns {string} The text, or the translated "unknown" for a value that is not there.
 */
export function formatMetricValue(value, unit, { t, locale, currency = 'EUR' }) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return t('score.unknown');
  switch (unit) {
    case 'min':
      return `${number(value, locale)} min`;
    case 'km':
      return `${number(value, locale, 1)} km`;
    case 'm':
      return `${number(value, locale)} m`;
    case 'm2':
      return `${number(value, locale)} m²`;
    case 'pct':
      return `${number(value, locale, Math.abs(value) < 10 ? 1 : 0)} %`;
    case 'ratio':
      // A ratio of 1.2 reads better as "120 %": it is a share of a ceiling, a valuation or a sale price.
      return `${number(value * 100, locale)} %`;
    case 'krPerM2':
      return `${number(value, locale)} ${t('score.unit.krPerM2')}`;
    case 'eurPerM2':
      return `${new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)}/m²`;
    case 'days':
      return `${number(value, locale)} ${t('score.unit.days')}`;
    case 'years':
      return `${number(value, locale)} ${t('score.unit.years')}`;
    case 'mbit':
      return `${number(value, locale)} Mbit/s`;
    case 'grade':
      return number(value, locale, 1);
    case 'bool':
      return t(value >= 0.5 ? 'score.yes' : 'score.no');
    default:
      return number(value, locale, 1);
  }
}

/**
 * The target band of a metric, as one line.
 *
 * @param {{ideal: number|null, worst: number|null, unit: string}} metric
 * @param {Object} env See {@link formatMetricValue}.
 * @returns {string|null} `null` when the metric has no usable targets.
 */
export function formatTargetBand(metric, env) {
  if (!Number.isFinite(metric?.ideal) || !Number.isFinite(metric?.worst)) return null;
  return env.t('score.target', {
    ideal: formatMetricValue(metric.ideal, metric.unit, env),
    worst: formatMetricValue(metric.worst, metric.unit, env),
  });
}

/**
 * What the radar draws for a score: one entry per spoke, in the API's fixed order, so the shape is
 * the same however the weights are set. A group switched off keeps its spoke at the centre and is
 * marked, so a pentagon stays a pentagon and a hexagon a hexagon.
 *
 * @param {import('../../../../lib/services/score/score.js').ListingScore|Object} score
 * @param {(key: string, vars?: Record<string, string>) => string} t
 * @returns {Array<{id: string, label: string, value: number, state: 'ok'|'missing'|'off'}>}
 */
export function radarSpokes(score, t) {
  return (score?.groups ?? []).map((group) => ({
    id: group.id,
    label: t(`score.group.${group.id}`),
    value: group.off || !Number.isFinite(group.score) ? 0 : group.score,
    state: group.off ? 'off' : group.missing ? 'missing' : 'ok',
  }));
}
