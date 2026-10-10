/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../lib/services/storage/listingsStorage.js', () => ({
  queryListings: vi.fn(() => ({ totalNumber: 0, page: 1, result: [] })),
  getListingById: vi.fn(() => null),
}));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getUserSettings: vi.fn(() => ({})),
}));
vi.mock('../../lib/services/tracking/Tracker.js', () => ({ trackPoi: vi.fn() }));
vi.mock('../../lib/services/logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/api/security.js', () => ({ isAdmin: vi.fn(() => false) }));
vi.mock('../../lib/services/providers/providerCurrency.js', () => ({
  getCurrencyForProvider: vi.fn(async (id) => (id === 'boligsiden' ? 'DKK' : 'EUR')),
}));

import { getListingById } from '../../lib/services/storage/listingsStorage.js';
import { getUserSettings } from '../../lib/services/storage/settingsStorage.js';
import financePlugin from '../../lib/api/routes/financeRouter.js';

const PROFILE = {
  personA: { label: 'A', enabled: true, age: 35, primaryIncome: 40000, secondaryIncome: 0 },
  livingCosts: 12000,
  financing: {
    purchasePrice: 0,
    equity: 300000,
    bundesland: 'NW',
    scenarios: [{ id: 'mid', annualRate: 3.8, tilgung: 2, fixedYears: 10 }],
  },
};

async function buildApp() {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.session = { currentUser: 'user-1' };
  });
  await app.register(financePlugin);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /calculate with the buying tab on Denmark', () => {
  it('answers with the Danish model', async () => {
    const app = await buildApp();
    const profile = { ...PROFILE, financing: { ...PROFILE.financing, purchasePrice: 2000000, market: 'dk' } };
    const response = await app.inject({ method: 'POST', url: '/calculate', payload: { profile } });

    expect(response.statusCode).toBe(200);
    const { result } = response.json();
    expect(result.model).toBe('dk');
    expect(result.dk.oneOff.total).toBe(41250);
  });

  it('keeps answering the German way when the tab is on Germany', async () => {
    const app = await buildApp();
    const profile = { ...PROFILE, financing: { ...PROFILE.financing, purchasePrice: 400000, market: 'de' } };
    const response = await app.inject({ method: 'POST', url: '/calculate', payload: { profile } });

    expect(response.json().result.model).toBeUndefined();
    expect(response.json().result.financing.primary.monthlyPayment).toBeGreaterThan(0);
  });

  it('rejects a Danish rate that cannot be right', async () => {
    const app = await buildApp();
    const profile = { ...PROFILE, financing: { ...PROFILE.financing, market: 'dk', dk: { bank: { rate: 900 } } } };
    const response = await app.inject({ method: 'POST', url: '/calculate', payload: { profile } });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /listing/:id for a home priced in kroner', () => {
  const listing = {
    id: 'dk1',
    price: 2000000,
    dealType: 'buy',
    provider: 'boligsiden',
    sale_terms: { ownerCostMonthly: 3900, publicValuation: 2700000 },
  };

  it('answers with the Danish model and the advert’s own figures', async () => {
    getListingById.mockReturnValue(listing);
    getUserSettings.mockReturnValue({ finance_profile: PROFILE });

    const app = await buildApp();
    const body = (await app.inject({ method: 'GET', url: '/listing/dk1' })).json();

    expect(body.result.model).toBe('dk');
    expect(body.result.dk.purchasePrice).toBe(2000000);
    expect(body.result.dk.running).toMatchObject({ ownerCostMonthly: 3900, source: 'advert' });
    // The valuation is above the price, so the deed fee is taken of it: 1,850 + 16,200.
    expect(body.result.dk.oneOff.skoede.total).toBe(18050);
  });

  it('answers nothing without a saved buying profile', async () => {
    getListingById.mockReturnValue(listing);
    getUserSettings.mockReturnValue({ finance_profile: { ...PROFILE, financing: undefined } });

    const app = await buildApp();
    const body = (await app.inject({ method: 'GET', url: '/listing/dk1' })).json();

    expect(body.result).toBeNull();
  });

  it('leaves a listing priced in euros on the German model', async () => {
    getListingById.mockReturnValue({ id: 'de1', price: 400000, dealType: 'buy', provider: 'immoscout' });
    getUserSettings.mockReturnValue({ finance_profile: PROFILE });

    const app = await buildApp();
    const body = (await app.inject({ method: 'GET', url: '/listing/de1' })).json();

    expect(body.result.model).toBeUndefined();
    expect(body.result.financing.purchasePrice).toBe(400000);
  });
});
