/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import {
  SCORE_GROUPS,
  SCORE_METRICS,
  groupsForDealType,
  metricsOfGroup,
} from '../../ui/src/services/score/metricCatalog.js';
import { METRICS } from '../../lib/services/score/metrics/index.js';
import { GROUP_IDS } from '../../lib/services/score/score.js';

/**
 * The form's copy of the metric descriptors must say what the server's say. The browser cannot import
 * `lib/`, so the only thing keeping the two honest is this test.
 */
describe('the form copy of the metric catalogue', () => {
  it('lists the groups in the order of the radar', () => {
    expect([...SCORE_GROUPS]).toEqual([...GROUP_IDS]);
  });

  it('lists the same metrics in the same order', () => {
    const server = METRICS.map((metric) => `${metric.group}.${metric.id}`);
    // The server lists metrics group by group in the same order; the group order is what the radar uses.
    expect(SCORE_METRICS.map((metric) => metric.key)).toEqual(server);
  });

  it.each(METRICS.map((metric) => [`${metric.group}.${metric.id}`, metric]))('agrees on %s', (key, metric) => {
    const copy = SCORE_METRICS.find((entry) => entry.key === key);
    expect(copy, key).toBeDefined();
    expect(copy.group).toBe(metric.group);
    expect(copy.id).toBe(metric.id);
    expect(copy.labelKey).toBe(metric.labelKey);
    expect(copy.unit).toBe(metric.unit);
    expect(copy.buyOnly).toBe(Boolean(metric.buyOnly));
    expect(copy.defaultWeight).toBe(metric.defaultWeight ?? 1);
    // Targets that depend on the job come back from the server as nothing without a context, and are
    // `null` here: the form shows them as automatic.
    const defaults = metric.defaults({});
    expect(copy.ideal).toBe(defaults?.ideal ?? null);
    expect(copy.worst).toBe(defaults?.worst ?? null);
  });

  it('marks exactly the job-dependent targets as automatic', () => {
    expect(SCORE_METRICS.filter((m) => m.ideal == null).map((m) => m.key)).toEqual(['money.value', 'home.size']);
  });
});

describe('groupsForDealType', () => {
  it('gives a purchase six groups and a rental five', () => {
    expect(groupsForDealType('buy')).toHaveLength(6);
    expect(groupsForDealType('rent')).toEqual(['money', 'schools', 'work', 'home', 'area']);
    expect(groupsForDealType(null)).toHaveLength(5);
  });
});

describe('metricsOfGroup', () => {
  it('leaves the buy-only metrics out for a rental', () => {
    expect(metricsOfGroup('home', 'rent').map((m) => m.id)).toEqual(['size', 'bathrooms', 'internet', 'parking']);
    expect(metricsOfGroup('home', 'buy').map((m) => m.id)).toEqual([
      'size',
      'bathrooms',
      'internet',
      'newBuild',
      'upkeep',
      'parking',
    ]);
  });

  it('has no Deal metrics for a rental', () => {
    expect(metricsOfGroup('deal', 'rent')).toEqual([]);
    expect(metricsOfGroup('deal', 'buy')).toHaveLength(5);
  });
});
