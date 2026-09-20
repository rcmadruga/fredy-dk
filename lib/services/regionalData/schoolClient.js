/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { UDDANNELSESSTATISTIK_API_KEY_ENV, UDDANNELSESSTATISTIK_DATA_URL } from './constants.js';
import logger from '../logger.js';

/**
 * @typedef {Object} SchoolStat
 * @property {string} id - Institution number ("institutionsnummer"), used as the map feature id.
 * @property {string} name
 * @property {number|null} lat
 * @property {number|null} lng
 * @property {number|null} gradeAverage - "Karaktergennemsnit", grundskolens afgangsprøver (9. klasse).
 * @property {number|null} inclusionPct - "Inklusionsgrad", in percent.
 */

/**
 * Whether a caller-supplied key is configured at all. Checked separately from `fetchSchoolStats` so
 * the API route can answer "is the school layer available" without attempting - and logging - a
 * request that was never going to succeed.
 *
 * @returns {boolean}
 */
export function hasApiKey() {
  return Boolean(process.env[UDDANNELSESSTATISTIK_API_KEY_ENV]?.trim());
}

/**
 * The cube coordinates of the query sent to `/Api/v1/statistik`.
 *
 * uddannelsesstatistik.dk's API is a generic data-cube browser (område/emne/underemne/nøgletal): the
 * request shape below is confirmed against the published OpenAPI spec
 * (https://api.uddannelsesstatistik.dk/swagger/v1/swagger.json), but the exact *values* - which
 * "emne" holds grade averages, which "nøgletal" is inclusion rather than something else entirely -
 * could not be, since discovering them means calling `/Api/v1/skema` with a working key, and no key
 * was available while building this. Kept in one place and easy to find: once a real key is set (see
 * `UDDANNELSESSTATISTIK_API_KEY_ENV`), call `/Api/v1/skema` (or the "Online tool" linked from
 * https://api.uddannelsesstatistik.dk/GetStarted) to list the actual `emne`/`underemne`/`nøgletal`
 * names for grundskolen and correct these.
 *
 * @type {{område: string, emne: string, underemne: string, nøgletal: string[], detaljering: string[]}}
 */
export const SCHOOL_CUBE_QUERY = {
  område: 'GRUNDSKOLER',
  emne: 'Karakterer',
  underemne: 'Alle 9. klasseprøver',
  nøgletal: ['Karaktergennemsnit', 'Inklusionsgrad'],
  detaljering: ['Institutionsnummer', 'Institution', 'Kommunenummer'],
};

/**
 * Reads one row of whatever shape `/Api/v1/statistik` actually answers with into a {@link SchoolStat}.
 *
 * Isolated in its own function because it is the one part of this file that is a guess rather than a
 * documented contract - the field names below are STIL's own Danish terms for the concepts this
 * layer needs, but the API's actual JSON keys can only be confirmed by calling it with a real key.
 *
 * @param {Record<string, unknown>} row
 * @returns {SchoolStat|null} `null` when the row carries no institution number, which is nothing this
 *   layer can plot or identify.
 */
function normalizeSchoolRow(row) {
  const id = row['Institutionsnummer'] ?? row['institutionsnummer'];
  if (id == null) return null;

  const num = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    id: String(id),
    name: String(row['Institution'] ?? row['institution'] ?? id),
    // The cube is not expected to carry coordinates - STIL's data is address/postnummer based - so
    // these come back null until the caller geocodes the school's address itself. See the module
    // doc comment in `regionalDataService.js` for the follow-up this implies.
    lat: num(row['lat'] ?? row['breddegrad']),
    lng: num(row['lng'] ?? row['længdegrad']),
    gradeAverage: num(row['Karaktergennemsnit']),
    inclusionPct: num(row['Inklusionsgrad']),
  };
}

/**
 * Fetches grade averages and inclusion percentages for every Danish grundskole.
 *
 * Resolves to `null` - never throws - both when no key is configured and when the upstream call
 * fails, so a missing registration degrades the layer to "no data" rather than breaking the map or
 * the build. See `UDDANNELSESSTATISTIK_API_KEY_ENV` for what the caller needs to set to light this
 * up, and `SCHOOL_CUBE_QUERY` for what still needs confirming once they have.
 *
 * @returns {Promise<SchoolStat[]|null>}
 */
export async function fetchSchoolStats() {
  const apiKey = process.env[UDDANNELSESSTATISTIK_API_KEY_ENV]?.trim();
  if (!apiKey) {
    logger.debug(`${UDDANNELSESSTATISTIK_API_KEY_ENV} is not set - the Denmark school layer stays empty.`);
    return null;
  }

  try {
    const response = await fetch(UDDANNELSESSTATISTIK_DATA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ...SCHOOL_CUBE_QUERY, tomme_rækker: false, formattering: 'json' }),
    });

    if (!response.ok) {
      logger.error(`uddannelsesstatistik.dk request failed with status ${response.status}`);
      return null;
    }

    const payload = await response.json();
    // The endpoint's own `string` response type (see the swagger spec) is a JSON-encoded array
    // rather than a JSON body, hence the two-step parse guarded on the wire format actually seen.
    const rows = Array.isArray(payload) ? payload : JSON.parse(String(payload));

    return rows.map(normalizeSchoolRow).filter((school) => school != null);
  } catch (error) {
    logger.error('Error fetching school statistics from uddannelsesstatistik.dk', error);
    return null;
  }
}
