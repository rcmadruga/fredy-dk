/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../lib/services/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  LAYER_DEADLINE_MS,
  attachScores,
  buildScoreContexts,
  resetScoreContextMemo,
} from '../../../lib/services/score/context.js';

// Copenhagen and Berlin: the first lies in a Danish kommune, the second in none.
const CPH = { latitude: 55.676, longitude: 12.568 };
const BERLIN = { latitude: 52.52, longitude: 13.405 };
const KOMMUNE_CPH = '0101';

const listing = (id, extra = {}) => ({
  id,
  job_id: 'job-1',
  dealType: 'rent',
  price: 900,
  size: 60,
  price_per_sqm: 15,
  ...CPH,
  travelTimes: [],
  ...extra,
});

/**
 * Fake data sources that count how often each is asked.
 *
 * @param {Object} [over]
 */
function fakeDeps(over = {}) {
  const calls = { jobs: 0, prices: 0, settings: 0, schools: 0, grocery: 0, jobPosts: 0 };
  const deps = {
    getJobsForScoring: vi.fn((ids) => {
      calls.jobs += 1;
      return new Map(
        ids.map((id) => [
          id,
          {
            dealType: 'rent',
            specFilter: { maxPrice: 1200, minSize: 50 },
            commuteFilter: { action: 'notify', limits: { Work: 35 } },
            scoreConfig: null,
          },
        ]),
      );
    }),
    getPricePerSqmByJob: vi.fn((ids) => {
      calls.prices += 1;
      return new Map(ids.map((id) => [id, [10, 12, 14, 16, 18, 20, 22, 24]]));
    }),
    getUserSettings: vi.fn(() => {
      calls.settings += 1;
      return { finance_profile: { livingCosts: 1000 }, home_addresses: [{ label: 'Work', mode: 'car' }] };
    }),
    schoolLayer: vi.fn(async () => {
      calls.schools += 1;
      return {
        available: true,
        schools: [
          { id: 'a', lat: 55.677, lng: 12.569, gradeAverage: 8, pupils: 300, specialClassPct: 5 },
          { id: 'b', lat: 55.68, lng: 12.57, gradeAverage: 6, pupils: 300, specialClassPct: 0 },
        ],
      };
    }),
    groceryLayer: vi.fn(async () => {
      calls.grocery += 1;
      return { stores: [{ lat: 55.677, lng: 12.568 }] };
    }),
    jobsLayer: vi.fn(async () => {
      calls.jobPosts += 1;
      return {
        failed: false,
        fetchedAt: 1,
        choropleth: { features: [{ properties: { code: KOMMUNE_CPH, count: 14 } }] },
      };
    }),
    kommuneOf: vi.fn((lat) => (lat > 54.5 ? { code: KOMMUNE_CPH } : null)),
    deadlineMs: 50,
    ...over,
  };
  return { deps, calls };
}

beforeEach(() => {
  resetScoreContextMemo();
});

describe('buildScoreContexts: batching', () => {
  it('asks each source once for a whole page, however many listings it has', async () => {
    const { deps, calls } = fakeDeps();
    const rows = Array.from({ length: 40 }, (_, i) => listing(`l${i}`));

    const scorings = await buildScoreContexts(rows, { userId: 'u1', deps });

    expect(scorings).toHaveLength(40);
    expect(calls).toEqual({ jobs: 1, prices: 1, settings: 1, schools: 1, grocery: 1, jobPosts: 1 });
  });

  it('passes the distinct job ids, once each', async () => {
    const { deps } = fakeDeps();
    const rows = [listing('a', { job_id: 'j1' }), listing('b', { job_id: 'j2' }), listing('c', { job_id: 'j1' })];
    await buildScoreContexts(rows, { userId: 'u1', deps });
    expect(deps.getJobsForScoring).toHaveBeenCalledWith(['j1', 'j2']);
    expect(deps.getPricePerSqmByJob).toHaveBeenCalledWith(['j1', 'j2']);
  });

  it('does nothing for an empty batch', async () => {
    const { deps, calls } = fakeDeps();
    expect(await buildScoreContexts([], { userId: 'u1', deps })).toEqual([]);
    expect(await buildScoreContexts(null, { userId: 'u1', deps })).toEqual([]);
    expect(Object.values(calls).every((n) => n === 0)).toBe(true);
  });

  it('leaves the Danish layers alone for a batch with no listing in Denmark', async () => {
    const { deps, calls } = fakeDeps();
    await buildScoreContexts([listing('a', BERLIN), listing('b', { latitude: null, longitude: null })], {
      userId: 'u1',
      deps,
    });
    expect(calls.schools + calls.grocery + calls.jobPosts).toBe(0);
  });

  it('skips the supermarket layer when every Danish listing already has a routed journey', async () => {
    const { deps, calls } = fakeDeps();
    const routed = listing('a', {
      travelTimes: [{ label: 'Groceries', place: { category: 'supermarket' }, walk: { minutes: 6 } }],
    });
    await buildScoreContexts([routed], { userId: 'u1', deps });
    expect(calls.grocery).toBe(0);
    expect(calls.schools).toBe(1);
  });
});

