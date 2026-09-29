/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/services/poi/overpassClient.js', async (importOriginal) => ({
  ...(await importOriginal()),
  findElements: vi.fn(),
}));
vi.mock('../../../lib/services/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const { findElements } = await import('../../../lib/services/poi/overpassClient.js');
const { fetchGroceryStores, toStore } = await import('../../../lib/services/regionalData/groceryClient.js');

beforeEach(() => vi.clearAllMocks());

describe('toStore', () => {
  it('reads a node, naming it after its name and classifying its chain', () => {
    expect(
      toStore({ type: 'node', id: 7, lat: 55.1, lon: 12.2, tags: { name: 'Netto Nord', brand: 'Netto' } }),
    ).toEqual({
      id: 'node/7',
      name: 'Netto Nord',
      brand: 'Netto',
      operator: null,
      chain: 'netto',
      lat: 55.1,
      lng: 12.2,
    });
  });

  it('takes the centre of a way and falls back to brand, then operator, for the name', () => {
    expect(toStore({ type: 'way', id: 9, center: { lat: 56, lon: 10 }, tags: { brand: 'Lidl' } })).toMatchObject({
      id: 'way/9',
      name: 'Lidl',
      chain: 'lidl',
      lat: 56,
      lng: 10,
    });
    expect(toStore({ type: 'node', id: 1, lat: 1, lon: 1, tags: { operator: 'Coop Danmark' } }).name).toBe(
      'Coop Danmark',
    );
  });

  it('keeps an unnamed store with an empty name rather than dropping it', () => {
    expect(toStore({ type: 'node', id: 2, lat: 1, lon: 1 })).toMatchObject({ name: '', brand: null, chain: 'other' });
  });

  it('drops an element with no position', () => {
    expect(toStore({ type: 'relation', id: 3, tags: { name: 'x' } })).toBeNull();
  });
});

describe('fetchGroceryStores', () => {
  it('asks for supermarkets across the whole country, with a long budget', async () => {
    findElements.mockResolvedValue([]);
    await fetchGroceryStores();

    const [query, options] = findElements.mock.calls[0];
    expect(query).toContain('"ISO3166-1"="DK"');
    expect(query).toContain('"shop"="supermarket"');
    expect(query).toMatch(/\[timeout:\d{2,}\]/);
    expect(options.requestTimeoutMs).toBeGreaterThan(30_000);
  });

  it('returns the stores it could place', async () => {
    findElements.mockResolvedValue([
      { type: 'node', id: 1, lat: 55, lon: 12, tags: { brand: 'Netto' } },
      { type: 'relation', id: 2 },
    ]);
    expect(await fetchGroceryStores()).toHaveLength(1);
  });

  it('answers null, not an empty list, when Overpass did not answer', async () => {
    findElements.mockResolvedValue(null);
    expect(await fetchGroceryStores()).toBeNull();
  });
});
