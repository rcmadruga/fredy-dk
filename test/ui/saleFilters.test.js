/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  NEUTRAL,
  FILTER_KEYS,
  FILTER_URL_STATE,
  SHARED_FILTER_PARAMS,
  ENERGY_LABELS,
  OWNER_COST_STEPS,
  clearFilter,
  clearAllFilters,
  countActiveFilters,
  describeActiveFilters,
  isActiveFilter,
  toListingsQuery,
} from '../../ui/src/services/listings/listingFilters.js';
import { RELISTED_GAP_DAYS as UI_GAP } from '../../ui/src/views/listings/listingFacts.js';
import { RELISTED_GAP_DAYS as SERVER_GAP, ENERGY_LABEL_LETTERS } from '../../lib/services/sale/saleTerms.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const t = (key, vars) => (vars == null ? key : `${key}:${JSON.stringify(vars)}`);

const defaults = () => ({ page: 1, sort: 'created_at', dir: 'desc', q: null, ...NEUTRAL, active: null });

describe('the sale filters share the overview’s and the map’s one definition', () => {
  const keys = ['ejmax', 'energy', 'relisted', 'reduced'];

  it('are URL state, neutral by default, and carried between the two views', () => {
    for (const key of keys) {
      expect(FILTER_URL_STATE[key], key).toBeDefined();
      expect(FILTER_URL_STATE[key].defaultValue, key).toBeNull();
      expect(NEUTRAL[key], key).toBeNull();
      expect(FILTER_KEYS, key).toContain(key);
      expect(SHARED_FILTER_PARAMS, key).toContain(key);
    }
  });

  it('count when set, one each', () => {
    expect(countActiveFilters(defaults())).toBe(0);
    expect(countActiveFilters({ ...defaults(), ejmax: 4000, energy: 'C', relisted: true, reduced: true })).toBe(4);
    expect(isActiveFilter('relisted', { ...defaults(), relisted: true })).toBe(true);
  });

  it('are switched off one at a time, and all together', () => {
    expect(clearFilter('ejmax')).toEqual({ ejmax: null, page: 1 });
    expect(clearFilter('relisted')).toEqual({ relisted: null, page: 1 });
    expect(clearAllFilters()).toMatchObject({ ejmax: null, energy: null, relisted: null, reduced: null });
  });

  it('reach the API under the names the server reads', () => {
    const { filter } = toListingsQuery({
      ...defaults(),
      ejmax: 4000,
      energy: 'B',
      relisted: true,
      reduced: true,
    });
    expect(filter).toMatchObject({
      saleOwnerCostMax: 4000,
      saleEnergyMin: 'B',
      saleRelistedOnly: true,
      salePriceReducedOnly: true,
    });
  });

  it('say what they are in the chip row', () => {
    const chips = describeActiveFilters(
      { ...defaults(), ejmax: 4000, energy: 'B', relisted: true, reduced: true },
      { t, locale: 'en' },
    );
    expect(chips.map((chip) => chip.key)).toEqual(['ejmax', 'energy', 'relisted', 'reduced']);
    expect(chips[0].label).toContain('filterOwnerCostChip');
    expect(chips[0].label).toContain('4,000');
    expect(chips[1].label).toBe('listings.filterEnergyChip:{"label":"B"}');
    expect(chips[2].label).toBe('listings.filterRelistedOnly');
    expect(chips[3].label).toBe('listings.filterReducedOnly');
  });
});

describe('what the drawer offers matches what the server accepts', () => {
  it('offers the labels the server reads, best first', () => {
    expect(ENERGY_LABELS).toEqual([...ENERGY_LABEL_LETTERS]);
  });

  it('offers round ceilings in ascending order', () => {
    expect(OWNER_COST_STEPS).toEqual([...OWNER_COST_STEPS].sort((a, b) => a - b));
    expect(OWNER_COST_STEPS.every((step) => step > 0)).toBe(true);
  });

  it('draws the relisted line where the sale card does', () => {
    // The frontend cannot import from lib/, so the figure exists twice; this is what keeps it one.
    expect(UI_GAP).toBe(SERVER_GAP);
  });

  it('puts the controls in the shared panel, which both views render', () => {
    const panel = fs.readFileSync(path.join(root, 'ui/src/components/listings/ListingsFilterPanel.jsx'), 'utf-8');
    for (const key of ['ejmax', 'energy', 'relisted', 'reduced']) {
      expect(panel, key).toContain(`${key}:`);
    }
  });
});
