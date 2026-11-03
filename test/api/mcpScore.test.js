/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

vi.mock('../../lib/services/storage/listingsStorage.js', async (importOriginal) => ({
  ...(await importOriginal()),
  queryListings: vi.fn(),
  getListingById: vi.fn(),
  getPricePerSqmByJob: vi.fn(() => new Map()),
}));
vi.mock('../../lib/services/storage/jobStorage.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getJobsForScoring: vi.fn(),
}));
vi.mock('../../lib/services/storage/settingsStorage.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getUserSettings: vi.fn(() => ({})),
}));
vi.mock('../../lib/services/regionalData/regionalDataService.js', () => ({
  getSchoolLayer: vi.fn(async () => ({ available: false, schools: [] })),
  getGroceryLayer: vi.fn(async () => ({ stores: [] })),
  getJobsLayer: vi.fn(async () => ({ failed: true, fetchedAt: null, choropleth: { features: [] } })),
}));
vi.mock('../../lib/services/tracking/Tracker.js', () => ({ trackPoi: vi.fn() }));
vi.mock('../../lib/mcp/mcpAuthentication.js', () => ({
  authenticateToolCall: vi.fn(() => ({ user: { id: 'u1', isAdmin: false }, error: null })),
  authenticateWriteToolCall: vi.fn(async () => ({ user: { id: 'u1', isAdmin: false }, error: null })),
  checkJobAccess: vi.fn(() => true),
}));

import { getListingById, queryListings } from '../../lib/services/storage/listingsStorage.js';
import { getJobsForScoring } from '../../lib/services/storage/jobStorage.js';
import { createMcpServer } from '../../lib/mcp/mcpAdapter.js';
import { formatScore, normalizeGetListing, normalizeListListings } from '../../lib/mcp/mcpNormalizer.js';
import { scoreListing } from '../../lib/services/score/score.js';

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

const row = (id, extra = {}) => ({
  id,
  job_id: 'job-1',
  job_name: 'Search',
  title: `Listing ${id}`,
  dealType: 'rent',
  price: 900,
  size: 60,
  price_per_sqm: 15,
  is_active: 1,
  created_at: 1700000000000,
  latitude: 52.52,
  longitude: 13.405,
  travelTimes: [],
  ...extra,
});

const JOB = (config = null) => ({
  dealType: 'rent',
  specFilter: { maxPrice: 1000 },
  commuteFilter: { action: 'notify', limits: { Work: 35 } },
  scoreConfig: config,
});

beforeEach(() => {
  vi.clearAllMocks();
  getJobsForScoring.mockReturnValue(new Map([['job-1', JOB()]]));
});

describe('formatScore', () => {
  it('is empty without a score', () => {
    expect(formatScore(null)).toBe('');
    expect(formatScore({})).toBe('');
  });

  it('writes a group table with five rows for a rental and six for a purchase', () => {
    const rental = formatScore(scoreListing(row('a'), null, {}));
    const purchase = formatScore(scoreListing(row('b', { dealType: 'buy' }), null, {}));
    const rows = (md) => md.split('\n').filter((line) => /^\| (Money|Schools|Work|Home|Area|Deal) \|/.test(line));
    expect(rows(rental).map((line) => line.split(' | ')[0])).toEqual([
      '| Money',
      '| Schools',
      '| Work',
      '| Home',
      '| Area',
    ]);
    expect(rows(purchase)).toHaveLength(6);
    expect(rental).toContain('(rental, 5 groups)');
    expect(purchase).toContain('(purchase, 6 groups)');
  });

  it('marks a group that is off, and one with no data', () => {
    const md = formatScore(scoreListing(row('a'), { groups: { schools: 0 } }, {}));
    expect(md).toMatch(/\| Schools \| – \| 0 \| off \|/);
    expect(md).toMatch(/\| Work \| 50 \| 1 \| no data \|/);
    expect(md).toContain('**Schools** (off)');
  });

  it('lists each metric with its value, score and targets, and marks unknowns', () => {
    const md = formatScore(scoreListing(row('a'), null, { job: { maxPrice: 1000 } }));
    expect(md).toContain("- Price against the job's maximum: 90 %, score 50 (ideal 80 %, worst 100 %)");
    expect(md).toContain('- Commute to work: unknown, score 50 (ideal 20 min, worst 60 min)');
  });

  it('says a kommune average or an estimate is one', () => {
    const md = formatScore(scoreListing(row('a', { dealType: 'buy' }), null, {}));
    expect(md).toContain('Open jobs in the kommune [kommune average]');
    expect(md).toContain('Estimated upkeep [estimate]');
  });

  it('writes a metric that is switched off as off', () => {
    const md = formatScore(
      scoreListing(row('a', { description: 'Mit Garage' }), { metrics: { 'home.parking': 0 } }, {}),
    );
    expect(md).toContain('- Parking mentioned [estimate]: off');
  });
});

