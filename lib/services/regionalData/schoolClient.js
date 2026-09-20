/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { UDDANNELSESSTATISTIK_API_KEY_ENV, UDDANNELSESSTATISTIK_DATA_URL } from './constants.js';
import { fetchInstitutionRegister } from './institutionRegisterClient.js';
import logger from '../logger.js';

/**
 * @typedef {Object} SchoolStat
 * @property {string} id - Institution number ("institutionsnummer"), used as the map feature id.
 * @property {string} name
 * @property {number} lat
 * @property {number} lng
 * @property {string|null} schoolType - The register's category, e.g. "Folkeskoler".
 * @property {'folkeskole'|'friskole'|'efterskole'|'special'|'other'} category - What the map colours and filters by.
 * @property {boolean} isSpecialSchool - A special school or special-education offer in its own right.
 * @property {number|null} inclusionPct - "Inklusionsgrad": the share of pupils taught in ordinary classes.
 * @property {number|null} specialClassPct - The share taught in separate special classes.
 * @property {number|null} pupils - Number of pupils.
 * @property {number|null} gradeAverage - Average of the 9th-grade exams; null for schools without one.
 * @property {string|null} schoolYear - The school year the inclusion figures are from, e.g. "2024/2025".
 * @property {string|null} gradeYear - The school year of the grade average, which can lag the above.
 * @property {string|null} address
 * @property {string|null} website
 */

/**
 * Whether a caller-supplied key is configured at all. Checked separately from `fetchSchoolStats` so
 * the API route can answer "is the school layer available" without attempting - and logging - a
 * request that was never going to succeed.
 *
 * @returns {boolean}
 */
export function hasApiKey() {
  return readApiKey() != null;
}

/**
 * The configured key, cleaned up. It is a JWT, which never contains whitespace or quotes, so any that
 * are there came in with the value: `docker run --env-file` keeps quotes and spaces exactly as
 * written, and a key copied from a page that wrapped it carries the line breaks along. Left in, they
 * make the API answer 401 for a key that is otherwise perfectly good - and the map could only say
 * that the data "could not be loaded".
 *
 * @returns {string|null} The key, or null when none is configured.
 */
