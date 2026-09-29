/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { CHAIN_IDS, chainOf } from '../../../lib/services/regionalData/groceryChains.js';

describe('chainOf', () => {
  it.each([
    [{ brand: 'Netto', name: 'Netto' }, 'netto'],
    [{ name: 'Netto Marken' }, 'netto'],
    [{ brand: 'Rema 1000' }, 'rema'],
    [{ name: 'REMA1000' }, 'rema'],
    [{ brand: 'føtex' }, 'salling'],
    [{ name: 'Bilka Odense' }, 'salling'],
    [{ name: 'Salling Stormarked' }, 'salling'],
    [{ brand: 'SuperBrugsen' }, 'coop'],
    [{ name: "Dagli'Brugsen Ravnsborg" }, 'coop'],
    [{ brand: 'Kvickly' }, 'coop'],
    [{ brand: 'Irma' }, 'coop'],
    [{ brand: 'Coop 365discount' }, 'coop'],
    [{ brand: 'Lidl' }, 'lidl'],
    [{ operator: 'Aldi Danmark' }, 'aldi'],
    [{ brand: 'MENY' }, 'meny'],
  ])('puts %j in %s', (tags, chain) => {
    expect(chainOf(tags)).toBe(chain);
  });

  it('files independents, unbranded stores and junk under other', () => {
    expect(chainOf({ name: 'Min Købmand' })).toBe('other');
    expect(chainOf({})).toBe('other');
    expect(chainOf(null)).toBe('other');
    expect(chainOf({ brand: 42 })).toBe('other');
  });

  it('never answers with an id it does not list', () => {
    for (const tags of [{ brand: 'Netto' }, { name: 'x' }, null]) {
      expect(CHAIN_IDS).toContain(chainOf(tags));
    }
  });
});
