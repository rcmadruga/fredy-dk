/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { xhrGet } from '../xhr.js';

/**
 * @typedef {Object} SchoolStat
 * @property {string} id
 * @property {string} name
 * @property {number} lat
 * @property {number} lng
 * @property {number|null} gradeAverage
 * @property {number|null} inclusionPct
 */

/**
 * Fetches the Denmark tax choropleth: one GeoJSON feature per kommune, carrying `kommuneskatPct` and
 * `grundskyldPromille` in its properties.
 *
 * @returns {Promise<{type: 'FeatureCollection', features: Array<Object>, attribution: string[]}>}
 */
export async function fetchTaxChoropleth() {
  const { json } = await xhrGet('/api/regional-data/dk/tax');
  return json;
}

/**
 * Fetches Denmark's school grade/inclusion layer.
 *
 * Always resolves - never throws for "no API key configured" - because that is an expected,
 * documented state (see `UDDANNELSESSTATISTIK_API_KEY_ENV` server-side) rather than a failure the
 * map should show an error for.
 *
 * @returns {Promise<{available: boolean, schools: SchoolStat[], attribution: string[]}>}
 */
export async function fetchSchoolLayer() {
  const { json } = await xhrGet('/api/regional-data/dk/schools');
  return json;
}
