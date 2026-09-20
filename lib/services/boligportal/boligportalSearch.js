/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import logger from '../logger.js';
import { trackPoi } from '../tracking/Tracker.js';
import { TRACKING_POIS } from '../../TRACKING_POIS.js';

/** How long the navigation to the search page may take. */
const NAVIGATION_TIMEOUT = 60_000;

/**
 * How long Cloudflare's challenge may run before the page is given up on.
 *
 * Measured: with this browser the challenge clears in about ten seconds. The margin is generous on
 * purpose - the cost of waiting too long is one slow provider in a job run, the cost of waiting too
 * short is a run that reports no listings at all.
 */
const CHALLENGE_TIMEOUT = 45_000;

/**
 * The element that says the real page has arrived.
 *
 * The page's own data lives in this script (`{component, props}`, the hydration state of its
 * server-rendered app), so waiting for it is waiting for exactly what the provider reads. It is just
 * as present on a search that matched nothing, which is what makes it the right marker: waiting for
 * a listing card instead would turn "no results today" into a timeout. Cloudflare's interstitial is
 * a bare page holding a challenge script, so it can never satisfy this.
 */
export const STORE_SELECTOR = 'script#store';

/**
 * Fetch one BoligPortal search page, waiting out Cloudflare if it steps in front of it.
 *
 * This is not the shared extractor, on purpose. A Cloudflare challenge is served with status 403
 * even when the real page follows a few seconds later, and the extractor takes its verdict on bot
 * detection from the status of that first response - so it would throw away a page that had loaded
 * perfectly well. Here the status is only read once the wait has run out.
 *
 * @param {string} url the url of one result page
 * @param {any} browser the shared browser of the current job run
 * @returns {Promise<string|null>} the page source, or null when it never got past the challenge
 */
export async function fetchSearchHtml(url, browser) {
  const page = await browser.newPage();

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT });
    if (response?.status?.() === 429) {
      logger.warn('BoligPortal rate limited this search. The run stops here.');
      return null;
    }

    try {
      await page.waitForFunction(
        (selector) => document.querySelector(selector) != null,
        { timeout: CHALLENGE_TIMEOUT, polling: 500 },
        STORE_SELECTOR,
      );
    } catch {
      // Only now is the status worth reading. A 403 that resolved into a result page is Cloudflare
      // doing its normal thing; a 403 still standing when the wait ran out is the run being refused.
      const status = response?.status?.() ?? 0;
      logger.warn(
        `BoligPortal did not serve a result page for ${url} (status ${status}). ` +
          'If this keeps happening, the run is being challenged and may need a proxy.',
      );
      await trackPoi(`${TRACKING_POIS.DETECTED_AS_BOT}_boligportal`);
      return null;
    }

    return await page.content();
  } catch (error) {
    logger.error(`Error loading the BoligPortal search page ${url}:`, error?.message || error);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}
