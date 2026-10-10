/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { finiteNumber } from './saleTermsReader.js';

/**
 * A transparent estimate of what a home costs to keep up, in kroner per m² per year. It is a
 * heuristic and always shown as an estimate: a rule of thumb about age, roof, energy label and
 * heating, not a survey of the house.
 *
 * ```
 * base by age (years since built or last renovated):  <10: 80 | 10-30: 150 | 30-60: 250 | >60: 350
 * +100 if the roof is fibre cement (often asbestos, from BBR roofingMaterial)
 * + 50 if the energy label is E, F or G
 * - 30 if the heating is district heating (fjernvarme)
 * ```
 *
 * Every number is an editable default. The inputs come from `sale_terms` (BBR via Boligsiden). If an
 * input is missing, its term drops out; with no age at all there is no base and no estimate.
 */

/**
 * The constants of the estimate, all in kr/m²/year. Exported so they can be changed in one place
 * and so tests can pin them.
 */
export const UPKEEP_CONSTANTS = Object.freeze({
  /** Base by age band: homes younger than `under` years cost `perM2`. The last band has no limit. */
  ageBands: Object.freeze([
    Object.freeze({ under: 10, perM2: 80 }),
    Object.freeze({ under: 30, perM2: 150 }),
    Object.freeze({ under: 61, perM2: 250 }),
    Object.freeze({ under: Infinity, perM2: 350 }),
  ]),
  fibreCementRoof: 100,
  poorEnergyLabel: 50,
  districtHeating: -30,
});

/** The letters of the energy labels that cost extra to heat. */
const POOR_LABELS = ['E', 'F', 'G'];

/**
 * @param {unknown} roof BBR's roofing material, in Danish or English.
 * @returns {boolean}
 */
function isFibreCement(roof) {
  return typeof roof === 'string' && /fiber\s*cement|fibre\s*cement|eternit|asbest/i.test(roof);
}

/**
 * @param {unknown} heating
 * @returns {boolean}
 */
function isDistrictHeating(heating) {
  return typeof heating === 'string' && /fjernvarme|district/i.test(heating);
}

/**
 * @param {unknown} label `A`-`G`, or the longer forms (`A2020`).
 * @returns {boolean}
 */
function isPoorLabel(label) {
  if (typeof label !== 'string') return false;
  const letter = label.trim().charAt(0).toUpperCase();
  return POOR_LABELS.includes(letter);
}

/**
 * Years since the home was built or last renovated, whichever is later.
 *
 * @param {{yearBuilt?: unknown, yearRenovated?: unknown}|null} terms
 * @param {number} currentYear
 * @returns {number|null} `null` without a plausible year. A year in the future is a data error,
 *   not a new house, and a year before 1000 is not a year.
 */
export function ageInYears(terms, currentYear) {
  const years = [terms?.yearBuilt, terms?.yearRenovated]
    .map(finiteNumber)
    .filter((year) => year != null && year >= 1000 && year <= currentYear);
  return years.length === 0 ? null : currentYear - Math.max(...years);
}

/**
 * Estimate the yearly upkeep of a home.
 *
 * @param {Object|null} terms A listing's sale terms (`yearBuilt`, `yearRenovated`, `roofingMaterial`,
 *   `energyLabel`, `heating`).
 * @param {Object} [options]
 * @param {number} [options.currentYear] The year ages are counted to. Defaults to this year.
 * @param {typeof UPKEEP_CONSTANTS} [options.constants] Replacement constants.
 * @returns {number|null} kr/m²/year, never negative; `null` when the age is unknown.
 */
export function estimateUpkeep(terms, { currentYear = new Date().getFullYear(), constants = UPKEEP_CONSTANTS } = {}) {
  const age = ageInYears(terms, currentYear);
  if (age == null) return null;

  const band = constants.ageBands.find((candidate) => age < candidate.under);
  let perM2 = band ? band.perM2 : constants.ageBands[constants.ageBands.length - 1].perM2;
  if (isFibreCement(terms?.roofingMaterial)) perM2 += constants.fibreCementRoof;
  if (isPoorLabel(terms?.energyLabel)) perM2 += constants.poorEnergyLabel;
  if (isDistrictHeating(terms?.heating)) perM2 += constants.districtHeating;
  return Math.max(0, perM2);
}