describe('buildScoreContexts: what a listing gets', () => {
  it('builds the context of a Danish listing', async () => {
    const { deps } = fakeDeps();
    const [{ ctx, config }] = await buildScoreContexts([listing('a')], { userId: 'u1', deps, currentYear: 2026 });

    expect(config).toBeNull();
    expect(ctx).toMatchObject({
      currentYear: 2026,
      financeProfile: { livingCosts: 1000 },
      job: { maxPrice: 1200, minSize: 50 },
      commuteLabel: 'Work',
      commuteMode: 'car',
      kommuneCode: KOMMUNE_CPH,
      kommuneJobs: 14,
    });
    expect(ctx.pricePerSqm.low).toBeCloseTo(13.5, 6);
    expect(ctx.schools.schools).toHaveLength(2);
    expect(ctx.nearestSupermarketMeters).toBeGreaterThan(0);
    expect(ctx.nearestSupermarketMeters).toBeLessThan(200);
  });

  it('gives a German listing no Danish context', async () => {
    const { deps } = fakeDeps();
    const [{ ctx }] = await buildScoreContexts([listing('a', BERLIN)], { userId: 'u1', deps });
    expect(ctx).toMatchObject({ kommuneCode: null, schools: null, kommuneJobs: null, nearestSupermarketMeters: null });
    // Job-level data still applies.
    expect(ctx.job.maxPrice).toBe(1200);
    expect(ctx.pricePerSqm).not.toBeNull();
  });

  it('prefers the label in the score config and falls back to the single commute limit', async () => {
    const { deps } = fakeDeps({
      getJobsForScoring: vi.fn(
        () =>
          new Map([
            [
              'job-1',
              {
                dealType: 'buy',
                specFilter: null,
                commuteFilter: { limits: { Work: 35, School: 20 } },
                scoreConfig: { commute: { label: 'School' } },
              },
            ],
          ]),
      ),
    });
    const [{ ctx, config }] = await buildScoreContexts([listing('a')], { userId: 'u1', deps });
    expect(config).toEqual({ commute: { label: 'School' } });
    expect(ctx.commuteLabel).toBe('School');
    // Not among the saved addresses: no mode, so the stored journey's own mode decides.
    expect(ctx.commuteMode).toBeNull();
  });

  it('has no commute label when the job names none and limits two', async () => {
    const { deps } = fakeDeps({
      getJobsForScoring: vi.fn(
        () =>
          new Map([
            [
              'job-1',
              {
                dealType: 'rent',
                specFilter: null,
                commuteFilter: { limits: { Work: 35, School: 20 } },
                scoreConfig: null,
              },
            ],
          ]),
      ),
    });
    const [{ ctx }] = await buildScoreContexts([listing('a')], { userId: 'u1', deps });
    expect(ctx.commuteLabel).toBeNull();
  });

  it('fills in the deal type from the job where the row has none', async () => {
    const { deps } = fakeDeps({
      getJobsForScoring: vi.fn(
        () => new Map([['job-1', { dealType: 'buy', specFilter: null, commuteFilter: null, scoreConfig: null }]]),
      ),
    });
    const [withoutType, withType] = await buildScoreContexts(
      [listing('a', { dealType: undefined }), listing('b', { dealType: 'rent' })],
      {
        userId: 'u1',
        deps,
      },
    );
    expect(withoutType.listing.dealType).toBe('buy');
    expect(withType.listing.dealType).toBe('rent');
  });

  it('copes with a listing whose job is unknown', async () => {
    const { deps } = fakeDeps({ getJobsForScoring: vi.fn(() => new Map()) });
    const [{ ctx, config }] = await buildScoreContexts([listing('a')], { userId: 'u1', deps });
    expect(config).toBeNull();
    expect(ctx.job).toEqual({ maxPrice: null, minSize: null });
    expect(ctx.commuteLabel).toBeNull();
  });

  it('reads the config of the job, leniently', async () => {
    const { deps } = fakeDeps({
      getJobsForScoring: vi.fn(
        () =>
          new Map([
            [
              'job-1',
              {
                dealType: 'rent',
                specFilter: null,
                commuteFilter: null,
                scoreConfig: { groups: { money: 2, sport: 9 } },
              },
            ],
          ]),
      ),
    });
    const [{ config }] = await buildScoreContexts([listing('a')], { userId: 'u1', deps });
    expect(config).toEqual({ groups: { money: 2 } });
  });
});

