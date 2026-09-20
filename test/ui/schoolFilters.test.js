/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_SCHOOL_FILTERS,
  SCHOOL_CATEGORIES,
  SELECTABLE_CATEGORIES,
  categoryColor,
  categoryOf,
  filterSchools,
  hasActiveFilters,
  loadSchoolFilters,
  sanitizeSchoolFilters,
  saveSchoolFilters,
  schoolPassesFilters,
  scoreDomain,
} from '../../ui/src/components/map/schoolFilters.js';

const school = (overrides = {}) => ({
  id: '1',
  category: 'folkeskole',
  gradeAverage: 7,
  isSpecialSchool: false,
  ...overrides,
});
const filters = (overrides = {}) => sanitizeSchoolFilters({ ...DEFAULT_SCHOOL_FILTERS, ...overrides });

describe('schoolPassesFilters', () => {
  it('shows everything under the defaults', () => {
    for (const category of ['special', 'folkeskole', 'friskole', 'efterskole', 'other']) {
      expect(schoolPassesFilters(school({ category, gradeAverage: null }), filters())).toBe(true);
    }
  });

  it('hides special schools when their switch is off, and only them', () => {
    const off = filters({ showSpecial: false });
    expect(schoolPassesFilters(school({ category: 'special', gradeAverage: null }), off)).toBe(false);
    expect(schoolPassesFilters(school({ category: 'folkeskole' }), off)).toBe(true);
  });

  it('hides a kind whose box is unticked', () => {
    const noFriskole = filters({ categories: { friskole: false } });
    expect(schoolPassesFilters(school({ category: 'friskole' }), noFriskole)).toBe(false);
    expect(schoolPassesFilters(school({ category: 'folkeskole' }), noFriskole)).toBe(true);
    expect(schoolPassesFilters(school({ category: 'efterskole' }), noFriskole)).toBe(true);
  });

  it('keeps a school inside the score range, ends included, and drops the rest', () => {
    const range = filters({ scoreMin: 7, scoreMax: 9 });
    expect(schoolPassesFilters(school({ gradeAverage: 7 }), range)).toBe(true);
    expect(schoolPassesFilters(school({ gradeAverage: 9 }), range)).toBe(true);
    expect(schoolPassesFilters(school({ gradeAverage: 6.9 }), range)).toBe(false);
    expect(schoolPassesFilters(school({ gradeAverage: 9.1 }), range)).toBe(false);
  });

  it('treats a missing end of the range as no limit on that side', () => {
    expect(schoolPassesFilters(school({ gradeAverage: 12 }), filters({ scoreMin: 7 }))).toBe(true);
    expect(schoolPassesFilters(school({ gradeAverage: 3 }), filters({ scoreMax: 7 }))).toBe(true);
    expect(schoolPassesFilters(school({ gradeAverage: 3 }), filters({ scoreMin: 7 }))).toBe(false);
  });

  it('shows a school without a grade average only while asked to, and only once a range is set', () => {
    const unscored = school({ gradeAverage: null });
    expect(schoolPassesFilters(unscored, filters({ scoreMin: 7, includeUnscored: true }))).toBe(true);
    expect(schoolPassesFilters(unscored, filters({ scoreMin: 7, includeUnscored: false }))).toBe(false);
    // No range, nothing to be left out of.
    expect(schoolPassesFilters(unscored, filters({ includeUnscored: false }))).toBe(true);
  });

  it('never lets the score range hide a special school - its own switch decides', () => {
    const special = school({ category: 'special', gradeAverage: null });
    expect(schoolPassesFilters(special, filters({ scoreMin: 9, includeUnscored: false, showSpecial: true }))).toBe(
      true,
    );
  });

  it('places a school cached without a category by whether it is special', () => {
    expect(categoryOf({ isSpecialSchool: true })).toBe('special');
    expect(categoryOf({ isSpecialSchool: false })).toBe('other');
    expect(categoryOf({ category: 'friskole' })).toBe('friskole');
  });
});

describe('filterSchools', () => {
  it('returns what passes, and an empty list for nothing', () => {
    const list = [school({ id: 'a', gradeAverage: 9 }), school({ id: 'b', gradeAverage: 5 })];
    expect(filterSchools(list, filters({ scoreMin: 8 })).map((s) => s.id)).toEqual(['a']);
    expect(filterSchools(null, filters())).toEqual([]);
  });
});

