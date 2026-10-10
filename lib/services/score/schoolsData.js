/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { distanceMeters } from '../listings/distanceCalculator.js';

/**
 * The school layer reduced to what the Schools group reads, plus the aggregates it needs. Pure: the
 * layer itself comes from `getSchoolLayer()` and the kommune of a school from the geo lookup, both
 * handed in by `context.js`.
 *
 * @typedef {Object} ScoredSchool
 * @property {number} lat
 * @property {number} lng
 * @property {number|null} gradeAverage Average of the 9th-grade exams; null where the school has none.
 * @property {number|null} specialClassPct The share of pupils taught in separate special classes.
 * @property {number|null} pupils
 */

/**
 * @typedef {Object} SchoolsData
 * @property {ScoredSchool[]} schools Every school the layer could place.
 * @property {number|null} nationalAverage The pupil-weighted national grade average.
 * @property {Record<string, number>} kommuneAverages The same per kommune code.
 */

/**
 * How far from a listing the nearest school may be for the layer to count as covering it. The layer
 * is Danish, so a listing further than this from every school is outside the country (or on a
 * remote island), and scoring a German flat against the nearest Danish school would be nonsense.
 */
export const COVERAGE_RADIUS_KM = 15;

/** The radius inside which schools count as "nearby", in km. */
export const NEARBY_RADIUS_KM = 2;

/** How many of the nearest graded schools stand in when none lies within {@link NEARBY_RADIUS_KM}. */
export const NEAREST_FALLBACK_COUNT = 3;

/**
 * Pupil-weighted mean of grade averages.
 *
 * @param {Array<{gradeAverage: number|null, pupils: number|null}>} schools
 * @returns {number|null} `null` when none of them has a grade.
 */
function weightedGrade(schools) {
  let sum = 0;
  let weight = 0;
  for (const school of schools) {
    if (!Number.isFinite(school.gradeAverage)) continue;
    // A school with an unknown roll still counts, as a school of one: dropping it would bias the
    // average towards the schools that happen to report their numbers.
    const w = Number.isFinite(school.pupils) && school.pupils > 0 ? school.pupils : 1;
    sum += school.gradeAverage * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

/**
 * Reduce the school layer to {@link SchoolsData}.
 *
 * @param {Array<import('../regionalData/schoolClient.js').SchoolStat>} schools The layer's schools.
 * @param {(lat: number, lng: number) => ({code: string}|null)} kommuneOf Which kommune a point is in.
 * @returns {SchoolsData}
 */
export function buildSchoolsData(schools, kommuneOf) {
  /** @type {ScoredSchool[]} */
  const placed = (Array.isArray(schools) ? schools : [])
    .filter((school) => Number.isFinite(school?.lat) && Number.isFinite(school?.lng))
    .map((school) => ({
      lat: school.lat,
      lng: school.lng,
      gradeAverage: Number.isFinite(school.gradeAverage) ? school.gradeAverage : null,
      specialClassPct: Number.isFinite(school.specialClassPct) ? school.specialClassPct : null,
      pupils: Number.isFinite(school.pupils) ? school.pupils : null,
    }));

  /** @type {Map<string, ScoredSchool[]>} */
  const byKommune = new Map();
  for (const school of placed) {
    if (school.gradeAverage == null) continue;
    const code = kommuneOf(school.lat, school.lng)?.code;
    if (code == null) continue;
    const list = byKommune.get(code);
    if (list) list.push(school);
    else byKommune.set(code, [school]);
  }

  /** @type {Record<string, number>} */
  const kommuneAverages = {};
  for (const [code, list] of byKommune) {
    const average = weightedGrade(list);
    if (average != null) kommuneAverages[code] = average;
  }
  return { schools: placed, nationalAverage: weightedGrade(placed), kommuneAverages };
}

/**
 * The schools around a point, nearest first.
 *
 * @param {SchoolsData|null|undefined} data
 * @param {number} lat
 * @param {number} lng
 * @returns {Array<ScoredSchool & {km: number}>}
 */
export function schoolsByDistance(data, lat, lng) {
  if (!data?.schools?.length || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  return data.schools
    .map((school) => ({ ...school, km: distanceMeters(lat, lng, school.lat, school.lng) / 1000 }))
    .sort((a, b) => a.km - b.km);
}
