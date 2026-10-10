/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { GROUP_IDS } from './score.js';
import { METRICS } from './metrics/index.js';

/**
 * The job's `score_config`: what the user weights and the targets they score against.
 *
 * ```json
 * {
 *   "groups":  { "money": 1, "deal": 0.5 },
 *   "metrics": { "home.parking": 0, "work.jobs": 0.5 },
 *   "targets": { "work.commute": { "ideal": 20, "worst": 60 } },
 *   "commute": { "label": "Work" }
 * }
 * ```
 *
 * Everything is optional, and `null` means all defaults. A weight of 0 switches a metric or a group
 * off. Nothing here is the score itself, which is computed on read.
 *
 * @typedef {Object} ScoreConfig
 * @property {Partial<Record<import('./metrics/types.js').GroupId, number>>} [groups]
 * @property {Record<string, number>} [metrics] Keyed `<group>.<metric>`.
 * @property {Record<string, Partial<import('./metrics/types.js').Target>>} [targets] Keyed like `metrics`.
 * @property {{label: string}} [commute] The saved address `work.commute` measures to.
 */

/** The most a weight may be. Weights are relative, so a bound only guards against nonsense input. */
export const MAX_WEIGHT = 100;

/** The longest address label kept. */
const MAX_LABEL_LENGTH = 120;

/** Every key a config may name a metric by, e.g. `home.parking`. */
export const METRIC_KEYS = Object.freeze(METRICS.map((metric) => `${metric.group}.${metric.id}`));

const isRecord = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const isWeight = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_WEIGHT;
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Check a score config as a client sent it and reduce it to what is stored.
 *
 * Problems are reported rather than silently dropped, because a mistyped weight that quietly does
 * nothing is a score the user cannot explain. Only empty things are dropped without complaint: a
 * config that sets nothing is the same as no config and normalises to `null`.
 *
 * @param {unknown} raw As posted, or as stored.
 * @returns {{config: ScoreConfig|null, errors: string[]}} `config` is `null` when there is nothing
 *   to store or when `errors` is not empty.
 */
export function validateScoreConfig(raw) {
  if (raw == null) return { config: null, errors: [] };
  if (!isRecord(raw)) return { config: null, errors: ['scoreConfig must be an object'] };

  /** @type {string[]} */
  const errors = [];
  /** @type {ScoreConfig} */
  const config = {};

  if (raw.groups != null) {
    if (!isRecord(raw.groups)) {
      errors.push('scoreConfig.groups must be an object');
    } else {
      const groups = {};
      for (const [id, weight] of Object.entries(raw.groups)) {
        if (!GROUP_IDS.includes(id)) errors.push(`scoreConfig.groups: unknown group "${id}"`);
        else if (!isWeight(weight)) errors.push(`scoreConfig.groups.${id} must be a number from 0 to ${MAX_WEIGHT}`);
        else groups[id] = weight;
      }
      if (Object.keys(groups).length > 0) config.groups = groups;
    }
  }

  if (raw.metrics != null) {
    if (!isRecord(raw.metrics)) {
      errors.push('scoreConfig.metrics must be an object');
    } else {
      const metrics = {};
      for (const [key, weight] of Object.entries(raw.metrics)) {
        if (!METRIC_KEYS.includes(key)) errors.push(`scoreConfig.metrics: unknown metric "${key}"`);
        else if (!isWeight(weight)) errors.push(`scoreConfig.metrics.${key} must be a number from 0 to ${MAX_WEIGHT}`);
        else metrics[key] = weight;
      }
      if (Object.keys(metrics).length > 0) config.metrics = metrics;
    }
  }

  if (raw.targets != null) {
    if (!isRecord(raw.targets)) {
      errors.push('scoreConfig.targets must be an object');
    } else {
      const targets = {};
      for (const [key, target] of Object.entries(raw.targets)) {
        if (!METRIC_KEYS.includes(key)) {
          errors.push(`scoreConfig.targets: unknown metric "${key}"`);
          continue;
        }
        if (!isRecord(target)) {
          errors.push(`scoreConfig.targets.${key} must be an object with ideal and worst`);
          continue;
        }
        const kept = {};
        for (const field of ['ideal', 'worst']) {
          // An emptied input arrives as null: it means "use the default", not an error.
          if (target[field] == null || target[field] === '') continue;
          if (isNumber(target[field])) kept[field] = target[field];
          else errors.push(`scoreConfig.targets.${key}.${field} must be a number`);
        }
        if (kept.ideal != null && kept.ideal === kept.worst) {
          errors.push(`scoreConfig.targets.${key}: ideal and worst must differ`);
        } else if (Object.keys(kept).length > 0) {
          targets[key] = kept;
        }
      }
      if (Object.keys(targets).length > 0) config.targets = targets;
    }
  }

  if (raw.commute != null) {
    if (!isRecord(raw.commute)) {
      errors.push('scoreConfig.commute must be an object');
    } else if (raw.commute.label != null && raw.commute.label !== '') {
      if (typeof raw.commute.label !== 'string') errors.push('scoreConfig.commute.label must be text');
      else if (raw.commute.label.trim() !== '')
        config.commute = { label: raw.commute.label.slice(0, MAX_LABEL_LENGTH) };
    }
  }

  if (errors.length > 0) return { config: null, errors };
  return { config: Object.keys(config).length > 0 ? config : null, errors };
}

/**
 * A stored config, reduced to something safe to score with. Lenient where {@link validateScoreConfig}
 * is strict: a row written by hand or by a newer version scores with whatever in it is usable
 * instead of failing the page it is on.
 *
 * @param {unknown} raw
 * @returns {ScoreConfig|null}
 */
export function readScoreConfig(raw) {
  if (!isRecord(raw)) return null;
  const pick = (source, accept) =>
    Object.fromEntries(Object.entries(isRecord(source) ? source : {}).filter(([key, value]) => accept(key, value)));
  const targets = {};
  for (const [key, target] of Object.entries(
    pick(raw.targets, (key, value) => METRIC_KEYS.includes(key) && isRecord(value)),
  )) {
    const kept = Object.fromEntries(
      ['ideal', 'worst'].filter((field) => isNumber(target[field])).map((f) => [f, target[f]]),
    );
    if (Object.keys(kept).length > 0 && !(kept.ideal != null && kept.ideal === kept.worst)) targets[key] = kept;
  }
  const config = {
    groups: pick(raw.groups, (key, value) => GROUP_IDS.includes(key) && isWeight(value)),
    metrics: pick(raw.metrics, (key, value) => METRIC_KEYS.includes(key) && isWeight(value)),
    targets,
    commute:
      typeof raw.commute?.label === 'string' && raw.commute.label.trim() !== ''
        ? { label: raw.commute.label }
        : undefined,
  };
  const cleaned = Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined && Object.keys(value).length > 0),
  );
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}
