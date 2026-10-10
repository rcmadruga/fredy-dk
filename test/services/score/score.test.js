/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import {
  GROUP_IDS,
  MISSING_SCORE,
  compactScore,
  groupsFor,
  scoreListing,
  targetScore,
} from '../../../lib/services/score/score.js';

/**
 * A descriptor whose raw value is read straight off the listing, so each test states its inputs.
 *
 * @param {string} group
 * @param {string} id
 * @param {Object} [overrides]
 * @returns {import('../../../lib/services/score/metrics/types.js').MetricDescriptor}
 */
function metric(group, id, overrides = {}) {
  return {
    id,
    group,
    labelKey: `score.metric.${group}.${id}`,
    unit: 'min',
    direction: 'lower',
    raw: (listing) => listing.values?.[`${group}.${id}`] ?? null,
    defaults: () => ({ ideal: 20, worst: 60 }),
    ...overrides,
  };
}

const rent = (values = {}) => ({ dealType: 'rent', values });
const buy = (values = {}) => ({ dealType: 'buy', values });

describe('targetScore', () => {
  it('is 100 at the ideal and 0 at the worst', () => {
    expect(targetScore(20, 20, 60)).toBe(100);
    expect(targetScore(60, 20, 60)).toBe(0);
  });

  it('is linear in between', () => {
    expect(targetScore(40, 20, 60)).toBe(50);
    expect(targetScore(30, 20, 60)).toBe(75);
  });

  it('clamps past either end', () => {
    expect(targetScore(5, 20, 60)).toBe(100);
    expect(targetScore(500, 20, 60)).toBe(0);
  });

  it('reads higher-is-better when the ideal is above the worst', () => {
    expect(targetScore(7, 7, 4)).toBe(100);
    expect(targetScore(4, 7, 4)).toBe(0);
    expect(targetScore(5.5, 7, 4)).toBe(50);
    expect(targetScore(10, 7, 4)).toBe(100);
    expect(targetScore(1, 7, 4)).toBe(0);
  });

  it('scores a boolean with ideal 1 and worst 0', () => {
    expect(targetScore(1, 1, 0)).toBe(100);
    expect(targetScore(0, 1, 0)).toBe(0);
  });

  it('handles negative targets', () => {
    expect(targetScore(0, 15, -5)).toBe(25);
  });

  it('has no answer for a non-number or coinciding targets', () => {
    expect(targetScore(NaN, 1, 2)).toBeNull();
    expect(targetScore(Infinity, 1, 2)).toBeNull();
    expect(targetScore('3', 1, 5)).toBeNull();
    expect(targetScore(3, 5, 5)).toBeNull();
    expect(targetScore(null, 1, 5)).toBeNull();
  });
});

describe('groupsFor', () => {
  it('gives a purchase six groups in the fixed order', () => {
    expect(groupsFor('buy')).toEqual(['money', 'schools', 'work', 'home', 'area', 'deal']);
    expect(GROUP_IDS).toEqual(['money', 'schools', 'work', 'home', 'area', 'deal']);
  });

  it('gives a rental the same five without deal', () => {
    expect(groupsFor('rent')).toEqual(['money', 'schools', 'work', 'home', 'area']);
  });

  it('treats an unknown deal type as a rental', () => {
    expect(groupsFor(undefined)).toHaveLength(5);
    expect(groupsFor(null)).toHaveLength(5);
  });
});

