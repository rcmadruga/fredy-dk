/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { MAX_WEIGHT, METRIC_KEYS, readScoreConfig, validateScoreConfig } from '../../../lib/services/score/config.js';
import { METRICS } from '../../../lib/services/score/metrics/index.js';
import { GROUP_IDS } from '../../../lib/services/score/score.js';

describe('METRIC_KEYS', () => {
  it('lists every registered metric once, as group.id', () => {
    expect(METRIC_KEYS).toHaveLength(METRICS.length);
    expect(new Set(METRIC_KEYS).size).toBe(METRICS.length);
    expect(METRIC_KEYS).toContain('home.parking');
    expect(METRIC_KEYS).toContain('work.commute');
  });

  it('only names registered groups', () => {
    for (const key of METRIC_KEYS) expect(GROUP_IDS).toContain(key.split('.')[0]);
  });

  it('registers the six Phase C placeholders as well', () => {
    for (const key of ['money.trend', 'work.options', 'area.green', 'area.quiet', 'area.social', 'area.safety']) {
      expect(METRIC_KEYS).toContain(key);
    }
  });
});

describe('validateScoreConfig', () => {
  it('treats null and undefined as no config', () => {
    expect(validateScoreConfig(null)).toEqual({ config: null, errors: [] });
    expect(validateScoreConfig(undefined)).toEqual({ config: null, errors: [] });
  });

  it('treats a config that sets nothing as no config', () => {
    expect(validateScoreConfig({})).toEqual({ config: null, errors: [] });
    expect(validateScoreConfig({ groups: {}, metrics: {}, targets: {}, commute: {} })).toEqual({
      config: null,
      errors: [],
    });
    expect(validateScoreConfig({ commute: { label: '   ' } }).config).toBeNull();
  });

  it('keeps a valid config as it is', () => {
    const raw = {
      groups: { money: 2, deal: 0 },
      metrics: { 'home.parking': 0, 'work.jobs': 0.5 },
      targets: { 'work.commute': { ideal: 20, worst: 60 } },
      commute: { label: 'Work' },
    };
    expect(validateScoreConfig(raw)).toEqual({ config: raw, errors: [] });
  });

  it('refuses a config that is not an object', () => {
    for (const raw of ['x', 5, [], true]) {
      expect(validateScoreConfig(raw).errors).toEqual(['scoreConfig must be an object']);
    }
  });

  it('names an unknown group or metric rather than dropping it', () => {
    expect(validateScoreConfig({ groups: { sport: 1 } }).errors).toEqual(['scoreConfig.groups: unknown group "sport"']);
    expect(validateScoreConfig({ metrics: { 'home.pool': 1 } }).errors[0]).toContain('unknown metric "home.pool"');
    expect(validateScoreConfig({ targets: { 'home.pool': { ideal: 1, worst: 2 } } }).errors[0]).toContain(
      'unknown metric',
    );
  });

  it('refuses a weight that is negative, huge or not a number', () => {
    for (const weight of [-1, MAX_WEIGHT + 1, 'x', NaN, Infinity, null]) {
      expect(validateScoreConfig({ groups: { money: weight } }).errors).toHaveLength(1);
      expect(validateScoreConfig({ metrics: { 'home.size': weight } }).errors).toHaveLength(1);
    }
  });

  it('accepts a weight of 0 and of the maximum', () => {
    expect(validateScoreConfig({ groups: { money: 0, schools: MAX_WEIGHT } }).errors).toEqual([]);
  });

  it('reports every problem at once, and stores nothing', () => {
    const result = validateScoreConfig({ groups: { sport: 1, money: -1 }, metrics: 'x' });
    expect(result.config).toBeNull();
    expect(result.errors).toHaveLength(3);
  });

  it('refuses sections of the wrong type', () => {
    for (const section of ['groups', 'metrics', 'targets', 'commute']) {
      expect(validateScoreConfig({ [section]: 'x' }).errors).toEqual([`scoreConfig.${section} must be an object`]);
      expect(validateScoreConfig({ [section]: [] }).errors).toEqual([`scoreConfig.${section} must be an object`]);
    }
  });

  describe('targets', () => {
    it('accepts one end alone, which falls back to the default for the other', () => {
      expect(validateScoreConfig({ targets: { 'work.commute': { ideal: 15 } } }).config).toEqual({
        targets: { 'work.commute': { ideal: 15 } },
      });
    });

    it('treats an emptied input as unset', () => {
      const raw = { targets: { 'work.commute': { ideal: null, worst: '' } } };
      expect(validateScoreConfig(raw)).toEqual({ config: null, errors: [] });
      expect(validateScoreConfig({ targets: { 'work.commute': { ideal: 15, worst: null } } }).config).toEqual({
        targets: { 'work.commute': { ideal: 15 } },
      });
    });

    it('accepts targets that point either way, and negative ones', () => {
      expect(validateScoreConfig({ targets: { 'schools.area': { ideal: 0.5, worst: -0.5 } } }).errors).toEqual([]);
      expect(validateScoreConfig({ targets: { 'deal.priceDrop': { ideal: -10, worst: 0 } } }).errors).toEqual([]);
    });

    it('refuses coinciding ends', () => {
      const result = validateScoreConfig({ targets: { 'work.commute': { ideal: 30, worst: 30 } } });
      expect(result.errors).toEqual(['scoreConfig.targets.work.commute: ideal and worst must differ']);
    });

    it('refuses non-numeric ends and non-object targets', () => {
      expect(validateScoreConfig({ targets: { 'work.commute': { ideal: 'x', worst: 60 } } }).errors).toHaveLength(1);
      expect(validateScoreConfig({ targets: { 'work.commute': 20 } }).errors).toHaveLength(1);
      expect(validateScoreConfig({ targets: { 'work.commute': { ideal: NaN, worst: 60 } } }).errors).toHaveLength(1);
    });
  });

  describe('commute', () => {
    it('keeps the label', () => {
      expect(validateScoreConfig({ commute: { label: 'Office' } }).config).toEqual({ commute: { label: 'Office' } });
    });

    it('refuses a label that is not text', () => {
      expect(validateScoreConfig({ commute: { label: 5 } }).errors).toEqual(['scoreConfig.commute.label must be text']);
    });

    it('cuts a very long label', () => {
      const result = validateScoreConfig({ commute: { label: 'x'.repeat(500) } });
      expect(result.config.commute.label).toHaveLength(120);
    });
  });
});

describe('readScoreConfig', () => {
  it('returns null for anything that is not a usable object', () => {
    for (const raw of [null, undefined, 'x', 5, [], {}]) expect(readScoreConfig(raw)).toBeNull();
  });

  it('keeps what is valid and drops what is not instead of failing', () => {
    const stored = {
      groups: { money: 2, sport: 5, schools: -1 },
      metrics: { 'home.parking': 0, 'home.pool': 1, 'home.size': 'x' },
      targets: {
        'work.commute': { ideal: 20, worst: 60 },
        'home.pool': { ideal: 1, worst: 2 },
        'home.size': { ideal: 5, worst: 5 },
        'home.internet': { ideal: 'x' },
      },
      commute: { label: 'Work' },
      future: { thing: true },
    };
    expect(readScoreConfig(stored)).toEqual({
      groups: { money: 2 },
      metrics: { 'home.parking': 0 },
      targets: { 'work.commute': { ideal: 20, worst: 60 } },
      commute: { label: 'Work' },
    });
  });

  it('round-trips what validateScoreConfig produced', () => {
    const { config } = validateScoreConfig({
      groups: { area: 0 },
      targets: { 'area.park': { worst: 25 } },
    });
    expect(readScoreConfig(config)).toEqual(config);
  });
});
