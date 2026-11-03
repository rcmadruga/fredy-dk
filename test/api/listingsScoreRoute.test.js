/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// The route's own collaborators are mocked; the score itself (context, engine, metrics) is real, so
// this suite is about what the listing endpoints hand back, not about how a score is worked out.
vi.mock('../../lib/services/storage/listingsStorage.js', () => ({
  queryListings: vi.fn(),
  getAvailableProviders: vi.fn(() => []),
  getListingsForMap: vi.fn(() => []),
  getListingById: vi.fn(),
  getPricePerSqmByJob: vi.fn(() => new Map()),
}));
vi.mock('../../lib/services/storage/watchListStorage.js', () => ({ toggleWatch: vi.fn(), ensureWatch: vi.fn() }));
vi.mock('../../lib/services/storage/jobStorage.js', () => ({
  getJob: vi.fn(() => null),
  getJobsForScoring: vi.fn(() => new Map()),
}));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: vi.fn(async () => ({})),
  getUserSettings: vi.fn(() => ({})),
}));
vi.mock('../../lib/services/regionalData/regionalDataService.js', () => ({
  getSchoolLayer: vi.fn(async () => ({ available: false, schools: [] })),
  getGroceryLayer: vi.fn(async () => ({ stores: [] })),
  getJobsLayer: vi.fn(async () => ({ failed: true, fetchedAt: null, choropleth: { features: [] } })),
}));
vi.mock('../../lib/services/tracking/Tracker.js', () => ({ trackPoi: vi.fn() }));
vi.mock('../../lib/services/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/api/security.js', () => ({ isAdmin: vi.fn(() => false) }));

import { getListingById, queryListings } from '../../lib/services/storage/listingsStorage.js';
import { getJobsForScoring } from '../../lib/services/storage/jobStorage.js';
import listingsPlugin from '../../lib/api/routes/listingsRouter.js';

const BERLIN = { latitude: 52.52, longitude: 13.405 };

const row = (id, extra = {}) => ({
  id,
  job_id: 'job-1',
  dealType: 'rent',
  price: 900,
  size: 60,
  price_per_sqm: 15,
  travelTimes: [],
  ...BERLIN,
  ...extra,
});

async function buildApp() {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.session = { currentUser: 'user-1' };
  });
  await app.register(listingsPlugin);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  getJobsForScoring.mockReturnValue(
    new Map([['job-1', { dealType: 'rent', specFilter: { maxPrice: 1000 }, commuteFilter: null, scoreConfig: null }]]),
  );
});

describe('GET /table', () => {
  it('puts a compact score on every row', async () => {
    queryListings.mockReturnValue({ totalNumber: 2, page: 1, result: [row('a'), row('b', { dealType: 'buy' })] });
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/table' });
    const { result } = response.json();

    expect(response.statusCode).toBe(200);
    expect(result).toHaveLength(2);
    expect(result[0].score.groups.map((g) => g.id)).toEqual(['money', 'schools', 'work', 'home', 'area']);
    expect(result[1].score.groups.map((g) => g.id)).toEqual(['money', 'schools', 'work', 'home', 'area', 'deal']);
    expect(Object.keys(result[0].score.groups[0]).sort()).toEqual(['id', 'missing', 'off', 'score', 'weight']);
    expect(result[0].score.total).toBeTypeOf('number');
  });

  it('asks for the jobs of the whole page in one go', async () => {
    queryListings.mockReturnValue({
      totalNumber: 3,
      page: 1,
      result: [row('a'), row('b'), row('c', { job_id: 'job-2' })],
    });
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/table' });
    expect(getJobsForScoring).toHaveBeenCalledTimes(1);
    expect(getJobsForScoring).toHaveBeenCalledWith(['job-1', 'job-2']);
  });

  it('keeps the rest of the page as it was', async () => {
    queryListings.mockReturnValue({ totalNumber: 41, page: 2, result: [row('a')] });
    const app = await buildApp();
    const body = (await app.inject({ method: 'GET', url: '/table' })).json();
    expect(body.totalNumber).toBe(41);
    expect(body.page).toBe(2);
    expect(body.result[0]).toMatchObject({ id: 'a', price: 900, job_id: 'job-1' });
  });

  it('still answers, with null scores, when the score cannot be built', async () => {
    queryListings.mockReturnValue({ totalNumber: 1, page: 1, result: [row('a')] });
    getJobsForScoring.mockImplementation(() => {
      throw new Error('database is locked');
    });
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/table' });
    expect(response.statusCode).toBe(200);
    expect(response.json().result[0]).toMatchObject({ id: 'a', score: null });
  });

  it('answers an empty page', async () => {
    queryListings.mockReturnValue({ totalNumber: 0, page: 1, result: [] });
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/table' });
    expect(response.json().result).toEqual([]);
    expect(getJobsForScoring).not.toHaveBeenCalled();
  });
});

describe('GET /:listingId', () => {
  it('carries the full breakdown, every metric of every group', async () => {
    getListingById.mockReturnValue(row('a'));
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/a' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.id).toBe('a');
    expect(body.score.groups).toHaveLength(5);
    const money = body.score.groups[0];
    expect(money.metrics.map((m) => m.id)).toEqual(['value', 'affordable', 'budget']);
    expect(money.metrics[2]).toMatchObject({ key: 'money.budget', raw: 0.9, missing: false });
  });

  it('scores a purchase over six groups, with the buy-only metrics', async () => {
    getListingById.mockReturnValue(row('a', { dealType: 'buy', build_year: 2020 }));
    const app = await buildApp();
    const body = (await app.inject({ method: 'GET', url: '/a' })).json();
    expect(body.score.groups.map((g) => g.id)).toEqual(['money', 'schools', 'work', 'home', 'area', 'deal']);
    const home = body.score.groups.find((g) => g.id === 'home');
    expect(home.metrics.map((m) => m.id)).toContain('upkeep');
    expect(home.metrics.find((m) => m.id === 'upkeep').qualifier).toBe('estimate');
  });

  it('answers 404 as before for a listing that is not there', async () => {
    getListingById.mockReturnValue(null);
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
  });
});
