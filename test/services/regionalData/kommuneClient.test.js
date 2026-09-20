/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchKommuner } from '../../../lib/services/regionalData/kommuneClient.js';

/**
 * A simple square, well above the simplification tolerance, so simplify() has no reason to drop a
 * vertex and the test stays about what this module does rather than about @turf/simplify's math.
 */
const squarePolygon = () => ({
  type: 'Polygon',
  coordinates: [
    [
      [10, 55],
      [10.5, 55],
      [10.5, 55.5],
      [10, 55.5],
      [10, 55],
    ],
  ],
});

const feature = (kode, navn, overrides = {}) => ({
  type: 'Feature',
  properties: { kode, navn, ...overrides },
  geometry: squarePolygon(),
});

const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchKommuner', () => {
  it('maps DAWA features to code/name/geometry', async () => {
    fetch.mockResolvedValue(answer(200, { features: [feature('0101', 'København')] }));

    const kommuner = await fetchKommuner();

    expect(kommuner).toEqual([{ code: '0101', name: 'København', geometry: expect.any(Object) }]);
    expect(kommuner[0].geometry.type).toBe('Polygon');
  });

  it('drops Christiansø, which carries no kommuneskat of its own', async () => {
    fetch.mockResolvedValue(
      answer(200, {
        features: [feature('0101', 'København'), feature('0411', 'Christiansø', { udenforkommuneinddeling: true })],
      }),
    );

    const kommuner = await fetchKommuner();

    expect(kommuner.map((k) => k.code)).toEqual(['0101']);
  });

  it('resolves to null on an HTTP error, rather than throwing', async () => {
    fetch.mockResolvedValue(answer(503, {}));

    await expect(fetchKommuner()).resolves.toBeNull();
  });

  it('resolves to null when the request itself fails', async () => {
    fetch.mockRejectedValue(new Error('network down'));

    await expect(fetchKommuner()).resolves.toBeNull();
  });
});