describe('normalizers', () => {
  it('adds the total to the listing table', () => {
    const score = scoreListing(row('a'), null, {});
    const md = textOf(
      normalizeListListings({ totalNumber: 1, page: 1, result: [{ ...row('a'), score }] }, { page: 1, pageSize: 50 }),
    );
    expect(md).toContain('| Score |');
    expect(md).toContain(`| 60 | ${Math.round(score.total)} |`);
  });

  it('shows a dash for a listing without a score', () => {
    const md = textOf(
      normalizeListListings({ totalNumber: 1, page: 1, result: [row('a')] }, { page: 1, pageSize: 50 }),
    );
    expect(md).toMatch(/\| 60 \| – \|/);
  });

  it('puts the score section at the end of the listing details', () => {
    const md = textOf(normalizeGetListing({ ...row('a'), score: scoreListing(row('a'), null, {}) }));
    expect(md).toContain('### Score:');
    expect(md.indexOf('### Listing:')).toBeLessThan(md.indexOf('### Score:'));
  });

  it('leaves the details alone for a listing without a score', () => {
    expect(textOf(normalizeGetListing(row('a')))).not.toContain('### Score');
  });
});

describe('list_listings', () => {
  it('carries the total of each row, scored in one batch', async () => {
    queryListings.mockReturnValue({ totalNumber: 2, page: 1, result: [row('a'), row('b', { dealType: 'buy' })] });

    const md = textOf(await callTool('list_listings', {}));

    expect(md).toContain('| Score |');
    expect(md).not.toMatch(/\| 60 \| – \|/);
    expect(getJobsForScoring).toHaveBeenCalledTimes(1);
  });

  it('still answers when the score cannot be built', async () => {
    queryListings.mockReturnValue({ totalNumber: 1, page: 1, result: [row('a')] });
    getJobsForScoring.mockImplementation(() => {
      throw new Error('database is locked');
    });
    const md = textOf(await callTool('list_listings', {}));
    expect(md).toContain('Listing a');
    expect(md).toMatch(/\| 60 \| – \|/);
  });
});

describe('get_listing', () => {
  it('gives the breakdown of a rental over five groups', async () => {
    getListingById.mockReturnValue(row('a'));
    const md = textOf(await callTool('get_listing', { listingId: 'a' }));
    expect(md).toContain('### Score:');
    expect(md).toContain('(rental, 5 groups)');
    expect(md).not.toMatch(/\| Deal \|/);
  });

  it('gives the breakdown of a purchase over six groups', async () => {
    getListingById.mockReturnValue(row('a', { dealType: 'buy' }));
    getJobsForScoring.mockReturnValue(new Map([['job-1', { ...JOB(), dealType: 'buy' }]]));
    const md = textOf(await callTool('get_listing', { listingId: 'a' }));
    expect(md).toContain('(purchase, 6 groups)');
    expect(md).toMatch(/\| Deal \|/);
  });

  it("uses the job's weights", async () => {
    getListingById.mockReturnValue(row('a'));
    getJobsForScoring.mockReturnValue(new Map([['job-1', JOB({ groups: { area: 0 } })]]));
    const md = textOf(await callTool('get_listing', { listingId: 'a' }));
    expect(md).toMatch(/\| Area \| – \| 0 \| off \|/);
  });

  it('keeps answering "not found" for a listing the caller cannot see', async () => {
    getListingById.mockReturnValue(null);
    const result = await callTool('get_listing', { listingId: 'nope' });
    expect(result.isError).toBe(true);
  });
});