describe('scoreListing: metrics', () => {
  const registry = [metric('money', 'a'), metric('money', 'b')];

  it('scores each metric against the default targets', () => {
    const result = scoreListing(rent({ 'money.a': 20, 'money.b': 40 }), null, {}, registry);
    const money = result.groups.find((g) => g.id === 'money');
    expect(money.metrics.map((m) => m.score)).toEqual([100, 50]);
    expect(money.metrics[0]).toMatchObject({ key: 'money.a', raw: 20, ideal: 20, worst: 60, missing: false });
  });

  it('takes the group score as the mean of its metrics', () => {
    const result = scoreListing(rent({ 'money.a': 20, 'money.b': 40 }), null, {}, registry);
    expect(result.groups[0].score).toBe(75);
  });

  it('weighs metrics by the config', () => {
    const config = { metrics: { 'money.a': 3, 'money.b': 1 } };
    const result = scoreListing(rent({ 'money.a': 20, 'money.b': 40 }), config, {}, registry);
    expect(result.groups[0].score).toBe(87.5);
  });

  it('scores a missing metric 50 and flags it', () => {
    const result = scoreListing(rent({ 'money.a': 20 }), null, {}, registry);
    const [a, b] = result.groups[0].metrics;
    expect(a.missing).toBe(false);
    expect(b).toMatchObject({ raw: null, score: MISSING_SCORE, missing: true });
    expect(result.groups[0].score).toBe(75);
    expect(result.groups[0].missing).toBe(false);
  });

  it('marks a group with every metric missing as missing and scores it 50', () => {
    const result = scoreListing(rent(), null, {}, registry);
    expect(result.groups[0]).toMatchObject({ score: 50, missing: true, off: false });
  });

  it('counts a missing metric as missing when its targets are unknown', () => {
    const noDefaults = [metric('money', 'a', { defaults: () => null })];
    const result = scoreListing(rent({ 'money.a': 20 }), null, {}, noDefaults);
    expect(result.groups[0].metrics[0]).toMatchObject({ missing: true, score: 50, ideal: null, worst: null });
  });

  it('lets the job override either target and falls back per field', () => {
    const config = { targets: { 'money.a': { ideal: 30 } } };
    const result = scoreListing(rent({ 'money.a': 30 }), config, {}, [metric('money', 'a')]);
    const scored = result.groups[0].metrics[0];
    expect(scored).toMatchObject({ ideal: 30, worst: 60, score: 100, customTarget: true });
  });

  it('flags missing when the job sets coinciding targets', () => {
    const config = { targets: { 'money.a': { ideal: 30, worst: 30 } } };
    const result = scoreListing(rent({ 'money.a': 30 }), config, {}, [metric('money', 'a')]);
    expect(result.groups[0].metrics[0].missing).toBe(true);
  });

  it('ignores a non-finite raw value', () => {
    const odd = [metric('money', 'a', { raw: () => NaN })];
    const result = scoreListing(rent(), null, {}, odd);
    expect(result.groups[0].metrics[0]).toMatchObject({ raw: null, missing: true });
  });

  it('survives a metric that throws', () => {
    const broken = [
      metric('money', 'a', {
        raw: () => {
          throw new Error('boom');
        },
      }),
      metric('money', 'b'),
    ];
    const result = scoreListing(rent({ 'money.b': 20 }), null, {}, broken);
    expect(result.groups[0].metrics[0].missing).toBe(true);
    expect(result.groups[0].metrics[1].score).toBe(100);
  });

  it('survives defaults that throw', () => {
    const broken = [
      metric('money', 'a', {
        defaults: () => {
          throw new Error('boom');
        },
      }),
    ];
    const result = scoreListing(rent({ 'money.a': 20 }), null, {}, broken);
    expect(result.groups[0].metrics[0].missing).toBe(true);
  });

  it('uses the descriptor default weight when the job sets none', () => {
    const lowKey = [metric('money', 'a', { defaultWeight: 0.5 }), metric('money', 'b')];
    const result = scoreListing(rent({ 'money.a': 60, 'money.b': 20 }), null, {}, lowKey);
    // (0 x 0.5 + 100 x 1) / 1.5
    expect(result.groups[0].score).toBe(66.7);
    expect(result.groups[0].metrics[0].weight).toBe(0.5);
  });

  it('lets the job override the descriptor default weight', () => {
    const lowKey = [metric('money', 'a', { defaultWeight: 0.5 }), metric('money', 'b')];
    const config = { metrics: { 'money.a': 1 } };
    const result = scoreListing(rent({ 'money.a': 60, 'money.b': 20 }), config, {}, lowKey);
    expect(result.groups[0].score).toBe(50);
  });

  it('switches a metric off with weight 0 and leaves it out of the mean', () => {
    const config = { metrics: { 'money.a': 0 } };
    const result = scoreListing(rent({ 'money.a': 60, 'money.b': 20 }), config, {}, registry);
    const [a, b] = result.groups[0].metrics;
    expect(a).toMatchObject({ off: true, score: null, weight: 0, missing: false });
    expect(b.score).toBe(100);
    expect(result.groups[0].score).toBe(100);
  });

  it('ignores unusable weights', () => {
    const config = { metrics: { 'money.a': -1, 'money.b': 'x' }, groups: { money: NaN } };
    const result = scoreListing(rent({ 'money.a': 20, 'money.b': 60 }), config, {}, registry);
    expect(result.groups[0].metrics.map((m) => m.weight)).toEqual([1, 1]);
    expect(result.groups[0].weight).toBe(1);
  });

  it('passes the context to raw and defaults', () => {
    const contextual = [
      metric('money', 'a', {
        raw: (_listing, ctx) => ctx.price,
        defaults: (ctx) => ({ ideal: ctx.lo, worst: ctx.hi }),
      }),
    ];
    const result = scoreListing(rent(), null, { price: 150, lo: 100, hi: 200 }, contextual);
    expect(result.groups[0].metrics[0].score).toBe(50);
  });
});