describe('scoreDomain', () => {
  it('spans the schools loaded, rounded outward to whole marks', () => {
    expect(
      scoreDomain([school({ gradeAverage: 2.9 }), school({ gradeAverage: 10.6 }), school({ gradeAverage: null })]),
    ).toEqual({
      min: 2,
      max: 11,
    });
  });

  it('falls back to the usable span of the scale when there is nothing to read', () => {
    expect(scoreDomain([])).toEqual({ min: 0, max: 12 });
    expect(scoreDomain([school({ gradeAverage: null })])).toEqual({ min: 0, max: 12 });
  });

  it('never returns a range with no width', () => {
    const { min, max } = scoreDomain([school({ gradeAverage: 7 })]);
    expect(max).toBeGreaterThan(min);
  });
});

describe('hasActiveFilters', () => {
  it('is false for the defaults and true for any departure from them', () => {
    expect(hasActiveFilters(filters())).toBe(false);
    expect(hasActiveFilters(filters({ showSpecial: false }))).toBe(true);
    expect(hasActiveFilters(filters({ categories: { other: false } }))).toBe(true);
    expect(hasActiveFilters(filters({ scoreMin: 5 }))).toBe(true);
    expect(hasActiveFilters(filters({ scoreMax: 9 }))).toBe(true);
    expect(hasActiveFilters(filters({ includeUnscored: false }))).toBe(true);
  });
});

describe('sanitizeSchoolFilters', () => {
  it('turns nothing, junk and the wrong types into the defaults', () => {
    for (const raw of [null, undefined, 'x', 42, [], { showSpecial: 'yes', scoreMin: 'high', categories: 3 }]) {
      expect(sanitizeSchoolFilters(raw)).toEqual(sanitizeSchoolFilters(DEFAULT_SCHOOL_FILTERS));
    }
  });

  it('keeps what is valid and ignores kinds it does not know', () => {
    const result = sanitizeSchoolFilters({
      showSpecial: false,
      categories: { friskole: false, mystery: false },
      scoreMin: 6.5,
    });
    expect(result.showSpecial).toBe(false);
    expect(result.categories.friskole).toBe(false);
    expect(result.categories.folkeskole).toBe(true);
    expect(result.categories).not.toHaveProperty('mystery');
    expect(result.scoreMin).toBe(6.5);
  });

  it('swaps an inverted range rather than matching nothing, and drops non-finite numbers', () => {
    expect(sanitizeSchoolFilters({ scoreMin: 9, scoreMax: 6 })).toMatchObject({ scoreMin: 6, scoreMax: 9 });
    expect(sanitizeSchoolFilters({ scoreMin: NaN, scoreMax: Infinity })).toMatchObject({
      scoreMin: null,
      scoreMax: null,
    });
  });
});

describe('the kinds of school', () => {
  it('give each kind its own colour, so the legend and the map can tell them apart', () => {
    const colors = SCHOOL_CATEGORIES.map((category) => category.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('offer a checkbox for every kind except special, which is the switch above them', () => {
    expect(SELECTABLE_CATEGORIES).toEqual(['folkeskole', 'friskole', 'efterskole', 'other']);
    expect(categoryColor('special')).toBe('#7c3aed');
    expect(categoryColor('unheard-of')).toBe(categoryColor('other'));
  });
});

describe('remembering the filters', () => {
  beforeEach(() => {
    const store = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => store.set(key, String(value)),
      },
    };
  });

  it('round-trips through storage', () => {
    const chosen = sanitizeSchoolFilters({ showSpecial: false, scoreMin: 8, categories: { other: false } });
    saveSchoolFilters(chosen);
    expect(loadSchoolFilters()).toEqual(chosen);
  });

  it('starts from the defaults when nothing is stored, or what is stored is not JSON', () => {
    expect(loadSchoolFilters()).toEqual(sanitizeSchoolFilters(DEFAULT_SCHOOL_FILTERS));
    window.localStorage.setItem('fredy.map.schoolFilters', '{not json');
    expect(loadSchoolFilters()).toEqual(sanitizeSchoolFilters(DEFAULT_SCHOOL_FILTERS));
  });

  it('carries on when storage is blocked', () => {
    globalThis.window = {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      },
    };
    expect(() => saveSchoolFilters(sanitizeSchoolFilters(null))).not.toThrow();
    expect(loadSchoolFilters()).toEqual(sanitizeSchoolFilters(DEFAULT_SCHOOL_FILTERS));
  });
});
