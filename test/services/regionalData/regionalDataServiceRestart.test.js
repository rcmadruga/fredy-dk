/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync, readdirSync } from 'fs';

// Unlike regionalDataService.test.js, the cache is real here: what it caught is a bug that only
// exists once a value has been through JSON on disk and back, which a pass-through cache cannot show.
// Its directory is a temp one so this cannot touch - or race - the app's own cache.
const TMP_CACHE_DIR = mkdtempSync(path.join(os.tmpdir(), 'fredy-regional-'));
vi.mock('../../../lib/services/regionalData/constants.js', async (importOriginal) => ({
  ...(await importOriginal()),
  CACHE_DIR: TMP_CACHE_DIR,
}));

vi.mock('../../../lib/services/regionalData/kommuneClient.js', () => ({ fetchKommuner: vi.fn() }));
vi.mock('../../../lib/services/regionalData/taxClient.js', () => ({ fetchKommuneTaxRates: vi.fn() }));
vi.mock('../../../lib/services/regionalData/schoolClient.js', () => ({
  fetchSchoolStats: vi.fn(),
  hasApiKey: vi.fn(),
}));

const { fetchKommuner } = await import('../../../lib/services/regionalData/kommuneClient.js');
const { fetchKommuneTaxRates } = await import('../../../lib/services/regionalData/taxClient.js');
const { clearRegionalDataCache } = await import('../../../lib/services/regionalData/diskCache.js');
const { getTaxChoropleth } = await import('../../../lib/services/regionalData/regionalDataService.js');

const kommune = (code, name) => ({ code, name, geometry: { type: 'Polygon', coordinates: [] } });

beforeEach(() => {
  vi.clearAllMocks();
  clearRegionalDataCache();
  rmSync(TMP_CACHE_DIR, { recursive: true, force: true });
  fetchKommuner.mockResolvedValue([kommune('0101', 'København'), kommune('0147', 'Frederiksberg')]);
  fetchKommuneTaxRates.mockResolvedValue(
    new Map([
      ['0101', { kommuneskatPct: 23.39, grundskyldPromille: 5.1 }],
      ['0147', { kommuneskatPct: 24.5, grundskyldPromille: 6 }],
    ]),
  );
});

afterAll(() => {
  rmSync(TMP_CACHE_DIR, { recursive: true, force: true });
});

describe('getTaxChoropleth across a restart', () => {
  it('serves the same rates from the disk cache after the process memory is gone', async () => {
    const first = await getTaxChoropleth();

    // A restart: nothing in memory, only what was written to disk.
    clearRegionalDataCache();
    const second = await getTaxChoropleth();

    expect(second.features.map((f) => f.properties)).toEqual(first.features.map((f) => f.properties));
    expect(second.features).toHaveLength(2);
    expect(second.features[0].properties).toMatchObject({ kommuneskatPct: 23.39, grundskyldPromille: 5.1 });
    // Served from disk, not fetched again.
    expect(fetchKommuneTaxRates).toHaveBeenCalledTimes(1);
  });

  it('does not trust the rate file the first version wrote, where a Map had been saved as {}', async () => {
    // What a deployment that ran the first version holds on disk: valid for weeks, and empty.
    const { writeFileSync, mkdirSync } = await import('fs');
    mkdirSync(TMP_CACHE_DIR, { recursive: true });
    writeFileSync(
      path.join(TMP_CACHE_DIR, 'kommuneTaxRates.json'),
      JSON.stringify({ expiresAt: Date.now() + 86_400_000, value: {} }),
    );

    const choropleth = await getTaxChoropleth();

    expect(choropleth.features).toHaveLength(2);
    expect(fetchKommuneTaxRates).toHaveBeenCalledTimes(1);
  });

  it('caches nothing when the rates could not be fetched, so the next request tries again', async () => {
    fetchKommuneTaxRates.mockResolvedValueOnce(null);

    const failed = await getTaxChoropleth();
    expect(failed.features).toEqual([]);
    expect(readdirSync(TMP_CACHE_DIR).some((file) => file.startsWith('kommuneTaxRates'))).toBe(false);

    clearRegionalDataCache();
    const retried = await getTaxChoropleth();
    expect(retried.features).toHaveLength(2);
  });
});
