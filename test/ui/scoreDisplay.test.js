/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  FAIR_FROM,
  GOOD_FROM,
  bandOf,
  formatMetricValue,
  formatTargetBand,
  radarSpokes,
} from '../../ui/src/services/score/scoreDisplay.js';
import { METRICS } from '../../lib/services/score/metrics/index.js';
import { GROUP_IDS } from '../../lib/services/score/score.js';

const localeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../ui/src/locales');
const english = JSON.parse(fs.readFileSync(path.join(localeDir, 'en.json'), 'utf-8'));

// A translator that prints the key and its variables, so assertions show what was asked for.
const t = (key, vars = {}) => (Object.keys(vars).length > 0 ? `${key}(${JSON.stringify(vars)})` : key);
const env = { t, locale: 'en-US', currency: 'DKK' };

describe('bandOf', () => {
  it('bands a score at 70 and 40', () => {
    expect(GOOD_FROM).toBe(70);
    expect(FAIR_FROM).toBe(40);
    expect(bandOf(100)).toBe('good');
    expect(bandOf(70)).toBe('good');
    expect(bandOf(69)).toBe('fair');
    expect(bandOf(40)).toBe('fair');
    expect(bandOf(39)).toBe('poor');
    expect(bandOf(0)).toBe('poor');
  });

  it('bands what the user sees: the rounded score', () => {
    expect(bandOf(69.6)).toBe('good');
    expect(bandOf(39.5)).toBe('fair');
    expect(bandOf(69.4)).toBe('fair');
  });

  it('has no band for no score', () => {
    for (const value of [null, undefined, NaN, '70']) expect(bandOf(value)).toBeNull();
  });
});

describe('formatMetricValue', () => {
  it.each([
    [32, 'min', '32 min'],
    [2.34, 'km', '2.3 km'],
    [450.4, 'm', '450 m'],
    [72, 'm2', '72 m²'],
    [3.45, 'pct', '3.5 %'],
    [12, 'pct', '12 %'],
    [-5, 'pct', '-5 %'],
    [1.2, 'ratio', '120 %'],
    [0.75, 'ratio', '75 %'],
    [250, 'krPerM2', '250 score.unit.krPerM2'],
    [120, 'days', '120 score.unit.days'],
    [12, 'years', '12 score.unit.years'],
    [1000, 'mbit', '1,000 Mbit/s'],
    [7.25, 'grade', '7.3'],
    [2, 'count', '2'],
    [1, 'bool', 'score.yes'],
    [0, 'bool', 'score.no'],
  ])('writes %s as a %s', (value, unit, expected) => {
    expect(formatMetricValue(value, unit, env)).toBe(expected);
  });

  it('writes a price per m2 in the currency of the listing', () => {
    expect(formatMetricValue(25000, 'eurPerM2', env)).toContain('25,000');
    expect(formatMetricValue(25000, 'eurPerM2', env)).toContain('/m²');
    expect(formatMetricValue(25000, 'eurPerM2', env)).toMatch(/DKK|kr/);
  });

  it('follows the locale', () => {
    expect(formatMetricValue(1000, 'mbit', { ...env, locale: 'de-DE' })).toBe('1.000 Mbit/s');
  });

  it('says unknown for a value that is not there', () => {
    for (const value of [null, undefined, NaN, Infinity]) {
      expect(formatMetricValue(value, 'min', env)).toBe('score.unknown');
    }
  });

  it('writes a unit it does not know as a plain number', () => {
    expect(formatMetricValue(3.14159, 'furlongs', env)).toBe('3.1');
  });
});

describe('formatTargetBand', () => {
  it('names the ideal and the worst in the unit of the metric', () => {
    expect(formatTargetBand({ ideal: 20, worst: 60, unit: 'min' }, env)).toBe(
      'score.target({"ideal":"20 min","worst":"60 min"})',
    );
  });

  it('has nothing to say without both ends', () => {
    expect(formatTargetBand({ ideal: null, worst: 60, unit: 'min' }, env)).toBeNull();
    expect(formatTargetBand({ ideal: 20, worst: null, unit: 'min' }, env)).toBeNull();
    expect(formatTargetBand(null, env)).toBeNull();
  });
});

describe('radarSpokes', () => {
  const group = (id, extra = {}) => ({ id, score: 80, weight: 1, off: false, missing: false, ...extra });

  it('draws one spoke per group, in the order the API sent them', () => {
    const spokes = radarSpokes({ groups: GROUP_IDS.map((id) => group(id)) }, t);
    expect(spokes.map((s) => s.id)).toEqual([...GROUP_IDS]);
    expect(spokes[0]).toEqual({ id: 'money', label: 'score.group.money', value: 80, state: 'ok' });
  });

  it('keeps the spoke of a group that is switched off, at the centre', () => {
    const [spoke] = radarSpokes({ groups: [group('area', { off: true, score: null })] }, t);
    expect(spoke).toMatchObject({ id: 'area', value: 0, state: 'off' });
  });

  it('marks a group with no data', () => {
    const [spoke] = radarSpokes({ groups: [group('area', { missing: true, score: 50 })] }, t);
    expect(spoke).toMatchObject({ value: 50, state: 'missing' });
  });

  it('copes with no score', () => {
    expect(radarSpokes(null, t)).toEqual([]);
    expect(radarSpokes({}, t)).toEqual([]);
  });
});

describe('the strings the score card asks for', () => {
  it('has a name for every group', () => {
    for (const id of GROUP_IDS) expect(english).toHaveProperty([`score.group.${id}`]);
  });

  it('has a label for every metric there is, with the key the descriptor names', () => {
    for (const metric of METRICS) {
      expect(metric.labelKey, `${metric.group}.${metric.id}`).toBe(`score.metric.${metric.group}.${metric.id}`);
      expect(english, metric.labelKey).toHaveProperty([metric.labelKey]);
    }
  });

  it('explains every qualifier a metric can carry', () => {
    const qualifiers = new Set(METRICS.map((metric) => metric.qualifier).filter(Boolean));
    expect([...qualifiers].sort()).toEqual(['estimate', 'kommune']);
    for (const qualifier of qualifiers) {
      expect(english).toHaveProperty([`score.qualifier.${qualifier}`]);
      expect(english).toHaveProperty([`score.qualifierHelp.${qualifier}`]);
    }
  });

  it('has the words for every unit that is spelled out', () => {
    for (const key of ['score.unit.krPerM2', 'score.unit.days', 'score.unit.years', 'score.yes', 'score.no']) {
      expect(english).toHaveProperty([key]);
    }
    const units = new Set(METRICS.map((metric) => metric.unit));
    const known = [
      'min',
      'km',
      'm',
      'm2',
      'pct',
      'krPerM2',
      'eurPerM2',
      'ratio',
      'days',
      'years',
      'mbit',
      'grade',
      'count',
      'bool',
    ];
    expect([...units].filter((unit) => !known.includes(unit))).toEqual([]);
  });
});
