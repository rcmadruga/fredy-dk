/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { SCHOOLS_METRICS, nearbyGrade, nearestSpecialKm } from '../../../lib/services/score/metrics/schools.js';
import { buildSchoolsData, schoolsByDistance } from '../../../lib/services/score/schoolsData.js';
import { scoreListing } from '../../../lib/services/score/score.js';

const byId = (id) => SCHOOLS_METRICS.find((metric) => metric.id === id);

// Roughly one kilometre of latitude is 0.009 degrees.
const KM = 0.009;
const origin = { latitude: 55.68, longitude: 12.57 };
const school = (km, extra = {}) => ({
  lat: origin.latitude + km * KM,
  lng: origin.longitude,
  gradeAverage: 7,
  specialClassPct: 0,
  pupils: 400,
  ...extra,
});
const dataOf = (schools, kommuneOf = () => null) => buildSchoolsData(schools, kommuneOf);

describe('buildSchoolsData', () => {
  it('weights the national average by pupils', () => {
    const data = dataOf([school(1, { gradeAverage: 10, pupils: 300 }), school(2, { gradeAverage: 4, pupils: 100 })]);
    expect(data.nationalAverage).toBe(8.5);
  });

  it('counts a school with an unknown roll as a school of one', () => {
    const data = dataOf([school(1, { gradeAverage: 10, pupils: null }), school(2, { gradeAverage: 4, pupils: null })]);
    expect(data.nationalAverage).toBe(7);
  });

  it('ignores schools without a grade in the averages but keeps them placed', () => {
    const data = dataOf([school(1, { gradeAverage: null }), school(2, { gradeAverage: 6 })]);
    expect(data.schools).toHaveLength(2);
    expect(data.nationalAverage).toBe(6);
  });

  it('averages per kommune', () => {
    const kommuneOf = (lat) => ({ code: lat > origin.latitude + 1.5 * KM ? '0200' : '0100' });
    const data = dataOf(
      [school(1, { gradeAverage: 9, pupils: 100 }), school(2, { gradeAverage: 5, pupils: 100 })],
      kommuneOf,
    );
    expect(data.kommuneAverages).toEqual({ '0100': 9, '0200': 5 });
  });

  it('skips a school outside every kommune', () => {
    const data = dataOf([school(1)], () => null);
    expect(data.kommuneAverages).toEqual({});
    expect(data.schools).toHaveLength(1);
  });

  it('drops schools that were never placed', () => {
    const data = dataOf([{ lat: null, lng: null, gradeAverage: 7 }, school(1)]);
    expect(data.schools).toHaveLength(1);
  });

  it('copes with nothing at all', () => {
    expect(dataOf(null)).toEqual({ schools: [], nationalAverage: null, kommuneAverages: {} });
  });
});

describe('schoolsByDistance', () => {
  it('sorts nearest first and measures in km', () => {
    const sorted = schoolsByDistance(dataOf([school(5), school(1), school(3)]), origin.latitude, origin.longitude);
    expect(sorted.map((s) => Math.round(s.km))).toEqual([1, 3, 5]);
  });

  it('is empty without data or coordinates', () => {
    expect(schoolsByDistance(null, 1, 1)).toEqual([]);
    expect(schoolsByDistance(dataOf([school(1)]), NaN, 1)).toEqual([]);
  });
});

