/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/services/storage/jobStorage.js', () => ({ getJob: vi.fn(() => null) }));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({ getUserSettings: vi.fn(() => ({})) }));

const { normalizeListingFilters } = await import('../../lib/api/listingFilterQuery.js');

const filtersOf = (source) => normalizeListingFilters(source, { userId: 'u', isAdmin: false }).filters;

describe('normalizeListingFilters, the sale filters', () => {
  it('passes a ceiling, a label and the two flags through', () => {
    expect(
      filtersOf({ saleOwnerCostMax: '4000', saleEnergyMin: 'b', saleRelistedOnly: 'true', salePriceReducedOnly: true }),
    ).toMatchObject({ saleOwnerCostMax: 4000, saleEnergyMin: 'B', saleRelistedOnly: true, salePriceReducedOnly: true });
  });

  it('reads the energy label by its letter', () => {
    expect(filtersOf({ saleEnergyMin: 'A2020' }).saleEnergyMin).toBe('A');
  });

  it('ignores whatever is not a usable value, so a hand-edited URL filters nothing', () => {
    for (const bad of ['', 'abc', '-5', '0', null, undefined, NaN]) {
      expect(filtersOf({ saleOwnerCostMax: bad }).saleOwnerCostMax, String(bad)).toBeNull();
    }
    for (const bad of ['', 'H', "A'; DROP TABLE listings;--", 7, null, undefined]) {
      expect(filtersOf({ saleEnergyMin: bad }).saleEnergyMin, String(bad)).toBeNull();
    }
    expect(filtersOf({ saleRelistedOnly: 'maybe', salePriceReducedOnly: 'no' })).toMatchObject({
      saleRelistedOnly: false,
      salePriceReducedOnly: false,
    });
  });

  it('is off unless asked for', () => {
    expect(filtersOf({})).toMatchObject({
      saleOwnerCostMax: null,
      saleEnergyMin: null,
      saleRelistedOnly: false,
      salePriceReducedOnly: false,
    });
  });
});