describe('buildScoreContexts: layers that are not there', () => {
  it('treats a layer that outlasts the deadline as unavailable, without waiting for it', async () => {
    const { deps } = fakeDeps({ jobsLayer: vi.fn(() => new Promise(() => {})), deadlineMs: 20 });
    const started = Date.now();
    const [{ ctx }] = await buildScoreContexts([listing('a')], { userId: 'u1', deps });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(ctx.kommuneJobs).toBeNull();
    expect(ctx.schools).not.toBeNull();
  });

  it('treats a layer that throws as unavailable', async () => {
    const { deps } = fakeDeps({
      schoolLayer: vi.fn(async () => {
        throw new Error('down');
      }),
    });
    const [{ ctx }] = await buildScoreContexts([listing('a')], { userId: 'u1', deps });
    expect(ctx.schools).toBeNull();
    expect(ctx.kommuneJobs).toBe(14);
  });

  it('treats a school layer without a key, a failed fetch or no schools as unavailable', async () => {
    for (const layer of [
      { available: false, schools: [] },
      { available: true, failed: true, schools: [] },
      { available: true, schools: [] },
    ]) {
      const { deps } = fakeDeps({ schoolLayer: vi.fn(async () => layer) });
      const [{ ctx }] = await buildScoreContexts([listing('a')], { userId: 'u1', deps });
      expect(ctx.schools).toBeNull();
    }
  });

  it('treats a failed job-post layer as unavailable', async () => {
    const { deps } = fakeDeps({
      jobsLayer: vi.fn(async () => ({ failed: true, fetchedAt: null, choropleth: { features: [] } })),
    });
    const [{ ctx }] = await buildScoreContexts([listing('a')], { userId: 'u1', deps });
    expect(ctx.kommuneJobs).toBeNull();
  });

  it('has a kommune with no posts at all as unknown rather than zero', async () => {
    const { deps } = fakeDeps({
      jobsLayer: vi.fn(async () => ({ failed: false, fetchedAt: 2, choropleth: { features: [] } })),
    });
    const [{ ctx }] = await buildScoreContexts([listing('a')], { userId: 'u1', deps });
    expect(ctx.kommuneJobs).toBeNull();
  });

  it('exports the deadline it uses by default', () => {
    expect(LAYER_DEADLINE_MS).toBeGreaterThan(0);
    expect(LAYER_DEADLINE_MS).toBeLessThanOrEqual(5000);
  });
});

describe('buildScoreContexts: derived data is reused', () => {
  it('builds the school data once while the layer is unchanged', async () => {
    const { deps } = fakeDeps();
    const [first] = await buildScoreContexts([listing('a')], { userId: 'u1', deps });
    const [second] = await buildScoreContexts([listing('b')], { userId: 'u1', deps });
    expect(second.ctx.schools).toBe(first.ctx.schools);
  });

  it('rebuilds it when the layer changes', async () => {
    const { deps } = fakeDeps();
    const [first] = await buildScoreContexts([listing('a')], { userId: 'u1', deps });
    deps.schoolLayer = vi.fn(async () => ({
      available: true,
      schools: [{ id: 'z', lat: 55.677, lng: 12.569, gradeAverage: 9, pupils: 100, specialClassPct: 0 }],
    }));
    const [second] = await buildScoreContexts([listing('b')], { userId: 'u1', deps });
    expect(second.ctx.schools).not.toBe(first.ctx.schools);
    expect(second.ctx.schools.schools).toHaveLength(1);
  });
});

