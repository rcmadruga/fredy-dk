/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { mockFredy, providerConfig } from '../utils.js';
import * as provider from '../../lib/provider/boligsiden.js';

/**
 * Boligsiden, the first Danish provider. Like Flatfox it reads a JSON API rather than a page - here
 * because the site itself sits behind a Cloudflare challenge a plain request never clears, while its
 * own api.boligsiden.dk answers without one.
 *
 * Assertions are structural, because the same file runs against the fixture (`yarn test:offline`)
 * and against the live API (`yarn test`).
 */
const TEST_TIMEOUT = 120_000;

describe('#boligsiden provider testsuite()', () => {
  /** @type {any[]} */
  let listings;

  beforeAll(async () => {
    const Fredy = await mockFredy();
    const runConfig = provider.createConfig(providerConfig.boligsiden, []);
    const job = { id: 'boligsiden', notificationAdapter: null, spatialFilter: null, specFilter: null };

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

  it('reads room counts as plain numbers, not German-thousands-separated text', () => {
    const withRooms = listings.filter((listing) => listing.rooms != null);
    expect(withRooms.length).toBeGreaterThan(0);

    for (const listing of withRooms) {
      expect(listing.rooms, `rooms of ${listing.id}`).toBeGreaterThan(0);
      expect(listing.rooms, `rooms of ${listing.id}`).toBeLessThan(30);
    }
  });

  it('links to the listing agent, not a dead-end', () => {
    for (const listing of listings) {
      expect(listing.link, `link of ${listing.id}`).toMatch(/^https?:\/\//);
    }
  });

  /**
   * Danish addresses are written street, house number, then postcode and city - driven through
   * `normalize` with a synthetic payload since the recorded fixture cases don't cover every shape
   * (a case missing its road name, for instance).
   */
  it('builds an address from road, house number, zip and city', () => {
    const { normalize } = provider.createConfig(providerConfig.boligsiden, []);
    const listing = normalize({
      caseID: 'abc123',
      priceCash: 2500000,
      descriptionTitle: 'Dejlig villa',
      caseUrl: 'https://www.edc.dk/sag/?sagsnr=1',
      housingArea: 120,
      numberOfRooms: 4,
      address: { roadName: 'Vestergade', houseNumber: '12', zipCode: 5000, cityName: 'Odense C' },
    });

    expect(listing.address).toBe('Vestergade 12, 5000 Odense C');
  });

  it('declares Denmark, which is what sends the geocoder there', () => {
    expect(provider.metaInformation.countries).toEqual(['dk']);
  });
});
