/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchKommuneTaxRates } from '../../../lib/services/regionalData/taxClient.js';

const tableInfoAnswer = (years) => ({
  ok: true,
  status: 200,
  json: async () => ({ variables: [{ id: 'Tid', values: years.map((year) => ({ id: String(year) })) }] }),
});

const csvAnswer = (csv) => ({
  ok: true,
  status: 200,
  text: async () => csv,
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchKommuneTaxRates', () => {
  it('queries Statbank for the most recent year, out of arrival order', async () => {
    fetch.mockResolvedValueOnce(tableInfoAnswer([2023, 2026, 2024]));
    fetch.mockResolvedValueOnce(csvAnswer('OMRÅDE;SKATPCT;TID;INDHOLD\n101;KOM;2026;23.39\n101;GRUND;2026;5.10\n'));

    await fetchKommuneTaxRates(['0101']);

    const dataUrl = fetch.mock.calls[1][0];
    expect(dataUrl).toContain('Tid=2026');
  });

  it('keys results by the DAWA-style zero-padded code', async () => {
    fetch.mockResolvedValueOnce(tableInfoAnswer([2026]));
    fetch.mockResolvedValueOnce(csvAnswer('OMRÅDE;SKATPCT;TID;INDHOLD\n101;KOM;2026;23.39\n101;GRUND;2026;5.10\n'));

    const rates = await fetchKommuneTaxRates(['0101']);

    expect(rates.get('0101')).toEqual({ kommuneskatPct: 23.39, grundskyldPromille: 5.1 });
    expect(rates.has('101')).toBe(false);
  });

  it('drops a kommune Statbank only answered half of', async () => {
    fetch.mockResolvedValueOnce(tableInfoAnswer([2026]));
    // 0147 (Frederiksberg) never gets its GRUND row.
    fetch.mockResolvedValueOnce(
      csvAnswer('OMRÅDE;SKATPCT;TID;INDHOLD\n101;KOM;2026;23.39\n101;GRUND;2026;5.10\n147;KOM;2026;24.50\n'),
    );

    const rates = await fetchKommuneTaxRates(['0101', '0147']);

    expect([...rates.keys()]).toEqual(['0101']);
  });

  it("handles the UTF-8 BOM Statbank's CSV export leads with", async () => {
    fetch.mockResolvedValueOnce(tableInfoAnswer([2026]));
    fetch.mockResolvedValueOnce(csvAnswer('﻿OMRÅDE;SKATPCT;TID;INDHOLD\n101;KOM;2026;23.39\n101;GRUND;2026;5.10\n'));

    const rates = await fetchKommuneTaxRates(['0101']);

    expect(rates.get('0101').kommuneskatPct).toBe(23.39);
  });

  it('resolves to null when tableinfo cannot be reached', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(fetchKommuneTaxRates(['0101'])).resolves.toBeNull();
  });

  it('resolves to null when the data request fails', async () => {
    fetch.mockResolvedValueOnce(tableInfoAnswer([2026]));
    fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(fetchKommuneTaxRates(['0101'])).resolves.toBeNull();
  });
});
