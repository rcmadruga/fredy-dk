/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import {
  countScoreCustomisations,
  hasCoincidingTarget,
  setCommuteLabel,
  setGroupWeight,
  setMetricWeight,
  setTarget,
  toNumber,
} from '../../ui/src/services/jobs/scoreConfig.js';
import { validateScoreConfig } from '../../lib/services/score/config.js';

describe('toNumber', () => {
  it('reads numbers and numeric text, and treats an emptied box as nothing', () => {
    expect(toNumber(2)).toBe(2);
    expect(toNumber('2.5')).toBe(2.5);
    expect(toNumber(0)).toBe(0);
    for (const value of ['', null, undefined, 'x', NaN]) expect(toNumber(value)).toBeNull();
  });
});

describe('setGroupWeight', () => {
  it('stores a weight other than the default', () => {
    expect(setGroupWeight(null, 'money', 2)).toEqual({ groups: { money: 2 } });
    expect(setGroupWeight(null, 'schools', 0)).toEqual({ groups: { schools: 0 } });
  });

  it('does not store the default, so an untouched slider is no edit', () => {
    expect(setGroupWeight(null, 'money', 1)).toBeNull();
  });

  it('puts a group back to the default by removing it, and the config with it when it was the last', () => {
    const config = { groups: { money: 2, work: 0 } };
    expect(setGroupWeight(config, 'money', 1)).toEqual({ groups: { work: 0 } });
    expect(setGroupWeight({ groups: { money: 2 } }, 'money', 1)).toBeNull();
  });

  it('keeps the other parts of the config', () => {
    const config = { metrics: { 'home.parking': 0 } };
    expect(setGroupWeight(config, 'area', 0)).toEqual({ metrics: { 'home.parking': 0 }, groups: { area: 0 } });
  });

  it('does not touch what it was given', () => {
    const config = { groups: { money: 2 } };
    setGroupWeight(config, 'money', 3);
    expect(config).toEqual({ groups: { money: 2 } });
  });
});

describe('setMetricWeight', () => {
  it('stores a weight other than the metric default', () => {
    expect(setMetricWeight(null, 'home.size', 3)).toEqual({ metrics: { 'home.size': 3 } });
    expect(setMetricWeight(null, 'home.parking', 0)).toEqual({ metrics: { 'home.parking': 0 } });
  });

  it('does not store the default of that metric, which is not always 1', () => {
    expect(setMetricWeight(null, 'home.parking', 0.5)).toBeNull();
    expect(setMetricWeight(null, 'work.jobs', 0.5)).toBeNull();
    expect(setMetricWeight(null, 'home.parking', 1)).toEqual({ metrics: { 'home.parking': 1 } });
  });

  it('clears a weight when the box is emptied', () => {
    expect(setMetricWeight({ metrics: { 'home.size': 3 } }, 'home.size', '')).toBeNull();
  });
});

describe('setTarget', () => {
  it('sets one end at a time', () => {
    const first = setTarget(null, 'work.commute', 'ideal', 15);
    expect(first).toEqual({ targets: { 'work.commute': { ideal: 15 } } });
    expect(setTarget(first, 'work.commute', 'worst', 45)).toEqual({
      targets: { 'work.commute': { ideal: 15, worst: 45 } },
    });
  });

  it('removes a target once both ends are emptied', () => {
    const config = { targets: { 'work.commute': { ideal: 15, worst: 45 } } };
    const half = setTarget(config, 'work.commute', 'ideal', '');
    expect(half).toEqual({ targets: { 'work.commute': { worst: 45 } } });
    expect(setTarget(half, 'work.commute', 'worst', null)).toBeNull();
  });

  it('accepts negative and zero ends', () => {
    expect(setTarget(null, 'schools.area', 'worst', -0.5)).toEqual({ targets: { 'schools.area': { worst: -0.5 } } });
    expect(setTarget(null, 'work.jobs', 'worst', 0)).toEqual({ targets: { 'work.jobs': { worst: 0 } } });
  });
});

describe('setCommuteLabel', () => {
  it('sets and clears the address', () => {
    const set = setCommuteLabel(null, 'Office');
    expect(set).toEqual({ commute: { label: 'Office' } });
    expect(setCommuteLabel(set, null)).toBeNull();
    expect(setCommuteLabel(set, '   ')).toBeNull();
  });
});

describe('hasCoincidingTarget', () => {
  it('spots two equal ends only', () => {
    expect(hasCoincidingTarget({ targets: { 'a.b': { ideal: 3, worst: 3 } } }, 'a.b')).toBe(true);
    expect(hasCoincidingTarget({ targets: { 'a.b': { ideal: 3, worst: 4 } } }, 'a.b')).toBe(false);
    expect(hasCoincidingTarget({ targets: { 'a.b': { ideal: 3 } } }, 'a.b')).toBe(false);
    expect(hasCoincidingTarget(null, 'a.b')).toBe(false);
  });
});

describe('countScoreCustomisations', () => {
  it('counts what differs from the defaults', () => {
    expect(countScoreCustomisations(null)).toBe(0);
    expect(
      countScoreCustomisations({
        groups: { money: 2 },
        metrics: { 'home.size': 3, 'home.parking': 0 },
        targets: { 'work.commute': { ideal: 1 } },
        commute: { label: 'Work' },
      }),
    ).toBe(5);
  });
});

describe('what the form builds is what the server accepts', () => {
  it('survives the server validation unchanged', () => {
    let config = null;
    config = setGroupWeight(config, 'deal', 0.5);
    config = setMetricWeight(config, 'home.size', 2);
    config = setTarget(config, 'work.commute', 'ideal', 15);
    config = setTarget(config, 'work.commute', 'worst', 45);
    config = setCommuteLabel(config, 'Work');

    const { config: accepted, errors } = validateScoreConfig(config);
    expect(errors).toEqual([]);
    expect(accepted).toEqual(config);
  });
});
