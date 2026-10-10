/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { normalizeDanish } from '../normalize.js';
import { ensureDanishBroadbandData, hasDanishBroadbandData, lookupNearest } from '../dk/danishBroadbandData.js';

/**
 * Client for Danish broadband coverage.
 *
 * Unlike the other registers this one is not asked over the network at all. Digitaliseringsstyrelsen
 * publishes the offered speeds for every access address as a file, with each address's position
 * (see `danishBroadbandData.js`), so a lookup is a local search for the address nearest to the
 * listing's coordinate. It used to go through DAWA's reverse geocoder first; DAWA was shut down in
 * October 2026, and with the positions in the file it was never needed.
 */

/**
 * Whether lookups are currently impossible because the file is not there (yet). Asking is what starts
 * the import, as a side effect: the first lookup that finds the file missing, or of an older layout,
 * kicks it off in the background. Until it has finished the sweep leaves Danish listings unstamped
 * instead of recording "no data" for them.
 *
 * @returns {boolean}
 */
export function isDanishBroadbandPaused() {
  ensureDanishBroadbandData();
  return !hasDanishBroadbandData();
}

/**
 * Looks up broadband coverage for one coordinate in Denmark.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<import('../normalize.js').Connectivity|null>} `null` when nothing is known
 * about the place: no address in the file within snapping distance, or the file is not imported.
 */
export async function fetchDanishConnectivity(lat, lng) {
  if (isDanishBroadbandPaused()) {
    return null;
  }
  return normalizeDanish(lookupNearest(lat, lng));
}