describe('schools.nearby', () => {
  it('averages the graded schools within 2 km', () => {
    const schools = dataOf([
      school(0.5, { gradeAverage: 8 }),
      school(1.5, { gradeAverage: 6 }),
      school(1, { gradeAverage: null }),
      school(5, { gradeAverage: 12 }),
    ]);
    expect(nearbyGrade(origin, { schools })).toBe(7);
  });

  it('falls back to the three nearest graded schools when none is within 2 km', () => {
    const schools = dataOf([
      school(3, { gradeAverage: 9 }),
      school(4, { gradeAverage: 6 }),
      school(5, { gradeAverage: 6 }),
      school(6, { gradeAverage: 0 }),
    ]);
    expect(nearbyGrade(origin, { schools })).toBe(7);
  });

  it('is missing outside the layer', () => {
    const far = dataOf([school(40)]);
    expect(nearbyGrade(origin, { schools: far })).toBeNull();
  });

  it('is missing without a layer, coordinates or a graded school', () => {
    expect(nearbyGrade(origin, {})).toBeNull();
    expect(nearbyGrade(origin, { schools: dataOf([]) })).toBeNull();
    expect(nearbyGrade({}, { schools: dataOf([school(1)]) })).toBeNull();
    expect(nearbyGrade({ latitude: null, longitude: null }, { schools: dataOf([school(1)]) })).toBeNull();
    expect(nearbyGrade(origin, { schools: dataOf([school(1, { gradeAverage: null })]) })).toBeNull();
  });

  it('scores a 7 as 100 and a 4 as 0', () => {
    const score = (grade) =>
      scoreListing({ dealType: 'rent', ...origin }, null, { schools: dataOf([school(1, { gradeAverage: grade })]) }, [
        byId('nearby'),
      ]).groups[1].score;
    expect(score(7)).toBe(100);
    expect(score(5.5)).toBe(50);
    expect(score(4)).toBe(0);
  });
});

describe('schools.special', () => {
  it('is the distance to the nearest school with special classes', () => {
    const schools = dataOf([school(1), school(4, { specialClassPct: 8 }), school(6, { specialClassPct: 20 })]);
    expect(nearestSpecialKm(origin, { schools })).toBeCloseTo(4, 1);
  });

  it('is missing when no covered school has special classes', () => {
    expect(nearestSpecialKm(origin, { schools: dataOf([school(1), school(2)]) })).toBeNull();
  });

  it('is missing outside the layer', () => {
    expect(nearestSpecialKm(origin, { schools: dataOf([school(40, { specialClassPct: 8 })]) })).toBeNull();
    expect(nearestSpecialKm(origin, {})).toBeNull();
  });

  it('scores 2 km as 100 and 10 km as 0', () => {
    const metric = byId('special');
    const score = (km) =>
      scoreListing(
        { dealType: 'rent', ...origin },
        null,
        { schools: dataOf([school(1), school(km, { specialClassPct: 5 })]) },
        [metric],
      ).groups[1].score;
    expect(score(2)).toBe(100);
    expect(score(6)).toBeGreaterThan(40);
    expect(score(6)).toBeLessThan(60);
  });
});

describe('schools.area', () => {
  const area = byId('area');
  const schools = { schools: [], nationalAverage: 7, kommuneAverages: { '0101': 7.4, '0200': 6.2 } };

  it('is the kommune average minus the national average', () => {
    expect(area.raw({}, { kommuneCode: '0101', schools })).toBeCloseTo(0.4, 6);
    expect(area.raw({}, { kommuneCode: '0200', schools })).toBeCloseTo(-0.8, 6);
  });

  it('is labelled as a kommune average', () => {
    expect(area.qualifier).toBe('kommune');
  });

  it('is missing without a kommune, a layer or an average for that kommune', () => {
    expect(area.raw({}, { schools })).toBeNull();
    expect(area.raw({}, { kommuneCode: '0101' })).toBeNull();
    expect(area.raw({}, { kommuneCode: '9999', schools })).toBeNull();
    expect(area.raw({}, { kommuneCode: '0101', schools: { ...schools, nationalAverage: null } })).toBeNull();
  });

  it('scores +0.5 as 100 and -0.5 as 0', () => {
    const score = (kommuneCode) =>
      scoreListing({ dealType: 'rent' }, null, { kommuneCode, schools }, [area]).groups[1].score;
    expect(score('0101')).toBe(90);
    expect(score('0200')).toBe(0);
  });
});

describe('the Schools group', () => {
  it('registers nearby, special and area', () => {
    expect(SCHOOLS_METRICS.map((metric) => metric.id)).toEqual(['nearby', 'special', 'area']);
    expect(SCHOOLS_METRICS.every((metric) => metric.group === 'schools')).toBe(true);
  });

  it('is missing as a whole outside Denmark', () => {
    const result = scoreListing({ dealType: 'rent', latitude: 52.5, longitude: 13.4 }, null, {}, SCHOOLS_METRICS);
    const group = result.groups.find((g) => g.id === 'schools');
    expect(group).toMatchObject({ missing: true, score: 50 });
  });
});
