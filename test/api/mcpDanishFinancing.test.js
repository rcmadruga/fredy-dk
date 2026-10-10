/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

vi.mock('../../lib/services/storage/listingsStorage.js', () => ({
  queryListings: vi.fn(() => ({ totalNumber: 0, page: 1, result: [] })),
  getListingById: vi.fn(),
  setListingNotes: vi.fn(() => 1),
}));
vi.mock('../../lib/services/storage/watchListStorage.js', () => ({
  ensureWatch: vi.fn(() => ({ watched: true })),
  deleteWatch: vi.fn(() => ({ deleted: true })),
}));
vi.mock('../../lib/services/tracking/Tracker.js', () => ({ trackPoi: vi.fn() }));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({ getUserSettings: vi.fn(() => ({})) }));
vi.mock('../../lib/services/providers/providerCurrency.js', () => ({
  getCurrencyForProvider: vi.fn(async (id) => (id === 'boligsiden' ? 'DKK' : 'EUR')),
}));
vi.mock('../../lib/mcp/mcpAuthentication.js', () => ({
  authenticateToolCall: vi.fn(() => ({ user: { id: 'u1', isAdmin: false }, error: null })),
  authenticateWriteToolCall: vi.fn(async () => ({ user: { id: 'u1', isAdmin: false }, error: null })),
  checkJobAccess: vi.fn(() => true),
}));

import { getListingById } from '../../lib/services/storage/listingsStorage.js';
import { getUserSettings } from '../../lib/services/storage/settingsStorage.js';
import { createMcpServer } from '../../lib/mcp/mcpAdapter.js';

const HOUSEHOLD = {
  personA: { label: 'A', enabled: true, age: 35, primaryIncome: 40000, secondaryIncome: 0 },
  livingCosts: 12000,
  financing: { equity: 300000 },
};

const textOf = (result) => result.content.map((part) => part.text).join('\n');

async function callTool(name, args) {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  return result;
}

describe('calculate_financing for a home priced in kroner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserSettings.mockReturnValue({ finance_profile: HOUSEHOLD });
  });

  it('answers with the Danish model, in kroner', async () => {
    getListingById.mockReturnValue({
      id: 'dk1',
      title: 'Villa i Odense',
      price: 2000000,
      dealType: 'buy',
      provider: 'boligsiden',
      sale_terms: { ownerCostMonthly: 3000 },
    });

    const md = textOf(await callTool('calculate_financing', { listingId: 'dk1' }));

    expect(md).toContain('### Verdict: AFFORDABLE');
    expect(md).toContain('Danish');
    expect(md).toContain('Realkreditlån');
    expect(md).toContain('Tinglysning skøde');
    expect(md).toContain('kr');
    expect(md).not.toContain('Grunderwerbsteuer');
    expect(md).not.toContain('EUR');
    // Skoede 13,850 + pant 21,825 + 5,575 + udbetaling 100,000.
    expect(md).toContain('141.250 kr');
    expect(md).toContain('- **Ejerudgift:** 3.000 kr (from the advert)');
  });

  it('says plainly that the figure is the loans alone when no ejerudgift is known', async () => {
    getListingById.mockReturnValue({ id: 'dk2', price: 2000000, dealType: 'buy', provider: 'boligsiden' });

    const md = textOf(await callTool('calculate_financing', { listingId: 'dk2' }));

    expect(md).toContain('No ejerudgift is known for this home');
    expect(md).toContain('unknown (the land value is not known)');
  });

  it('takes the Danish rates the caller passes', async () => {
    getListingById.mockReturnValue({ id: 'dk3', price: 2000000, dealType: 'buy', provider: 'boligsiden' });

    const md = textOf(
      await callTool('calculate_financing', { listingId: 'dk3', annualRate: 3, bankRate: 5, downPaymentPct: 10 }),
    );

    expect(md).toContain('Udbetaling (10 %)');
    expect(md).toContain('3 % + 1 % bidrag');
  });

  it('keeps the German model for a listing priced in euros', async () => {
    getListingById.mockReturnValue({ id: 'de1', price: 400000, dealType: 'buy', provider: 'immoscout' });

    const md = textOf(await callTool('calculate_financing', { listingId: 'de1' }));

    expect(md).toContain('Grunderwerbsteuer');
    expect(md).not.toContain('Realkreditlån');
  });

  it('answers a bare purchase price the Danish way when the buying tab is on Denmark', async () => {
    getUserSettings.mockReturnValue({
      finance_profile: { ...HOUSEHOLD, financing: { ...HOUSEHOLD.financing, market: 'dk' } },
    });

    const md = textOf(await callTool('calculate_financing', { purchasePrice: 2000000 }));

    expect(md).toContain('Realkreditlån');
  });
});
