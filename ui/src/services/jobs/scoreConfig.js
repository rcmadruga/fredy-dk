/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { SCORE_METRICS } from '../score/metricCatalog.js';

/**
 * Editing a job's `scoreConfig` in the form.
 *
 * Every function takes the config as it is and returns the next one, never mutating. A value equal to
 * the default is not stored, and a config with nothing set is `null`: that is what the server stores
 * for "all defaults", and it keeps the form's dirty check from reading an untouched slider as an edit.
 */

/** The weight a group has when the job sets none. */
export const DEFAULT_GROUP_WEIGHT = 1;

/**
 * Weights the group sliders offer, in steps of half.
 * @type {{min: number, max: number, step: number}}
 */
export const GROUP_WEIGHT_RANGE = Object.freeze({ min: 0, max: 3, step: 0.5 });

const defaultMetricWeight = (key) => SCORE_METRICS.find((entry) => entry.key === key)?.defaultWeight ?? 1;

/**
 * @param {Object} config
 * @returns {Object|null} The config without its empty parts, `null` if nothing is left.
 */
function tidy(config) {
  const next = {};
  for (const [section, value] of Object.entries(config)) {
    if (value != null && typeof value === 'object' && Object.keys(value).length > 0) {
      next[section] = value;
    }
  }
  return Object.keys(next).length === 0 ? null : next;
}

/**
 * @param {unknown} value
 * @returns {number|null} A finite number, or `null` for an empty or unusable input.
 */
export function toNumber(value) {
  if (value === '' || value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Set a section's key, or remove it when `value` is `null`.
 *
 * @param {Object|null} config
 * @param {string} section
 * @param {string} key
 * @param {unknown} value
 * @returns {Object|null}
 */
function setIn(config, section, key, value) {
  const sectionValue = { ...(config?.[section] ?? {}) };
  if (value == null) delete sectionValue[key];
  else sectionValue[key] = value;
  return tidy({ ...(config ?? {}), [section]: sectionValue });
}

/**
 * @param {Object|null} config
 * @param {string} group
 * @param {unknown} weight
 * @returns {Object|null}
 */
export function setGroupWeight(config, group, weight) {
  const n = toNumber(weight);
  return setIn(config, 'groups', group, n == null || n === DEFAULT_GROUP_WEIGHT ? null : n);
}

/**
 * @param {Object|null} config
 * @param {string} key `<group>.<metric>`
 * @param {unknown} weight
 * @returns {Object|null}
 */
export function setMetricWeight(config, key, weight) {
  const n = toNumber(weight);
  return setIn(config, 'metrics', key, n == null || n === defaultMetricWeight(key) ? null : n);
}

/**
 * Set one end of a metric's target. Emptying both ends removes the target.
 *
 * @param {Object|null} config
 * @param {string} key `<group>.<metric>`
 * @param {'ideal'|'worst'} field
 * @param {unknown} value
 * @returns {Object|null}
 */
export function setTarget(config, key, field, value) {
  const target = { ...(config?.targets?.[key] ?? {}) };
  const n = toNumber(value);
  if (n == null) delete target[field];
  else target[field] = n;
  return setIn(config, 'targets', key, Object.keys(target).length === 0 ? null : target);
}

/**
 * @param {Object|null} config
 * @param {string|null} label The saved address `work.commute` measures to, `null` for the default.
 * @returns {Object|null}
 */
export function setCommuteLabel(config, label) {
  const text = typeof label === 'string' && label.trim() !== '' ? { label } : null;
  return setIn(config, 'commute', 'label', text == null ? null : text.label);
}

/**
 * Whether a metric's targets cannot work: both ends given and equal, which leaves no line to read a
 * value off. The server refuses it, so the form says so before saving.
 *
 * @param {Object|null} config
 * @param {string} key
 * @returns {boolean}
 */
export function hasCoincidingTarget(config, key) {
  const target = config?.targets?.[key];
  return target?.ideal != null && target.ideal === target.worst;
}

/**
 * How many things the job changes from the defaults, for a one-line summary.
 *
 * @param {Object|null} config
 * @returns {number}
 */
export function countScoreCustomisations(config) {
  if (config == null) return 0;
  return (
    Object.keys(config.groups ?? {}).length +
    Object.keys(config.metrics ?? {}).length +
    Object.keys(config.targets ?? {}).length +
    (config.commute?.label ? 1 : 0)
  );
}
