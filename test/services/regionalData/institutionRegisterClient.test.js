/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchInstitutionRegister,
  normalizeWebsite,
} from '../../../lib/services/regionalData/institutionRegisterClient.js';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const row = (overrides = {}) => ({
  institutionNumber: 101003,
  institutionType: 'Folkeskoler',
  latitude: 55.69,
  longitude: 12.58,
  address: 'Øster Voldgade 15',
  postalCode: '1350',
  postalDistrict: 'København K',
  website: 'www.example.dk',
  activeCodeName: 'Aktiv tællingsmæssigt for Danmarks Statistik',
  ...overrides,
});

describe('normalizeWebsite', () => {
  it('adds the scheme the register leaves off', () => {
    expect(normalizeWebsite('www.uuf.kk.dk')).toBe('https://www.uuf.kk.dk/');
    expect(normalizeWebsite('http://x.dk/a')).toBe('http://x.dk/a');
  });

  it('refuses anything a link should not point at', () => {
    expect(normalizeWebsite('javascript:alert(1)')).toBeNull();
    expect(normalizeWebsite('   ')).toBeNull();
    expect(normalizeWebsite(null)).toBeNull();
    expect(normalizeWebsite('nodots')).toBeNull();
  });
});

describe('fetchInstitutionRegister', () => {
  it('keys the institutions that have a position by institution number', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => [row()] });

    const register = await fetchInstitutionRegister();

    expect(register.get('101003')).toEqual({
      lat: 55.69,
      lng: 12.58,
      type: 'Folkeskoler',
      address: 'Øster Voldgade 15, 1350 København K',
      website: 'https://www.example.dk/',
      active: true,
    });
  });

  it('drops an institution with no position, and one whose position is not in Denmark', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => [
        row({ institutionNumber: 1, latitude: null, longitude: null }),
        row({ institutionNumber: 2, latitude: 0, longitude: 0 }),
        row({ institutionNumber: 3 }),
      ],
    });

    const register = await fetchInstitutionRegister();

    expect([...register.keys()]).toEqual(['3']);
  });

  it('marks closed and closing institutions as inactive rather than dropping them', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => [
        row({ institutionNumber: 1, activeCodeName: 'Nedlagt institution ' }),
        row({ institutionNumber: 2, activeCodeName: 'Under afvikling' }),
      ],
    });

    const register = await fetchInstitutionRegister();

    expect(register.get('1').active).toBe(false);
    expect(register.get('2').active).toBe(false);
  });

  it('resolves to null on an HTTP error, on a body that is not a list, and on a failed request', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(fetchInstitutionRegister()).resolves.toBeNull();

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ error: 'changed' }) });
    await expect(fetchInstitutionRegister()).resolves.toBeNull();

    fetch.mockRejectedValueOnce(new Error('network down'));
    await expect(fetchInstitutionRegister()).resolves.toBeNull();
  });
});
