/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../../../lib/services/geo/denmarkGeo.js');
});

describe('fetchKommuner', () => {
  it('hands back every kommune as code, name and geometry, without a network request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { fetchKommuner } = await import('../../../lib/services/regionalData/kommuneClient.js');

    const kommuner = await fetchKommuner();

    expect(kommuner).toHaveLength(98);
    expect(kommuner[0]).toEqual({
      code: expect.stringMatching(/^\d{4}$/),
      name: expect.any(String),
      geometry: expect.any(Object),
    });
    expect(kommuner.map((k) => k.code)).not.toContain('0411');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('survives the JSON round trip of the disk cache it is stored in', async () => {
    const { fetchKommuner } = await import('../../../lib/services/regionalData/kommuneClient.js');

    const kommuner = await fetchKommuner();

    expect(JSON.parse(JSON.stringify(kommuner))).toEqual(kommuner);
  });

  it('resolves to null, rather than throwing, when the bundled files cannot be read', async () => {
    vi.doMock('../../../lib/services/geo/denmarkGeo.js', () => ({
      getKommunePolygons: () => {
        throw new Error('ENOENT');
      },
    }));
    const { fetchKommuner } = await import('../../../lib/services/regionalData/kommuneClient.js');

    await expect(fetchKommuner()).resolves.toBeNull();
  });
});
