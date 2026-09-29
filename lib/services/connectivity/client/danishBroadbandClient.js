/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import https from 'https';
import fetch from 'node-fetch';
import pThrottle from 'p-throttle';
import logger from '../../logger.js';
import { selfHostedUserAgent } from '../../userAgent.js';
import { normalizeDanish } from '../normalize.js';
import { ensureDanishBroadbandData, hasDanishBroadbandData, lookupAddress } from '../dk/danishBroadbandData.js';

/**
 * Client for Danish broadband coverage.
 *
 * Unlike the other registers this one is not asked over the network per listing. Digitaliseringsstyrelsen
 * publishes the offered speeds for every access address as a file (see `danishBroadbandData.js`), so
 * a lookup is two steps: DAWA turns the coordinate into the access address it belongs to, and the
 * imported file says what is offered there. Only the first step is a request, and DAWA is the
 * public address service the kommune layer already uses.
 */

/** Nearest access address to a point, `x` being longitude and `y` latitude. */
const DAWA_REVERSE_URL = 'https://api.dataforsyningen.dk/adgangsadresser/reverse';

const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 1000 });
const throttle = pThrottle({ limit: 5, interval: 1000 });

const REQUEST_TIMEOUT = 15000;

/** How long the client stands off after DAWA refused or failed to answer. */
const PAUSE_DURATION = 15 * 60 * 1000;

let pausedSince = 0;

/**
 * Whether lookups are currently impossible: DAWA is being stood off from, or the file is not there
 * yet. The second case is why this asks for the file as a side effect - the first lookup that finds
 * it missing is what starts the import, and until it has finished the sweep leaves Danish listings
 * unstamped instead of recording "no data" for them.
 *
 * @returns {boolean}
 */
export function isDanishBroadbandPaused() {
  if (Date.now() - pausedSince < PAUSE_DURATION) {
    return true;
  }
  ensureDanishBroadbandData();
  return !hasDanishBroadbandData();
}

/**
 * Clears the client's memory of failures. Only used by the tests.
 *
 * @returns {void}
 */
export function resetDanishBroadbandClient() {
  pausedSince = 0;
}

/**
 * The access address a coordinate belongs to.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<string|null|undefined>} The id; `null` when DAWA has no address there; and
 * `undefined` for every failure, which is the difference between "nothing here" and "did not say".
 */
async function get(lat, lng) {
  const query = new URLSearchParams({
    x: String(lng),
    y: String(lat),
    struktur: 'mini',
  });

  try {
    const response = await fetch(`${DAWA_REVERSE_URL}?${query}`, {
      agent,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      headers: {
        'User-Agent': selfHostedUserAgent,
        Accept: 'application/json',
      },
    });

    // Outside Denmark and out at sea there is no address to find, which DAWA says with a 404.
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      logger.error(`api.dataforsyningen.dk responded with ${response.status} ${response.statusText}`);
      pausedSince = Date.now();
      return undefined;
    }

    const payload = await response.json();
    return typeof payload?.id === 'string' ? payload.id : null;
  } catch (error) {
    logger.error('Error during api.dataforsyningen.dk request:', error);
    pausedSince = Date.now();
    return undefined;
  }
}

const throttledGet = throttle(get);

/**
 * Looks up broadband coverage for one coordinate in Denmark.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<import('../normalize.js').Connectivity|null>} `null` when nothing is known
 * about the place or the lookup failed.
 */
export async function fetchDanishConnectivity(lat, lng) {
  if (isDanishBroadbandPaused()) {
    return null;
  }

  const addressId = await throttledGet(lat, lng);
  if (addressId == null) {
    return null;
  }

  return normalizeDanish(lookupAddress(addressId));
}
