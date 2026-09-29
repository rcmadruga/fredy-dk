/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_GROCERY_FILTERS,
  GROCERY_CHAINS,
  GROCERY_FILTERS_STORAGE_KEY,
  chainColor,
  chainOf,
  countByChain,
  filterStores,
  hasActiveGroceryFilters,
  loadGroceryFilters,
  sanitizeGroceryFilters,
  saveGroceryFilters,
} from '../../ui/src/components/map/groceryFilters.js';
import { groceriesToGeoJson } from '../../ui/src/components/map/regionalDataLayers.js';
import { buildGroceryPopupHtml } from '../../ui/src/components/map/regionalPopups.js';
import { CHAIN_IDS } from '../../lib/services/regionalData/groceryChains.js';

const store = (chain, id = chain) => ({ id, chain, name: id, brand: null, lat: 55, lng: 12 });
const t = (key) => key;

describe('the chain table', () => {
  it('lists exactly the chains the server can answer with', () => {
    expect(GROCERY_CHAINS.map((chain) => chain.id).sort()).toEqual([...CHAIN_IDS].sort());
  });

  it('gives every chain its own colour and a grey to anything unknown', () => {
    expect(new Set(GROCERY_CHAINS.map((chain) => chain.color)).size).toBe(GROCERY_CHAINS.length);
    expect(chainColor('nonsense')).toBe(chainColor('other'));
  });
});

describe('filterStores', () => {
  const stores = [store('netto', 'a'), store('rema', 'b'), store('other', 'c')];

  it('shows everything under the defaults', () => {
    expect(filterStores(stores, sanitizeGroceryFilters(DEFAULT_GROCERY_FILTERS))).toHaveLength(3);
  });

  it('hides a chain whose box is unticked, and only it', () => {
    const noNetto = sanitizeGroceryFilters({ chains: { netto: false } });
    expect(filterStores(stores, noNetto).map((s) => s.id)).toEqual(['b', 'c']);
  });

  it('counts a chain the map does not know as other', () => {
    expect(chainOf({ chain: 'brandnew' })).toBe('other');
    expect(filterStores([store('brandnew')], sanitizeGroceryFilters({ chains: { other: false } }))).toEqual([]);
  });

  it('tolerates nothing at all', () => {
    expect(filterStores(null, sanitizeGroceryFilters(null))).toEqual([]);
  });
});

describe('countByChain and hasActiveGroceryFilters', () => {
  it('counts per chain, with a zero for the rest', () => {
    const counts = countByChain([store('netto', '1'), store('netto', '2'), store('lidl', '3')]);
    expect(counts.netto).toBe(2);
    expect(counts.lidl).toBe(1);
    expect(counts.rema).toBe(0);
  });

  it('only reports filters that differ from showing everything', () => {
    expect(hasActiveGroceryFilters(sanitizeGroceryFilters(null))).toBe(false);
    expect(hasActiveGroceryFilters(sanitizeGroceryFilters({ chains: { aldi: false } }))).toBe(true);
  });
});

describe('sanitizeGroceryFilters and storage', () => {
  beforeEach(() => {
    const store = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => store.set(key, String(value)),
      },
    };
  });

  it('never trusts what it is given', () => {
    expect(sanitizeGroceryFilters('junk')).toEqual(sanitizeGroceryFilters(null));
    expect(sanitizeGroceryFilters({ chains: { netto: 'no', rema: false } }).chains).toMatchObject({
      netto: true,
      rema: false,
    });
  });

  it('round-trips through storage, and survives a corrupt entry', () => {
    const filters = sanitizeGroceryFilters({ chains: { lidl: false } });
    saveGroceryFilters(filters);
    expect(loadGroceryFilters()).toEqual(filters);

    window.localStorage.setItem(GROCERY_FILTERS_STORAGE_KEY, '{not json');
    expect(loadGroceryFilters()).toEqual(sanitizeGroceryFilters(null));
  });

  it('carries on when storage is blocked', () => {
    globalThis.window = {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      },
    };
    expect(() => saveGroceryFilters(sanitizeGroceryFilters(null))).not.toThrow();
    expect(loadGroceryFilters()).toEqual(sanitizeGroceryFilters(null));
  });
});

describe('the map data', () => {
  it('builds one point per store, longitude first, keyed by chain', () => {
    const data = groceriesToGeoJson([{ ...store('coop', 'x'), lat: 55.5, lng: 12.5, name: 'Kvickly' }]);
    expect(data.features).toEqual([
      {
        type: 'Feature',
        id: 'x',
        geometry: { type: 'Point', coordinates: [12.5, 55.5] },
        properties: { name: 'Kvickly', brand: null, chain: 'coop' },
      },
    ]);
  });

  it('escapes whatever a volunteer typed into OpenStreetMap', () => {
    const html = buildGroceryPopupHtml({ name: '<img src=x onerror=alert(1)>', brand: '"><b>', chain: 'other' }, t);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img');
  });

  it('names an unnamed store rather than printing an empty heading', () => {
    expect(buildGroceryPopupHtml({ name: '', brand: null, chain: 'netto' }, t)).toContain('map.groceryPopupUnnamed');
  });
});
