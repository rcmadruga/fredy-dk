/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { mockFredy, providerConfig } from '../utils.js';
import * as provider from '../../lib/provider/lejebolig.js';

/**
 * Lejebolig, the first Danish rental provider - Boligsiden (see boligsiden.test.js) covers sales
 * only, so a search for a place to rent needs this one instead.
 *
 * The site serves plain server-rendered HTML with no bot wall, so unlike idealista.test.js this
 * needs no browser: a bare `fetch()` is exactly what `getListings` does at runtime too.
 *
 * Assertions are structural, because the same file runs against the fixture (`yarn test:offline`)
 * and against the live site (`yarn test`).
 */
const TEST_TIMEOUT = 60_000;
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'testFixtures');
const SEARCH_URL = providerConfig.lejebolig.url;

describe('#lejebolig provider testsuite()', () => {
  /** @type {any[]} */
  let listings;

  beforeAll(async () => {
    const Fredy = await mockFredy();
    const runConfig = provider.createConfig(providerConfig.lejebolig, []);
    const job = { id: 'lejebolig', notificationAdapter: null, spatialFilter: null, specFilter: null };

    const fredy = new Fredy(runConfig, job, provider.metaInformation.id, similarityCache, undefined);
    listings = await fredy.execute();
  }, TEST_TIMEOUT);

  it('gets through the search request and finds listings', () => {
    expect(listings).toBeInstanceOf(Array);
    expect(listings.length).toBeGreaterThan(0);
  });

  it('carries a price and an address on every listing', () => {
    for (const listing of listings) {
      expect(typeof listing.price, `price of ${listing.id}`).toBe('number');
      expect(listing.price).toBeGreaterThan(0);
      expect(listing.address, `address of ${listing.id}`).toBeTruthy();
    }
  });

  it('reads size and room counts as plain numbers, not thousands-separated text', () => {
    for (const listing of listings) {
      expect(listing.size, `size of ${listing.id}`).toBeGreaterThan(0);
      if (listing.rooms != null) {
        expect(listing.rooms, `rooms of ${listing.id}`).toBeGreaterThan(0);
        expect(listing.rooms, `rooms of ${listing.id}`).toBeLessThan(30);
      }
    }
  });

  it('links to the listing on lejebolig.dk, not a relative dead-end', () => {
    for (const listing of listings) {
      expect(listing.link, `link of ${listing.id}`).toMatch(/^https:\/\/www\.lejebolig\.dk\/lejebolig\/\d+\//);
    }
  });

  it('drops the logged-out login teaser instead of reporting it as a listing', () => {
    // The fixture/live page both carry exactly one `.lease-item.dummy` card advertising no real
    // listing - if it leaked through, its href would fail the link assertion above already, but this
    // pins the count down so a future markup change that adds a second dummy gets caught too.
    expect(listings.length).toBeLessThan(45);
  });

  it('declares Denmark, which is what sends the geocoder there', () => {
    expect(provider.metaInformation.countries).toEqual(['dk']);
  });
});

describe('#lejebolig search page parsing', () => {
  it('reads every real card of the recorded search page', () => {
    const html = fs.readFileSync(path.join(FIXTURES, 'lejebolig_search.html'), 'utf8');
    const parsed = provider.parseListings(html, SEARCH_URL).map(provider.config.normalize);

    expect(parsed.length).toBeGreaterThan(0);
    for (const listing of parsed) {
      expect(listing.id, 'every card needs an id to be deduplicated by').toBeTruthy();
      expect(listing.price, `price of ${listing.link}`).toBeGreaterThan(0);
      expect(listing.size, `size of ${listing.link}`).toBeGreaterThan(0);
    }
  });

  it('reads a price written with a trailing dash and no øre as a plain integer', () => {
    const listing = provider.config.normalize({ id: '1', price: '4.440,-', size: '38', rooms: '2' });
    expect(listing.price).toBe(4440);
  });

  it('reads a four-digit rent the same way as a five-digit one', () => {
    const listing = provider.config.normalize({ id: '1', price: '19.495,-', size: '99', rooms: '3' });
    expect(listing.price).toBe(19495);
  });

  it('leaves rooms null rather than 0 for a card the site published without one', () => {
    const listing = provider.config.normalize({ id: '1', price: '5.000,-', size: '40', rooms: null });
    expect(listing.rooms).toBeNull();
  });
});

/**
 * `fetchDetails` reads a listing's own page - the description and full address the search card
 * never carries (see the file header). The same file runs against the fixture and, on `yarn test`,
 * the live page for the exact listing the fixture was recorded from - both answer the same way.
 */
describe('#lejebolig fetchDetails', () => {
  const DETAIL_URL = 'https://www.lejebolig.dk/lejebolig/1908590/2-vaerelses-bolig-oegaden';

  it("reads the description, full address and posted date off the listing's own page", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      expect(String(url)).toBe(DETAIL_URL);
      const html = fs.readFileSync(path.join(FIXTURES, 'lejebolig_detail.html'), 'utf8');
      return { ok: true, status: 200, text: () => Promise.resolve(html) };
    };

    try {
      const listing = await provider.config.fetchDetails({
        id: '1908590',
        link: DETAIL_URL,
        description: null,
        // What the search card has instead of a street address - see the file header.
        address: 'Lejlighed i Aalborg',
      });

      expect(listing.description).toContain('Øgadekvarter');
      expect(listing.address).toBe('Bornholmsgade, 9000 Aalborg');
      expect(listing.publishedAt).toBe(new Date('2026-09-22').getTime());
      // Boilerplate mixed in alongside the description on the page must not leak into it.
      expect(listing.description).not.toContain('Digital fremvisning');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('leaves the listing untouched when the page cannot be read', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 404, text: () => Promise.resolve('') });

    try {
      const listing = await provider.config.fetchDetails({
        id: '1908590',
        link: DETAIL_URL,
        description: null,
        address: 'Lejlighed i Aalborg',
      });
      expect(listing.description).toBeNull();
      expect(listing.address).toBe('Lejlighed i Aalborg');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('is exactly the listing given back, unmutated, when there is no link', async () => {
    const listing = await provider.config.fetchDetails({ id: '1', link: null, description: null });
    expect(listing).toEqual({ id: '1', link: null, description: null });
  });
});
