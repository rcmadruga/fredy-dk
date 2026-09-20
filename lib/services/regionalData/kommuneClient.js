/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import simplify from '@turf/simplify';
import { DAWA_KOMMUNER_URL, KOMMUNE_SIMPLIFY_TOLERANCE } from './constants.js';
import logger from '../logger.js';

/**
 * @typedef {Object} Kommune
 * @property {string} code - Danish "kommunekode", zero-padded to 4 digits (e.g. "0101" for København).
 * @property {string} name
 * @property {Object} geometry - GeoJSON `Polygon`/`MultiPolygon`, simplified for web display.
 */

/**
 * Fetches every Danish municipality's boundary from DAWA and simplifies the geometry.
 *
 * The raw response is cadastral-resolution - about 120 MB for all 98 municipalities - which is fine
 * for a survey but not for a browser tab, so each polygon is simplified before it ever reaches the
 * cache. `Christiansø` (kode 0411) is dropped: DAWA carries it as a `kommune` feature for historical
 * reasons, but it answers to the Ministry of Defence rather than to a municipal council and has no
 * kommuneskat of its own to shade it by.
 *
 * @returns {Promise<Kommune[]|null>} `null` on any failure - see {@link ../diskCache.js}.
 */
export async function fetchKommuner() {
  try {
    const response = await fetch(DAWA_KOMMUNER_URL);
    if (!response.ok) {
      logger.error(`DAWA kommuner request failed with status ${response.status}`);
      return null;
    }

    /** @type {{features: Array<{properties: {kode: string, navn: string, udenforkommuneinddeling?: boolean}, geometry: Object}>}} */
    const geojson = await response.json();

    return geojson.features
      .filter((feature) => !feature.properties.udenforkommuneinddeling)
      .map((feature) => {
        const simplified = simplify(feature, { tolerance: KOMMUNE_SIMPLIFY_TOLERANCE, highQuality: false });
        return {
          code: feature.properties.kode,
          name: feature.properties.navn,
          geometry: simplified.geometry,
        };
      });
  } catch (error) {
    logger.error('Error fetching kommune polygons from DAWA', error);
    return null;
  }
}
