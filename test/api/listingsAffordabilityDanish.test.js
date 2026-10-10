/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../lib/services/storage/listingsStorage.js', () => ({
  queryListings: vi.fn(() => ({ totalNumber: 0, page: 1, result: [] })),
  getAvailableProviders: vi.fn(() => []),
  getListingById: vi.fn(() => null),
}));
vi.mock('../../lib/services/storage/watchListStorage.js', () => ({ toggleWatch: vi.fn(), ensureWatch: vi.fn() }));
vi.mock('../../lib/services/storage/jobStorage.js', () => ({ getJob: vi.fn(() => null) }));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: vi.fn(async () => ({})),
  getUserSettings: vi.fn(() => ({})),
}));
vi.mock('../../lib/services/tracking/Tracker.js', () => ({ trackPoi: vi.fn() }));
vi.mock('../../lib/services/logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/api/security.js', () => ({ isAdmin: vi.fn(() => false) }));
vi.mock('../../lib/services/providers/providerCurrency.js', () => ({
  getCurrencyForProvider: vi.fn(async (id) => (id === 'boligsiden' ? 'DKK' : 'EUR')),
  getProviderIdsForCurrency: vi.fn(async (currency) => (currency === 'DKK' ? ['boligsiden'] : [])),
}));

import { getListingById, queryListings } from '../../lib/services/storage/listingsStorage.js';
import { getUserSettings } from '../../lib/services/storage/settingsStorage.js';
import listingsPlugin from '../../lib/api/routes/listingsRouter.js';
import financePlugin from '../../lib/api/routes/financeRouter.js';

const PROFILE = {
  personA: { label: 'A', enabled: true, age: 35, primaryIncome: 40000, secondaryIncome: 0 },
  livingCosts: 12000,
  financing: {
    equity: 300000,
    bundesland: 'NW',
    purchasePriceThreshold: 30000,
    scenarios: [{ id: 'mid', annualRate: 3.8, tilgung: 2, fixedYears: 10 }],
  },
};

/** The same price, once from a Danish portal and once from a German one; it is a German "stretch". */
const DANISH_HOME = {
  id: 'dk-1',
  provider: 'boligsiden',
  dealType: 'buy',
  price: 3000000,
  sale_terms: { ownerCostMonthly: 4000 },
};
const GERMAN_HOME = { id: 'de-1', provider: 'immoscout', dealType: 'buy', price: 3000000, sale_terms: null };

async function buildApp(plugin, prefix = '/') {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.session = { currentUser: 'user-1' };
  });
  await app.register(plugin, { prefix });
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserSettings.mockReturnValue({ finance_profile: PROFILE });
});

describe('the verdict on a listing row', () => {
  it('is the Danish one for a home priced in kroner and the German one for the rest', async () => {
    queryListings.mockReturnValue({ totalNumber: 2, page: 1, result: [DANISH_HOME, GERMAN_HOME] });
    const app = await buildApp(listingsPlugin);

    const { result } = (await app.inject({ method: 'GET', url: '/table' })).json();
    const verdictOf = (id) => result.find((row) => row.id === id).affordabilityVerdict;

    // 3,000,000 is between the German ceilings, but the Danish home's ejerudgift pushes its monthly
    // cost past the Danish 35-40 % band.
    expect(verdictOf('de-1')).toBe('stretch');
    expect(verdictOf('dk-1')).toBe('unaffordable');
  });

  it("reads the advert's ejerudgift: the same price without one is affordable", async () => {
    queryListings.mockReturnValue({
      totalNumber: 1,
      page: 1,
      result: [{ ...DANISH_HOME, sale_terms: null }],
    });
    const app = await buildApp(listingsPlugin);

    const { result } = (await app.inject({ method: 'GET', url: '/table' })).json();
    expect(result[0].affordabilityVerdict).toBe('affordable');
  });

  it('is the same on the detail endpoint', async () => {
    getListingById.mockReturnValue(DANISH_HOME);
    const app = await buildApp(listingsPlugin);

    const listing = (await app.inject({ method: 'GET', url: '/dk-1' })).json();
    expect(listing.affordabilityVerdict).toBe('unaffordable');
  });

  it('asks the filter to judge kroner listings the Danish way', async () => {
    const app = await buildApp(listingsPlugin);
    await app.inject({ method: 'GET', url: '/table?affordabilityFilter=affordable' });

    const { affordabilityBand } = queryListings.mock.calls.at(-1)[0];
    expect(affordabilityBand.dk).toMatchObject({ band: 'affordable', providers: ['boligsiden'] });
  });

  it('shows no verdict for a home priced in kroner while the profile is empty', async () => {
    getUserSettings.mockReturnValue({});
    queryListings.mockReturnValue({ totalNumber: 1, page: 1, result: [DANISH_HOME] });
    const app = await buildApp(listingsPlugin);

    const { result } = (await app.inject({ method: 'GET', url: '/table' })).json();
    expect(result[0].affordabilityVerdict ?? null).toBeNull();
  });
});

describe('POST /affordability with homes priced in kroner', () => {
  it('scores them with the Danish model, in kroner, beside the German ones', async () => {
    queryListings.mockReturnValue({ totalNumber: 2, page: 1, result: [DANISH_HOME, GERMAN_HOME] });
    const app = await buildApp(financePlugin);

    const response = await app.inject({ method: 'POST', url: '/affordability', payload: { profile: PROFILE } });
    expect(response.statusCode).toBe(200);
    const { items, summary } = response.json();

    const danish = items.find((item) => item.id === 'dk-1');
    const german = items.find((item) => item.id === 'de-1');
    expect(danish).toMatchObject({ currency: 'DKK', verdict: 'unaffordable', price: 3000000 });
    expect(german.verdict).toBe('stretch');
    expect(german.currency).toBeUndefined();
    expect(summary.buy).toMatchObject({ total: 2, stretch: 1, unaffordable: 1 });
  });

  it('skips a Danish home when the profile cannot be judged, like any other incomplete half', async () => {
    queryListings.mockReturnValue({ totalNumber: 1, page: 1, result: [DANISH_HOME] });
    const app = await buildApp(financePlugin);
    const profile = { ...PROFILE, livingCosts: null };

    const response = await app.inject({ method: 'POST', url: '/affordability', payload: { profile } });
    // Neither half is complete, so there is nothing to score at all.
    expect(response.statusCode).toBe(400);
  });
});
