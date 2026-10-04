/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getKommunePolygons } from '../geo/denmarkGeo.js';
import logger from '../logger.js';

/**
 * @typedef {Object} Kommune
 * @property {string} code - Danish "kommunekode", zero-padded to 4 digits (e.g. "0101" for København).
 * @property {string} name
 * @property {Object} geometry - GeoJSON `Polygon`/`MultiPolygon`, simplified for web display.
 */

/**
 * Every Danish municipality's boundary, simplified for the browser.
 *
 * These used to be fetched from DAWA, which was shut down in October 2026. They are now read from
 * the files bundled with the app (`lib/services/geo/`, generated from DAGI by
 * `tools/geo/build-denmark-geo.mjs`), so this no longer touches the network. It stays asynchronous
 * and keeps its "`null` on failure" contract so that the caching layer above it
 * (`regionalDataService.js`, `diskCache.js`) did not have to change.
 *
 * `Christiansø` (kode 0411) is not among them: it answers to the Ministry of Defence rather than to
 * a municipal council and has no kommuneskat of its own to shade it by. The generator drops it.
 *
 * @returns {Promise<Kommune[]|null>} `null` if the bundled files cannot be read, which is a broken
 *   install - see {@link ../diskCache.js} for how a `null` is treated.
 */
export async function fetchKommuner() {
  try {
    return getKommunePolygons();
  } catch (error) {
    logger.error('Error reading the bundled kommune polygons', error);
    return null;
  }
}
