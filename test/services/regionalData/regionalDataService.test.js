/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Business logic only: caching itself (TTLs, the disk mirror) is diskCache.js's own responsibility
// and is tested there. A pass-through here keeps these tests about what regionalDataService.js
// actually decides, and - just as importantly - never writes a real service's test fixtures into
// the on-disk cache the running app reads from.
vi.mock('../../../lib/services/regionalData/diskCache.js', () => ({
  cached: (key, ttlFor, loader) => loader(),
}));

vi.mock('../../../lib/services/regionalData/kommuneClient.js', () => ({ fetchKommuner: vi.fn() }));
vi.mock('../../../lib/services/regionalData/taxClient.js', () => ({ fetchKommuneTaxRates: vi.fn() }));
vi.mock('../../../lib/services/regionalData/schoolClient.js', () => ({
  fetchSchoolStats: vi.fn(),
  hasApiKey: vi.fn(),
}));

const { fetchKommuner } = await import('../../../lib/services/regionalData/kommuneClient.js');
const { fetchKommuneTaxRates } = await import('../../../lib/services/regionalData/taxClient.js');
const { fetchSchoolStats, hasApiKey } = await import('../../../lib/services/regionalData/schoolClient.js');
const { getTaxChoropleth, getSchoolLayer } = await import('../../../lib/services/regionalData/regionalDataService.js');

const kommune = (code, name) => ({ code, name, geometry: { type: 'Polygon', coordinates: [] } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getTaxChoropleth', () => {
  it('builds one feature per kommune, with the rates folded into properties', async () => {
    fetchKommuner.mockResolvedValue([kommune('0101', 'København')]);
    fetchKommuneTaxRates.mockResolvedValue(new Map([['0101', { kommuneskatPct: 23.39, grundskyldPromille: 5.1 }]]));

    const choropleth = await getTaxChoropleth();

    expect(choropleth.type).toBe('FeatureCollection');
    expect(choropleth.features).toEqual([
      {
        type: 'Feature',
        id: '0101',
        geometry: { type: 'Polygon', coordinates: [] },
        properties: { code: '0101', name: 'København', kommuneskatPct: 23.39, grundskyldPromille: 5.1 },
      },
    ]);
    expect(choropleth.attribution.length).toBeGreaterThan(0);
  });

  it('drops a kommune Statbank has no rate for, rather than shading it wrongly', async () => {
    fetchKommuner.mockResolvedValue([kommune('0101', 'København'), kommune('0147', 'Frederiksberg')]);
    fetchKommuneTaxRates.mockResolvedValue(new Map([['0101', { kommuneskatPct: 23.39, grundskyldPromille: 5.1 }]]));

    const choropleth = await getTaxChoropleth();

    expect(choropleth.features.map((f) => f.id)).toEqual(['0101']);
  });

  it('is an empty (not broken) collection when DAWA could not be reached', async () => {
    fetchKommuner.mockResolvedValue(null);

    const choropleth = await getTaxChoropleth();

    expect(choropleth.features).toEqual([]);
    expect(fetchKommuneTaxRates).not.toHaveBeenCalled();
  });

  it('is an empty collection when Statbank could not be reached', async () => {
    fetchKommuner.mockResolvedValue([kommune('0101', 'København')]);
    fetchKommuneTaxRates.mockResolvedValue(null);

    const choropleth = await getTaxChoropleth();

    expect(choropleth.features).toEqual([]);
  });
});

describe('getSchoolLayer', () => {
  it('reports unavailable, and never calls the client, without an API key', async () => {
    hasApiKey.mockReturnValue(false);

    const layer = await getSchoolLayer();

    expect(layer).toEqual({ available: false, schools: [], attribution: [] });
    expect(fetchSchoolStats).not.toHaveBeenCalled();
  });

  it('reports the schools once a key is configured', async () => {
    hasApiKey.mockReturnValue(true);
    fetchSchoolStats.mockResolvedValue([
      { id: '101001', name: 'Testskolen', lat: 55.6, lng: 12.5, gradeAverage: 7.5, inclusionPct: 95.2 },
    ]);

    const layer = await getSchoolLayer();

    expect(layer.available).toBe(true);
    expect(layer.failed).toBe(false);
    expect(layer.schools).toHaveLength(1);
    expect(layer.attribution.length).toBeGreaterThan(0);
  });

  it('drops a school the API answered for but gave no coordinates', async () => {
    hasApiKey.mockReturnValue(true);
    fetchSchoolStats.mockResolvedValue([
      { id: '101001', name: 'Testskolen', lat: null, lng: null, gradeAverage: 7.5, inclusionPct: 95.2 },
    ]);

    const layer = await getSchoolLayer();

    expect(layer.available).toBe(true);
    expect(layer.schools).toEqual([]);
  });

  it('is available but empty when the key is set and the upstream call still fails', async () => {
    hasApiKey.mockReturnValue(true);
    fetchSchoolStats.mockResolvedValue(null);

    const layer = await getSchoolLayer();

    expect(layer).toEqual({ available: true, failed: true, schools: [], attribution: expect.any(Array) });
  });
});
