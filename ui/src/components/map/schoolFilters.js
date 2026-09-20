/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * What the Denmark school layer can be narrowed by, and the rules for it.
 *
 * Kept free of React and MapLibre so the rules can be tested as rules: the panel only edits a filters
 * object, and everything about which schools that leaves is decided here, once, for the map, the
 * count and the legend alike.
 */

/**
 * The kinds of school the map colours by, in the order the legend lists them. `special` leads: it is
 * the offer the layer exists to find, and it has its own switch rather than a checkbox.
 *
 * Colours are the Okabe-Ito set, chosen to stay apart for the common kinds of colour blindness, and
 * fixed rather than derived from the data so a kind keeps its colour whatever is currently filtered.
 *
 * @type {ReadonlyArray<{id: 'special'|'folkeskole'|'friskole'|'efterskole'|'other', color: string}>}
 */
export const SCHOOL_CATEGORIES = Object.freeze([
  { id: 'special', color: '#7c3aed' },
  { id: 'folkeskole', color: '#0072b2' },
  { id: 'friskole', color: '#e69f00' },
  { id: 'efterskole', color: '#009e73' },
  { id: 'other', color: '#6b7280' },
]);

/** Kinds that have a checkbox; `special` is the switch above them. */
export const SELECTABLE_CATEGORIES = SCHOOL_CATEGORIES.filter((category) => category.id !== 'special').map(
  (category) => category.id,
);

/** The colour of a kind, and the grey of anything the map does not know. */
export const categoryColor = (id) => SCHOOL_CATEGORIES.find((category) => category.id === id)?.color ?? '#6b7280';

/**
 * @typedef {Object} SchoolFilters
 * @property {boolean} showSpecial - Whether special schools and special-education offers are shown.
 * @property {Record<string, boolean>} categories - Which of the other kinds are shown.
 * @property {number|null} scoreMin - Lower end of the grade-average range; null is "no lower limit".
 * @property {number|null} scoreMax - Upper end; null is "no upper limit".
 * @property {boolean} includeUnscored - Whether an ordinary school with no grade average is shown
 *   while a range is set. Many are: only schools with a 9th grade have one.
 */

/** @type {SchoolFilters} */
export const DEFAULT_SCHOOL_FILTERS = Object.freeze({
  showSpecial: true,
  categories: Object.freeze(Object.fromEntries(SELECTABLE_CATEGORIES.map((id) => [id, true]))),
  scoreMin: null,
  scoreMax: null,
  includeUnscored: true,
});

/**
 * The kind of a school. A school cached before the server sent `category` is still placed sensibly
 * rather than dropped.
 *
 * @param {{category?: string, isSpecialSchool?: boolean}} school
 * @returns {string}
 */
export function categoryOf(school) {
  if (school?.category) return school.category;
  return school?.isSpecialSchool ? 'special' : 'other';
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Whether one school is shown under the filters.
 *
 * A special school is governed by its own switch alone and never by the score range: it has no grade
 * average by nature, and a range that hid every one of them would make the range and the special
 * switch fight over the same markers.
 *
 * @param {Object} school
 * @param {SchoolFilters} filters
 * @returns {boolean}
 */
export function schoolPassesFilters(school, filters) {
  const category = categoryOf(school);
  if (category === 'special') return filters.showSpecial;
  if (filters.categories[category] === false) return false;

  const hasRange = isNumber(filters.scoreMin) || isNumber(filters.scoreMax);
  if (!hasRange) return true;
  if (!isNumber(school.gradeAverage)) return filters.includeUnscored;
  if (isNumber(filters.scoreMin) && school.gradeAverage < filters.scoreMin) return false;
  if (isNumber(filters.scoreMax) && school.gradeAverage > filters.scoreMax) return false;
  return true;
}

/**
 * @param {Array<Object>|null|undefined} schools
 * @param {SchoolFilters} filters
 * @returns {Array<Object>}
 */
export function filterSchools(schools, filters) {
  return (schools ?? []).filter((school) => schoolPassesFilters(school, filters));
}

/**
 * The range the score slider spans, taken from the schools actually loaded so its ends mean
 * something: the lowest and highest grade average there is, rounded outward to whole marks.
 *
 * @param {Array<Object>|null|undefined} schools
 * @returns {{min: number, max: number}} The Danish scale's usable span when there is nothing to read.
 */
export function scoreDomain(schools) {
  const scores = (schools ?? []).map((school) => school.gradeAverage).filter(isNumber);
  if (scores.length === 0) return { min: 0, max: 12 };
  const min = Math.floor(Math.min(...scores));
  const max = Math.ceil(Math.max(...scores));
  return { min, max: max > min ? max : min + 1 };
}

/**
 * Whether the filters differ from showing everything - what a "reset" would change.
 *
 * @param {SchoolFilters} filters
 * @returns {boolean}
 */
export function hasActiveFilters(filters) {
  return (
    !filters.showSpecial ||
    SELECTABLE_CATEGORIES.some((id) => filters.categories[id] === false) ||
    isNumber(filters.scoreMin) ||
    isNumber(filters.scoreMax) ||
    !filters.includeUnscored
  );
}

/**
 * Reads filters back from storage without trusting them: a hand-edited or older value must never be
 * able to break the panel or hide every school for no visible reason.
 *
 * @param {unknown} raw
 * @returns {SchoolFilters}
 */
export function sanitizeSchoolFilters(raw) {
  const value = raw != null && typeof raw === 'object' ? /** @type {Record<string, any>} */ (raw) : {};
  const stored = value.categories != null && typeof value.categories === 'object' ? value.categories : {};
  const bool = (input, fallback) => (typeof input === 'boolean' ? input : fallback);

  let scoreMin = isNumber(value.scoreMin) ? value.scoreMin : null;
  let scoreMax = isNumber(value.scoreMax) ? value.scoreMax : null;
  // An inverted range would match nothing; swapping is what the person most plausibly meant.
  if (scoreMin != null && scoreMax != null && scoreMin > scoreMax) [scoreMin, scoreMax] = [scoreMax, scoreMin];

  return {
    showSpecial: bool(value.showSpecial, DEFAULT_SCHOOL_FILTERS.showSpecial),
    categories: Object.fromEntries(SELECTABLE_CATEGORIES.map((id) => [id, bool(stored[id], true)])),
    scoreMin,
    scoreMax,
    includeUnscored: bool(value.includeUnscored, DEFAULT_SCHOOL_FILTERS.includeUnscored),
  };
}

export const SCHOOL_FILTERS_STORAGE_KEY = 'fredy.map.schoolFilters';

/**
 * A per-viewer preference, so it lives in the browser rather than in the URL or on the server. Every
 * access is guarded: storage can be missing, full or blocked, and the map must work without it.
 *
 * @returns {SchoolFilters}
 */
export function loadSchoolFilters() {
  try {
    return sanitizeSchoolFilters(JSON.parse(window.localStorage.getItem(SCHOOL_FILTERS_STORAGE_KEY) ?? 'null'));
  } catch {
    return sanitizeSchoolFilters(null);
  }
}

/**
 * @param {SchoolFilters} filters
 */
export function saveSchoolFilters(filters) {
  try {
    window.localStorage.setItem(SCHOOL_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Not remembering the filters is a small loss; failing to filter would be a large one.
  }
}
