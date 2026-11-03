/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GROUP_LABELS, METRIC_LABELS, QUALIFIER_LABELS, formatRaw } from '../../../lib/services/score/labels.js';
import { METRICS } from '../../../lib/services/score/metrics/index.js';
import { GROUP_IDS } from '../../../lib/services/score/score.js';

const localeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../ui/src/locales');
const english = JSON.parse(fs.readFileSync(path.join(localeDir, 'en.json'), 'utf-8'));

describe('English labels', () => {
  it('names every group as the web UI does', () => {
    expect(Object.keys(GROUP_LABELS)).toEqual([...GROUP_IDS]);
    for (const id of GROUP_IDS) expect(GROUP_LABELS[id]).toBe(english[`score.group.${id}`]);
  });

  it('names every metric as the web UI does, and no other', () => {
    expect(Object.keys(METRIC_LABELS).sort()).toEqual(METRICS.map((m) => `${m.group}.${m.id}`).sort());
    for (const [key, label] of Object.entries(METRIC_LABELS)) expect(label, key).toBe(english[`score.metric.${key}`]);
  });

  it('names the qualifiers as the web UI does', () => {
    for (const [qualifier, label] of Object.entries(QUALIFIER_LABELS)) {
      expect(label).toBe(english[`score.qualifier.${qualifier}`]);
    }
  });
});

describe('formatRaw', () => {
  it.each([
    [32, 'min', '32 min'],
    [2.34, 'km', '2.3 km'],
    [450.4, 'm', '450 m'],
    [72, 'm2', '72 m²'],
    [3.45, 'pct', '3.5 %'],
    [1.2, 'ratio', '120 %'],
    [250, 'krPerM2', '250 kr/m²/yr'],
    [120, 'days', '120 days'],
    [12, 'years', '12 years'],
    [1000, 'mbit', '1000 Mbit/s'],
    [7.25, 'grade', '7.3'],
    [2, 'count', '2'],
    [1, 'bool', 'yes'],
    [0, 'bool', 'no'],
  ])('writes %s as a %s', (value, unit, expected) => {
    expect(formatRaw(value, unit)).toBe(expected);
  });

  it('says unknown for a value that is not there', () => {
    for (const value of [null, undefined, NaN, Infinity]) expect(formatRaw(value, 'min')).toBe('unknown');
  });
});
