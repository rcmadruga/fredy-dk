/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * English names for the score's groups and metrics, for the places that speak without the UI's
 * translations: the MCP tools hand a language model plain markdown. The wording is the English locale
 * of the web UI; `test/services/score/labels.test.js` fails if the two drift apart.
 */

/** @type {Readonly<Record<string, string>>} */
export const GROUP_LABELS = Object.freeze({
  money: 'Money',
  schools: 'Schools',
  work: 'Work',
  home: 'Home',
  area: 'Area',
  deal: 'Deal',
});

/** @type {Readonly<Record<string, string>>} Keyed `<group>.<metric>`. */
export const METRIC_LABELS = Object.freeze({
  'money.value': 'Price per m²',
  'money.affordable': 'Monthly cost against your ceiling',
  'money.budget': "Price against the job's maximum",
  'money.trend': 'Area price trend, 3 years',
  'schools.nearby': 'Grades of nearby schools',
  'schools.special': 'Distance to special-class schools',
  'schools.area': 'Kommune grades against the country',
  'work.commute': 'Commute to work',
  'work.jobs': 'Open jobs in the kommune',
  'work.options': 'Transit lines within walking distance',
  'home.size': 'Living space',
  'home.bathrooms': 'Bathrooms',
  'home.internet': 'Internet speed',
  'home.newBuild': 'Years since built or renovated',
  'home.upkeep': 'Estimated upkeep',
  'home.parking': 'Parking mentioned',
  'area.grocery': 'Walk to a supermarket',
  'area.park': 'Walk to a park',
  'area.green': 'Green area within 500 m',
  'area.quiet': 'Distance to motorway or railway',
  'area.social': 'Kommune income against the country',
  'area.safety': 'Reported crime against the country',
  'deal.vsValuation': 'Asking price against public valuation',
  'deal.vsLastSale': 'Asking price against last sale',
  'deal.priceDrop': 'Price change since first listed',
  'deal.onMarket': 'Days on the market',
  'deal.relisted': 'Relisted',
});

/** @type {Readonly<Record<string, string>>} */
export const QUALIFIER_LABELS = Object.freeze({
  kommune: 'kommune average',
  estimate: 'estimate',
});

/** Symbols appended to a value, by unit. Units not listed are written bare. */
const UNIT_SUFFIX = Object.freeze({
  min: ' min',
  km: ' km',
  m: ' m',
  m2: ' m²',
  pct: ' %',
  krPerM2: ' kr/m²/yr',
  eurPerM2: ' per m²',
  days: ' days',
  years: ' years',
  mbit: ' Mbit/s',
});

/**
 * A measured value in words, for a markdown line.
 *
 * @param {number|null|undefined} value
 * @param {string} unit A metric descriptor's unit.
 * @returns {string} `unknown` for a value that is not there.
 */
export function formatRaw(value, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  const round = (n, digits = 1) => String(Math.round(n * 10 ** digits) / 10 ** digits);
  if (unit === 'ratio') return `${round(value * 100, 0)} %`;
  if (unit === 'bool') return value >= 0.5 ? 'yes' : 'no';
  const digits = ['km', 'grade', 'pct'].includes(unit) ? 1 : 0;
  return `${round(value, digits)}${UNIT_SUFFIX[unit] ?? ''}`;
}
