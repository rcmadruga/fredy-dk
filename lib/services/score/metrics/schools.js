/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { COVERAGE_RADIUS_KM, NEARBY_RADIUS_KM, NEAREST_FALLBACK_COUNT, schoolsByDistance } from '../schoolsData.js';

/**
 * The Schools group. Denmark only: the data is the Danish school layer, which needs the operator's
 * `UDDANNELSESSTATISTIK_API_KEY`. Outside Denmark, or without a key, there is no school layer or
 * the listing lies beyond it, and every metric here is missing (50).
 */

/**
 * The schools around a listing, or `null` when the layer does not cover it.
 *
 * Covered means some school lies within {@link COVERAGE_RADIUS_KM}: the layer is national, so a
 * listing further than that from every school is not in the country it describes.
 *
 * @param {Object} listing
 * @param {import('./types.js').ScoreContext} ctx
 * @returns {Array<import('../schoolsData.js').ScoredSchool & {km: number}>|null}
 */
function schoolsAround(listing, ctx) {
  const lat = Number(listing?.latitude);
  const lng = Number(listing?.longitude);
  if (listing?.latitude == null || listing?.longitude == null) return null;
  const sorted = schoolsByDistance(ctx?.schools, lat, lng);
  return sorted.length > 0 && sorted[0].km <= COVERAGE_RADIUS_KM ? sorted : null;
}

/**
 * Average grade of the schools within {@link NEARBY_RADIUS_KM}, or of the
 * {@link NEAREST_FALLBACK_COUNT} nearest graded schools when none lies that close.
 *
 * @param {Object} listing
 * @param {import('./types.js').ScoreContext} ctx
 * @returns {number|null}
 */
export function nearbyGrade(listing, ctx) {
  const around = schoolsAround(listing, ctx);
  if (around == null) return null;
  const graded = around.filter((school) => school.gradeAverage != null);
  if (graded.length === 0) return null;
  const close = graded.filter((school) => school.km <= NEARBY_RADIUS_KM);
  const used = close.length > 0 ? close : graded.slice(0, NEAREST_FALLBACK_COUNT);
  return used.reduce((sum, school) => sum + school.gradeAverage, 0) / used.length;
}

/**
 * Distance in km to the nearest school with a special-class offer.
 *
 * @param {Object} listing
 * @param {import('./types.js').ScoreContext} ctx
 * @returns {number|null}
 */
export function nearestSpecialKm(listing, ctx) {
  const around = schoolsAround(listing, ctx);
  if (around == null) return null;
  const special = around.find((school) => (school.specialClassPct ?? 0) > 0);
  return special ? special.km : null;
}

/** @type {import('./types.js').MetricDescriptor[]} */
export const SCHOOLS_METRICS = [
  {
    id: 'nearby',
    group: 'schools',
    labelKey: 'score.metric.schools.nearby',
    unit: 'grade',
    direction: 'higher',
    raw: nearbyGrade,
    defaults: () => ({ ideal: 7, worst: 4 }),
  },
  {
    id: 'special',
    group: 'schools',
    labelKey: 'score.metric.schools.special',
    unit: 'km',
    direction: 'lower',
    raw: nearestSpecialKm,
    defaults: () => ({ ideal: 2, worst: 10 }),
  },
  {
    id: 'area',
    group: 'schools',
    labelKey: 'score.metric.schools.area',
    unit: 'grade',
    direction: 'higher',
    qualifier: 'kommune',
    raw: (_listing, ctx) => {
      const average = ctx?.kommuneCode == null ? null : ctx?.schools?.kommuneAverages?.[ctx.kommuneCode];
      const national = ctx?.schools?.nationalAverage;
      return Number.isFinite(average) && Number.isFinite(national) ? average - national : null;
    },
    defaults: () => ({ ideal: 0.5, worst: -0.5 }),
  },
];