export function readApiKey() {
  const cleaned = String(process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] ?? '')
    .replace(/\s+/g, '')
    .replace(/^["']+|["']+$/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * The cube coordinates of the two queries sent to `/Api/v1/statistik`, confirmed against the live
 * API with a real key (`POST /Api/v1/skema` walks the hierarchy: område -> emne -> underemne, and
 * lists each table's nøgletal and detaljering). Names are the bracketed MDX-style ones the API
 * answers with - the short forms are refused.
 *
 * - `GS/ELEV/ELEVEX` ("Elevtal"): per institution, `Inklusionsgrad` and how many pupils are taught in
 *   separate special classes. Covers special schools as well as ordinary ones, which is the point.
 * - `GS/OVER/OVERSKO` ("Skoleoverblik"): the grade average. Only schools with a 9th grade have one.
 *
 * Neither table carries an address or coordinates - nothing in the API does - so a school's position
 * comes from the institution register (`institutionRegisterClient.js`), joined on institution number.
 */
const SCHOOL_YEAR_DIM = '[Skoleår].[Skoleår]';

export const INCLUSION_QUERY = {
  område: 'GS',
  emne: 'ELEV',
  underemne: 'ELEVEX',
  nøgletal: [
    '[Measures].[Inklusionsgrad]',
    '[Measures].[Andel der modtager seg specialundervisning]',
    '[Measures].[Antal elever]',
  ],
  detaljering: ['[Institution].[Institutionsnummer]', '[Institution].[Institution]', SCHOOL_YEAR_DIM],
};

export const GRADE_QUERY = {
  område: 'GS',
  emne: 'OVER',
  underemne: 'OVERSKO',
  nøgletal: ['[Measures].[Karaktergennemsnit]'],
  detaljering: ['[Institution].[Afdelingsnummer]', SCHOOL_YEAR_DIM],
};

/**
 * The school years worth asking for. The ministry publishes a year in arrears, and different figures
 * land at different times of year, so the newest year is often incomplete: ask for three and let the
 * join keep the latest value each school actually has.
 *
 * @param {Date} [now]
 * @returns {string[]} e.g. `['2024/2025', '2023/2024', '2022/2023']`, newest first.
 */
export function recentSchoolYears(now = new Date()) {
  // A school year starts in August.
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return [0, 1, 2].map((back) => `${start - back}/${start - back + 1}`);
}

/**
 * Reads one of the API's figures, which it writes the Danish way: `"83,9 %"`, `"7,7"`, `""`.
 *
 * @param {unknown} value
 * @returns {number|null} `null` for the empty string and anything unparsable, which is how the API
 *   says "no figure" - never 0, which would read as a real result.
 */
export function parseDanishNumber(value) {
  if (value == null) return null;
  const text = String(value).replace('%', '').replace(/\s/g, '');
  if (text.length === 0) return null;
  // "1.234,5": dots group thousands, the comma is the decimal separator.
  const parsed = Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Reads a whole count. The API groups thousands with a dot ("1.020"), which as a plain number would
 * be one point zero two.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function parseCount(value) {
  const parsed = parseDanishNumber(String(value ?? '').replace(/\./g, ''));
  return parsed == null ? null : Math.round(parsed);
}

/**
 * A row's value for one dimension. The API keys them `[Dim].[Level].[Level]`, so the level is
 * matched by prefix rather than spelled out three times.
 *
 * @param {Record<string, unknown>} row
 * @param {string} dimension e.g. `[Institution].[Institutionsnummer]`.
 * @returns {string|null}
 */
function dimensionOf(row, dimension) {
  const key = Object.keys(row).find((candidate) => candidate.startsWith(dimension));
  const value = key == null ? null : row[key];
  return value == null || value === '' ? null : String(value);
}

/** Categories in the register that are special-needs offers rather than ordinary schools. */
const SPECIAL_TYPE = /special|særlig/i;

/**
 * The kind of school the map colours by, from the register's own category.
 *
 * Special-needs provision is checked first because it cuts across the register's categories:
 * "Efterskoler med samlet særligt tilbud" is an efterskole for special-needs pupils, and someone
 * looking for that wants it with the special schools, not among the ordinary boarding schools.
 *
 * The register has one category for "Friskoler og private grundskoler" - free schools and private
 * schools are not told apart in it - so they are one group here as well.
 *
 * @param {string|null|undefined} registerType
 * @returns {'folkeskole'|'friskole'|'efterskole'|'special'|'other'}
 */
export function schoolCategoryOf(registerType) {
  const type = String(registerType ?? '');
  if (SPECIAL_TYPE.test(type)) return 'special';
  if (/^folkeskoler/i.test(type)) return 'folkeskole';
  if (/friskoler|private grundskoler/i.test(type)) return 'friskole';
  if (/^efterskoler/i.test(type)) return 'efterskole';
  return 'other';
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} idDimension
 * @param {(row: Record<string, unknown>) => boolean} hasValue
 * @returns {Map<string, Record<string, unknown>>} The latest school year's row that carries a figure,
 *   per institution - later years win, and a year with nothing in it does not shadow an earlier one.
 */
function latestRowPerInstitution(rows, idDimension, hasValue) {
  const latest = new Map();
  for (const row of rows) {
    const id = dimensionOf(row, idDimension);
    if (id == null || !hasValue(row)) continue;
    const year = dimensionOf(row, SCHOOL_YEAR_DIM) ?? '';
    const seen = latest.get(id);
    // "2024/2025" > "2023/2024" as plain strings, which is all the ordering this needs.
    if (seen == null || year > seen.year) latest.set(id, { row, year });
  }
  return new Map([...latest].map(([id, { row }]) => [id, row]));
}

/**
 * Joins the two statistics tables to the register into the schools the map draws.
 *
 * Pure - the network is `fetchSchoolStats`'s business - so the rules of the join are testable on
 * fixtures. An institution is kept only if it has a position in the register and at least one
 * figure; the register alone (9,800 institutions, closed ones included) is not a school layer.
 *
 * @param {Object} input
 * @param {Array<Record<string, unknown>>} input.inclusionRows
 * @param {Array<Record<string, unknown>>} input.gradeRows
 * @param {Map<string, import('./institutionRegisterClient.js').RegisteredInstitution>} input.register
 * @returns {SchoolStat[]}
 */
export function joinSchoolStats({ inclusionRows, gradeRows, register }) {
  const inclusion = latestRowPerInstitution(
    inclusionRows,
    '[Institution].[Institutionsnummer]',
    (row) =>
      parseDanishNumber(row['Inklusionsgrad']) != null ||
      parseDanishNumber(row['Andel der modtager seg specialundervisning']) != null ||
      parseCount(row['Antal elever']) != null,
  );
  const grades = latestRowPerInstitution(
    gradeRows,
    '[Institution].[Afdelingsnummer]',
    (row) => parseDanishNumber(row['Karaktergennemsnit']) != null,
  );

  const schools = [];
  for (const [id, row] of inclusion) {
    const place = register.get(id);
    // A school the register has closed would be a marker on a building that is no longer one.
    if (place == null || !place.active) continue;

    const gradeRow = grades.get(id);
    schools.push({
      id,
      name: dimensionOf(row, '[Institution].[Institution]') ?? id,
      lat: place.lat,
      lng: place.lng,
      schoolType: place.type,
      category: schoolCategoryOf(place.type),
      isSpecialSchool: SPECIAL_TYPE.test(place.type ?? ''),
      inclusionPct: parseDanishNumber(row['Inklusionsgrad']),
      specialClassPct: parseDanishNumber(row['Andel der modtager seg specialundervisning']),
      pupils: parseCount(row['Antal elever']),
      gradeAverage: gradeRow == null ? null : parseDanishNumber(gradeRow['Karaktergennemsnit']),
      schoolYear: dimensionOf(row, SCHOOL_YEAR_DIM),
      gradeYear: gradeRow == null ? null : dimensionOf(gradeRow, SCHOOL_YEAR_DIM),
      address: place.address,
      website: place.website,
    });
  }
  return schools;
}

/**
 * @param {string} apiKey
 * @param {Object} query One of the cube queries above.
 * @returns {Promise<Array<Record<string, unknown>>>}
 * @throws When the request fails or the answer is not a list.
 */
async function postStatistics(apiKey, query) {
  const response = await fetch(UDDANNELSESSTATISTIK_DATA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      ...query,
      filtre: { [SCHOOL_YEAR_DIM]: recentSchoolYears() },
      tomme_rækker: false,
      formattering: 'json',
    }),
  });
  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? ` - the key was refused; check ${UDDANNELSESSTATISTIK_API_KEY_ENV} is the whole key, with no quotes or line breaks`
        : '';
    throw new Error(`uddannelsesstatistik.dk answered ${response.status}${hint}`);
  }
  const payload = await response.json();
  // The API's own `string` response type is a JSON-encoded array in some deployments and a plain
  // array in others; the live one currently answers with the plain array.
  const rows = Array.isArray(payload) ? payload : JSON.parse(String(payload));
  if (!Array.isArray(rows)) {
    throw new Error('uddannelsesstatistik.dk answered with something other than a list');
  }
  return rows;
}

