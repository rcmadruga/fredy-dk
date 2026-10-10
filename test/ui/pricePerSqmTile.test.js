/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';

import { buildObjectFacts, pricePerSqmOf } from '../../ui/src/views/listings/listingFacts.js';
import { formatPricePerSqm } from '../../ui/src/services/listings/marketBenchmark.js';

const t = (key) => (key === 'common.na' ? 'N/A' : key);
const ctx = { t, locale: 'da-DK', currency: 'DKK' };

/** A Boligsiden sale as the API returns it when the stored price per m² column is empty. */
const sale = {
  id: 'dk-1',
  dealType: 'buy',
  provider: 'boligsiden',
  price: 2495000,
  size: 125,
  price_per_sqm: null,
  sale_terms: { pricePerM2: 19960 },
};

/** The tile's text, which is what the reader sees in the "At a glance" box. */
const tileOf = (listing) => buildObjectFacts(listing, ctx).tiles.find((tile) => tile.id === 'pricePerSqm').value;

describe('the price per m² in the "at a glance" box', () => {
  it("shows the portal's own figure when the sale terms state one, even without the stored column", () => {
    expect(tileOf(sale)).toBe(formatPricePerSqm(19960, 'da-DK', 'DKK', false));
    expect(tileOf(sale)).not.toBeNull();
  });

  it('divides the price by the size when the portal states nothing', () => {
    const listing = { ...sale, sale_terms: { ownerCostMonthly: 3900 } };
    expect(tileOf(listing)).toBe(formatPricePerSqm(19960, 'da-DK', 'DKK', false));
    // 2,495,000 kr over 125 m² is 19,960 kr/m².
    expect(pricePerSqmOf(listing, null)).toBe(19960);
  });

  it('divides the price by the size for a sale that has no sale terms at all', () => {
    expect(pricePerSqmOf({ price: 300000, size: 80, sale_terms: null }, null)).toBe(3750);
  });

  it('prefers the sale terms to the stored column, and the stored column to a division', () => {
    expect(pricePerSqmOf({ ...sale, price_per_sqm: 19000 }, { pricePerSqm: 19000 })).toBe(19960);
    expect(pricePerSqmOf({ price: 300000, size: 80, sale_terms: null }, { pricePerSqm: 3700 })).toBe(3700);
  });

  it('stays on N/A when neither the portal nor price and size say anything', () => {
    expect(tileOf({ ...sale, size: null, sale_terms: null })).toBeNull();
    expect(tileOf({ ...sale, price: null, sale_terms: null })).toBeNull();
    expect(pricePerSqmOf({ price: 1000, size: 1, sale_terms: null }, null)).toBeNull();
    expect(pricePerSqmOf({ price: 0, size: 80, sale_terms: null }, null)).toBeNull();
    expect(pricePerSqmOf({ price: 1000, size: 80, sale_terms: { pricePerM2: 0 } }, null)).toBe(12.5);
  });

  it('leaves a German listing exactly as it was', () => {
    const listing = { id: 'de-1', dealType: 'buy', price: 400000, size: 100, price_per_sqm: 4000 };
    expect(pricePerSqmOf(listing, { pricePerSqm: 4000 })).toBe(4000);
    expect(
      buildObjectFacts(listing, { t, locale: 'de-DE' }).tiles.find((tile) => tile.id === 'pricePerSqm').value,
    ).toBe(formatPricePerSqm(4000, 'de-DE', 'EUR', false));
  });
});
