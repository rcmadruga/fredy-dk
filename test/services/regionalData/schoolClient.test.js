/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UDDANNELSESSTATISTIK_API_KEY_ENV } from '../../../lib/services/regionalData/constants.js';
import { hasApiKey, fetchSchoolStats } from '../../../lib/services/regionalData/schoolClient.js';

const originalEnv = process.env[UDDANNELSESSTATISTIK_API_KEY_ENV];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  delete process.env[UDDANNELSESSTATISTIK_API_KEY_ENV];
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalEnv === undefined) {
    delete process.env[UDDANNELSESSTATISTIK_API_KEY_ENV];
  } else {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = originalEnv;
  }
});

describe('hasApiKey', () => {
  it('is false when the env var is not set', () => {
    expect(hasApiKey()).toBe(false);
  });

  it('is false for a blank value', () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = '   ';
    expect(hasApiKey()).toBe(false);
  });

  it('is true once a key is set', () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = 'test-key';
    expect(hasApiKey()).toBe(true);
  });
});

describe('fetchSchoolStats', () => {
  it('makes no request at all without a key - the whole point of the graceful degradation', async () => {
    const result = await fetchSchoolStats();

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends the key as a bearer token once one is configured', async () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = 'secret-key';
    fetch.mockResolvedValue({ ok: true, json: async () => [] });

    await fetchSchoolStats();

    const [, options] = fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer secret-key');
  });

  it('normalizes rows into SchoolStat shape and drops rows with no institution number', async () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = 'secret-key';
    fetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { Institutionsnummer: '101001', Institution: 'Testskolen', Karaktergennemsnit: '7.5', Inklusionsgrad: '95.2' },
        { Institution: 'No institution number' },
      ],
    });

    const schools = await fetchSchoolStats();

    expect(schools).toEqual([
      { id: '101001', name: 'Testskolen', lat: null, lng: null, gradeAverage: 7.5, inclusionPct: 95.2 },
    ]);
  });

  it('resolves to null rather than throwing on an HTTP error', async () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = 'secret-key';
    fetch.mockResolvedValue({ ok: false, status: 401 });

    await expect(fetchSchoolStats()).resolves.toBeNull();
  });

  it('resolves to null rather than throwing when the request itself fails', async () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = 'secret-key';
    fetch.mockRejectedValue(new Error('network down'));

    await expect(fetchSchoolStats()).resolves.toBeNull();
  });
});