/**
 * Fetches every Danish school with its inclusion figures, its grade average where it has one, and
 * its position.
 *
 * Resolves to `null` - never throws - when no key is configured, when the register or the inclusion
 * table cannot be had, or when the upstream call fails, so a missing registration or an upstream
 * outage degrades the layer to "no data" rather than breaking the map. The grade average is the one
 * optional part: without it the layer still shows everything it is for.
 *
 * @returns {Promise<SchoolStat[]|null>}
 */
export async function fetchSchoolStats() {
  const apiKey = readApiKey();
  if (!apiKey) {
    logger.debug(`${UDDANNELSESSTATISTIK_API_KEY_ENV} is not set - the Denmark school layer stays empty.`);
    return null;
  }

  try {
    const [inclusionRows, register, gradeRows] = await Promise.all([
      postStatistics(apiKey, INCLUSION_QUERY),
      fetchInstitutionRegister(),
      postStatistics(apiKey, GRADE_QUERY).catch((error) => {
        logger.warn(`Could not fetch school grade averages, showing schools without them: ${error.message}`);
        return [];
      }),
    ]);
    if (register == null) return null;

    return joinSchoolStats({ inclusionRows, gradeRows, register });
  } catch (error) {
    logger.error('Error fetching school statistics from uddannelsesstatistik.dk', error);
    return null;
  }
}