describe('attachScores', () => {
  it('puts the full breakdown on a listing by default', async () => {
    const { deps } = fakeDeps();
    const [scored] = await attachScores([listing('a')], { userId: 'u1', deps });
    expect(scored.score.groups.map((g) => g.id)).toEqual(['money', 'schools', 'work', 'home', 'area']);
    expect(scored.score.groups[0].metrics.map((m) => m.id)).toContain('value');
    expect(scored.score.total).toBeGreaterThanOrEqual(0);
    expect(scored.score.total).toBeLessThanOrEqual(100);
  });

  it('is a hexagon for a purchase', async () => {
    const { deps } = fakeDeps();
    const [scored] = await attachScores([listing('a', { dealType: 'buy' })], { userId: 'u1', deps });
    expect(scored.score.groups.map((g) => g.id)).toEqual(['money', 'schools', 'work', 'home', 'area', 'deal']);
  });

  it('keeps only the totals when asked for a compact score', async () => {
    const { deps } = fakeDeps();
    const [scored] = await attachScores([listing('a')], { userId: 'u1', deps, detail: false });
    expect(Object.keys(scored.score)).toEqual(['total', 'dealType', 'groups']);
    expect(Object.keys(scored.score.groups[0]).sort()).toEqual(['id', 'missing', 'off', 'score', 'weight']);
  });

  it('scores against the data it gathered', async () => {
    const { deps } = fakeDeps();
    const near = listing('a', {
      price_per_sqm: 10,
      travelTimes: [{ label: 'Work', mode: 'car', estimate: false, car: { minutes: 20 } }],
    });
    const [scored] = await attachScores([near], { userId: 'u1', deps });
    const money = scored.score.groups[0];
    expect(money.metrics.find((m) => m.id === 'value')).toMatchObject({ raw: 10, score: 100 });
    expect(money.metrics.find((m) => m.id === 'budget')).toMatchObject({ raw: 0.75, score: 100 });
    const work = scored.score.groups[2];
    expect(work.metrics.find((m) => m.id === 'commute')).toMatchObject({ raw: 20, score: 100 });
    expect(work.metrics.find((m) => m.id === 'jobs')).toMatchObject({ raw: 14 });
  });

  it('applies the weights of the job', async () => {
    const { deps } = fakeDeps({
      getJobsForScoring: vi.fn(
        () =>
          new Map([
            [
              'job-1',
              { dealType: 'rent', specFilter: null, commuteFilter: null, scoreConfig: { groups: { schools: 0 } } },
            ],
          ]),
      ),
    });
    const [scored] = await attachScores([listing('a')], { userId: 'u1', deps });
    expect(scored.score.groups[1]).toMatchObject({ id: 'schools', off: true, score: null });
  });

  it('returns new rows and leaves the input alone', async () => {
    const { deps } = fakeDeps();
    const row = listing('a');
    const [scored] = await attachScores([row], { userId: 'u1', deps });
    expect(scored).not.toBe(row);
    expect(row.score).toBeUndefined();
    expect(scored.id).toBe('a');
  });

  it('returns rows with a null score instead of failing when a source throws', async () => {
    const { deps } = fakeDeps({
      getJobsForScoring: vi.fn(() => {
        throw new Error('database is locked');
      }),
    });
    const scored = await attachScores([listing('a'), listing('b')], { userId: 'u1', deps });
    expect(scored.map((r) => r.score)).toEqual([null, null]);
    expect(scored.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('returns an empty batch as it is', async () => {
    expect(await attachScores([], { userId: 'u1' })).toEqual([]);
    expect(await attachScores(undefined, { userId: 'u1' })).toEqual([]);
  });
});