describe('scoreListing: groups and total', () => {
  const registry = GROUP_IDS.map((group) => metric(group, 'x', { buyOnly: group === 'deal' }));

  it('is a hexagon for a purchase and a pentagon for a rental', () => {
    expect(scoreListing(buy(), null, {}, registry).groups.map((g) => g.id)).toEqual([...GROUP_IDS]);
    expect(scoreListing(rent(), null, {}, registry).groups.map((g) => g.id)).toEqual([
      'money',
      'schools',
      'work',
      'home',
      'area',
    ]);
  });

  it('reports the deal type it scored as', () => {
    expect(scoreListing(buy(), null, {}, registry).dealType).toBe('buy');
    expect(scoreListing(rent(), null, {}, registry).dealType).toBe('rent');
    expect(scoreListing({}, null, {}, registry).dealType).toBe('rent');
  });

  it('averages the groups into the total', () => {
    const values = { 'money.x': 20, 'schools.x': 60, 'work.x': 40, 'home.x': 20, 'area.x': 20 };
    const result = scoreListing(rent(values), null, {}, registry);
    expect(result.groups.map((g) => g.score)).toEqual([100, 0, 50, 100, 100]);
    expect(result.total).toBe(70);
  });

  it('weighs the groups by the config', () => {
    const values = { 'money.x': 20, 'schools.x': 60 };
    const config = { groups: { money: 3, schools: 1, work: 0, home: 0, area: 0 } };
    const result = scoreListing(rent(values), config, {}, registry);
    expect(result.total).toBe(75);
  });

  it('keeps a group weighted 0 as an off spoke', () => {
    const config = { groups: { schools: 0 } };
    const result = scoreListing(rent({ 'money.x': 20 }), config, {}, registry);
    expect(result.groups).toHaveLength(5);
    expect(result.groups[1]).toMatchObject({ id: 'schools', off: true, score: null, weight: 0 });
    // The off group takes no part: four 50s and a 100 over four... money 100, work/home/area 50.
    expect(result.total).toBe(62.5);
  });

  it('keeps the shape when every group is off, with no total', () => {
    const config = { groups: { money: 0, schools: 0, work: 0, home: 0, area: 0, deal: 0 } };
    const result = scoreListing(buy(), config, {}, registry);
    expect(result.groups).toHaveLength(6);
    expect(result.groups.every((g) => g.off)).toBe(true);
    expect(result.total).toBeNull();
  });

  it('turns a group off when every metric in it is weighted 0', () => {
    const config = { metrics: { 'money.x': 0 } };
    const result = scoreListing(rent(), config, {}, registry);
    expect(result.groups[0]).toMatchObject({ id: 'money', off: true, score: null });
  });

  it('treats a group with no registered metrics as off', () => {
    const result = scoreListing(rent(), null, {}, [metric('money', 'a')]);
    expect(result.groups).toHaveLength(5);
    expect(result.groups.filter((g) => !g.off).map((g) => g.id)).toEqual(['money']);
  });

  it('counts a fully missing group as 50 in the total', () => {
    const result = scoreListing(rent({ 'money.x': 20 }), null, {}, registry);
    // money 100, the other four groups missing at 50.
    expect(result.groups[1]).toMatchObject({ missing: true, score: 50 });
    expect(result.total).toBe(60);
  });

  it('ignores the deal weight for a rental', () => {
    const config = { groups: { deal: 5 } };
    const withDeal = scoreListing(rent({ 'money.x': 20 }), config, {}, registry);
    const without = scoreListing(rent({ 'money.x': 20 }), null, {}, registry);
    expect(withDeal.total).toBe(without.total);
  });
});

