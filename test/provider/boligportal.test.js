/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { mockFredy, providerConfig } from '../utils.js';
import * as provider from '../../lib/provider/boligportal.js';

// The provider waits a moment between pages, which would only slow the run against a fixture.
vi.mock('../../lib/utils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sleep: () => Promise.resolve(),
}));

/**
 * BoligPortal, Denmark's largest rental portal. Its results are read from the JSON the page hydrates
 * from (`<script id="store">`), not from the cards.
 *
 * The fixture reproduces that page's structure and field names as recorded from the live site; its
 * figures are illustrative rather than a recording (see test/testFixtures/boligportal.html's
 * origin in the provider header). It also holds what must NOT come out: a withdrawn advert, and the
 * `similar_ads` shown under the results.
 *
 * Assertions are structural where the run could equally be a live one (`yarn test`), and exact only
 * for what the fixture fixes.
 */
const TEST_TIMEOUT = 60_000;

describe('#boligportal provider testsuite()', () => {
  /** @type {any[]} */
  let listings;

  beforeAll(async () => {
    const Fredy = await mockFredy();
    const runConfig = provider.createConfig(providerConfig.boligportal, []);
    const job = { id: 'boligportal', notificationAdapter: null, spatialFilter: null, specFilter: null };

    const fredy = new Fredy(runConfig, job, provider.metaInformation.id, similarityCache, undefined);
    listings = await fredy.execute();
  }, TEST_TIMEOUT);

  it('finds listings', () => {
    expect(listings).toBeInstanceOf(Array);
    expect(listings.length).toBeGreaterThan(0);
  });

  it('gives every listing a link on the portal, a title, and an address', () => {
    for (const listing of listings) {
      expect(listing.link, `link of ${listing.id}`).toMatch(/^https:\/\/www\.boligportal\.dk\/.+-id-\d+$/);
      expect(listing.title, `title of ${listing.id}`).toBeTruthy();
      expect(listing.address, `address of ${listing.id}`).toBeTruthy();
    }
  });

  it('reads the rent, size and rooms as plain numbers', () => {
    for (const listing of listings) {
      expect(typeof listing.price, `price of ${listing.id}`).toBe('number');
      expect(listing.price).toBeGreaterThan(0);
      expect(listing.size, `size of ${listing.id}`).toBeGreaterThan(0);
      expect(listing.rooms, `rooms of ${listing.id}`).toBeGreaterThan(0);
      expect(listing.rooms).toBeLessThan(30);
    }
  });

  it('carries no duplicate listings', () => {
    const ids = listings.map((listing) => listing.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the withdrawn advert and the "similar" adverts out', () => {
    const links = listings.map((listing) => listing.link).join('\n');
    expect(links).not.toContain('5600999');
    expect(links).not.toContain('5668934');
  });
});
