/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The Work group: how far the user's workplace is, and how much work there is nearby.
 */

const MODES = ['transit', 'car', 'bike', 'walk'];

/**
 * The travel-time address `work.commute` measures to.
 *
 * The job's `score_config.commute.label` wins. Without one, a job whose commute filter
 * (`commute_filter.limits`, migration 35) names exactly one address gets that one: somebody who
 * limited the trip to "Work" has already said where work is. Two or more labels would be a guess,
 * so the metric is missing until the job names one.
 *
 * @param {{commute?: {label?: unknown}}|null|undefined} scoreConfig
 * @param {{limits?: Record<string, number>}|null|undefined} commuteFilter
 * @returns {string|null}
 */
export function resolveCommuteLabel(scoreConfig, commuteFilter) {
  const configured = scoreConfig?.commute?.label;
  if (typeof configured === 'string' && configured.trim().length > 0) return configured;
  const labels = Object.keys(commuteFilter?.limits ?? {});
  return labels.length === 1 ? labels[0] : null;
}

/**
 * Minutes from the listing to the commute address.
 *
 * Judged in the mode the user picked for the address, not the fastest one, exactly as the commute
 * filter does: a 30-minute target next to "Public transport" is a statement about the train. An
 * exact journey beats an estimate if the listing somehow carries both for one label.
 *
 * @param {Object} listing
 * @param {import('./types.js').ScoreContext} ctx
 * @returns {number|null}
 */
export function commuteMinutes(listing, ctx) {
  const label = ctx?.commuteLabel;
  if (label == null || !Array.isArray(listing?.travelTimes)) return null;
  const entries = listing.travelTimes
    .filter((entry) => entry?.label === label)
    .sort((a, b) => Number(a.estimate !== false) - Number(b.estimate !== false));
  for (const entry of entries) {
    const candidates = [ctx.commuteMode, entry.mode].map((mode) => String(mode ?? '').toLowerCase());
    const mode = candidates.find((candidate) => MODES.includes(candidate)) ?? 'transit';
    const minutes = entry[mode]?.minutes;
    if (Number.isFinite(minutes)) return minutes;
  }
  return null;
}

/** @type {import('./types.js').MetricDescriptor[]} */
export const WORK_METRICS = [
  {
    id: 'commute',
    group: 'work',
    labelKey: 'score.metric.work.commute',
    unit: 'min',
    direction: 'lower',
    raw: commuteMinutes,
    defaults: () => ({ ideal: 20, worst: 60 }),
  },
  {
    // One occupation only, and the jobs layer is a kommune count: half weight by default.
    id: 'jobs',
    group: 'work',
    labelKey: 'score.metric.work.jobs',
    unit: 'count',
    direction: 'higher',
    qualifier: 'kommune',
    defaultWeight: 0.5,
    raw: (_listing, ctx) => (Number.isFinite(ctx?.kommuneJobs) ? ctx.kommuneJobs : null),
    defaults: () => ({ ideal: 20, worst: 0 }),
  },
  {
    // TODO(Phase C, step 17): distinct transit lines with a stop within 500 m, from the Overpass
    // sweeper. Until then it scores missing (50) and shows as unknown.
    id: 'options',
    group: 'work',
    labelKey: 'score.metric.work.options',
    unit: 'count',
    direction: 'higher',
    raw: () => null,
    defaults: () => ({ ideal: 6, worst: 0 }),
  },
];
