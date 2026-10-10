/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/services/storage/jobStorage.js', () => ({ getJob: vi.fn(() => null) }));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({ getUserSettings: vi.fn(() => ({})) }));

const { normalizeListingFilters } = await import('../../lib/api/listingFilterQuery.js');

const filtersOf = (source) => normalizeListingFilters(source, { userId: 'u', isAdmin: false }).filters;

describe('normalizeListingFilters, the move-in window', () => {
  it('passes real dates and the dated-only flag through', () => {
    expect(filtersOf({ moveInFrom: '2027-01-01', moveInTo: '2027-03-31', moveInDatedOnly: 'true' })).toMatchObject({
      moveInFrom: '2027-01-01',
      moveInTo: '2027-03-31',
      moveInDatedOnly: true,
    });
  });

  it('takes the date part of a timestamp', () => {
    expect(filtersOf({ moveInFrom: '2027-01-01T00:00:00Z' }).moveInFrom).toBe('2027-01-01');
  });

  it('ignores anything that is not a real calendar date, so a hand-edited URL filters nothing', () => {
    for (const bad of [
      '2027-02-30',
      'tomorrow',
      '',
      "2027-01-01'; DROP TABLE listings;--",
      20270101,
      null,
      undefined,
    ]) {
      const filters = filtersOf({ moveInFrom: bad, moveInTo: bad });

      expect(filters.moveInFrom, String(bad)).toBeNull();
      expect(filters.moveInTo, String(bad)).toBeNull();
    }
  });

  it('is off unless asked for', () => {
    const filters = filtersOf({});

    expect(filters).toMatchObject({ moveInFrom: null, moveInTo: null, moveInDatedOnly: false });
  });
});