describe('scoreListing: rent versus buy', () => {
  const registry = [
    metric('home', 'size'),
    metric('home', 'upkeep', { buyOnly: true }),
    metric('deal', 'priceDrop', { buyOnly: true }),
  ];

  it('skips buy-only metrics for a rental entirely, not as missing', () => {
    const result = scoreListing(rent({ 'home.size': 20 }), null, {}, registry);
    const home = result.groups.find((g) => g.id === 'home');
    expect(home.metrics.map((m) => m.id)).toEqual(['size']);
    expect(home.missing).toBe(false);
    expect(home.score).toBe(100);
  });

  it('re-weights a rental over what applies', () => {
    // The same raw values: buy has a missing upkeep dragging the mean towards 50.
    const values = { 'home.size': 20 };
    expect(scoreListing(rent(values), null, {}, registry).groups.find((g) => g.id === 'home').score).toBe(100);
    expect(scoreListing(buy(values), null, {}, registry).groups.find((g) => g.id === 'home').score).toBe(75);
  });

  it('scores buy-only metrics for a purchase', () => {
    const result = scoreListing(buy({ 'home.upkeep': 20, 'deal.priceDrop': 60 }), null, {}, registry);
    expect(result.groups.find((g) => g.id === 'deal').score).toBe(0);
    expect(result.groups.find((g) => g.id === 'home').metrics.map((m) => m.id)).toEqual(['size', 'upkeep']);
  });

  it('carries the qualifier through', () => {
    const tagged = [metric('home', 'size', { qualifier: 'estimate' })];
    const result = scoreListing(rent({ 'home.size': 20 }), null, {}, tagged);
    expect(result.groups.find((g) => g.id === 'home').metrics[0].qualifier).toBe('estimate');
  });
});

describe('compactScore', () => {
  it('keeps the total and the group scores, and drops the metrics', () => {
    const registry = [metric('money', 'a'), metric('schools', 'a')];
    const full = scoreListing(rent({ 'money.a': 20 }), { groups: { schools: 0 } }, {}, registry);
    const compact = compactScore(full);

    expect(compact.total).toBe(full.total);
    expect(compact.dealType).toBe('rent');
    expect(compact.groups[0]).toEqual({ id: 'money', score: 100, weight: 1, off: false, missing: false });
    expect(compact.groups[1]).toEqual({ id: 'schools', score: null, weight: 0, off: true, missing: false });
    expect(compact.groups.every((g) => g.metrics === undefined)).toBe(true);
  });
});
