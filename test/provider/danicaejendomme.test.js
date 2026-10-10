/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { mockFredy, providerConfig } from '../utils.js';

// The provider waits the landlord's crawl delay between pages, which would only slow a test.
const sleepMock = vi.fn(() => Promise.resolve());
vi.mock('../../lib/utils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sleep: (...args) => sleepMock(...args),
}));

const provider = await import('../../lib/provider/danicaejendomme.js');

/**
 * Danica Ejendomme, read through the JSON API behind its own vacancy search. The fixture is a real
 * recording of that API's answer for vacant homes ("Til leje"): five of them, none with a deposit, a
 * date or utilities filled in. The same file runs against the live API under `yarn test`, so the
 * assertions on the run are structural.
 */
const TEST_TIMEOUT = 60_000;
const RECORDED = JSON.parse(fs.readFileSync(new URL('../testFixtures/danica_list.json', import.meta.url), 'utf8'));

describe('#danicaejendomme provider testsuite()', () => {
  /** @type {any[]} */
  let listings;

  beforeAll(async () => {
    const Fredy = await mockFredy();
    const runConfig = provider.createConfig(providerConfig.danicaejendomme, []);
    const job = { id: 'danicaejendomme', notificationAdapter: null, spatialFilter: null, specFilter: null };

    const fredy = new Fredy(runConfig, job, provider.metaInformation.id, similarityCache, undefined);
    listings = await fredy.execute();
  }, TEST_TIMEOUT);

  it('finds vacancies', () => {
    expect(listings).toBeInstanceOf(Array);
    expect(listings.length).toBeGreaterThan(0);
  });

  it('gives every listing a rent, a size, rooms, a link and an address', () => {
    for (const listing of listings) {
      expect(listing.price, `rent of ${listing.id}`).toBeGreaterThan(0);
      expect(listing.size, `size of ${listing.id}`).toBeGreaterThan(0);
      expect(listing.rooms, `rooms of ${listing.id}`).toBeGreaterThan(0);
      expect(listing.link, `link of ${listing.id}`).toMatch(/^https:\/\//);
      expect(listing.address, `address of ${listing.id}`).toMatch(/\d{4} /);
    }
  });

  it('places them in Denmark without a geocoding request', () => {
    for (const listing of listings) {
      expect(listing.latitude, `latitude of ${listing.id}`).toBeGreaterThan(54);
      expect(listing.latitude).toBeLessThan(58);
      expect(listing.longitude, `longitude of ${listing.id}`).toBeGreaterThan(7);
      expect(listing.longitude).toBeLessThan(16);
    }
  });

  it('says the home is offered to Danica Pension customers first', () => {
    for (const listing of listings) {
      expect(listing.rental?.priority, `priority of ${listing.id}`).toBe('Danica Pension');
    }
  });

  it('carries no duplicate listings', () => {
    const ids = listings.map((listing) => listing.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('#danicaejendomme the recorded vacancies', () => {
  const [stigbordene, , reserved] = RECORDED.Data.List;
  const normalize = (o) => provider.config.normalize(o);

  it('reads a vacancy as it was recorded', () => {
    const listing = normalize(stigbordene);

    expect(listing).toMatchObject({
      title: 'Bo tæt på vandet i Sluseholmen',
      price: 17950,
      size: 98,
      rooms: 3,
      address: 'Ved Stigbordene 35, st., 2450 København SV',
      link: 'https://www.edc.dk/leje/lejlighed/2450-koebenhavn-sv/ved-stigbordene-35-st-tv/11808187/',
      latitude: 55.6452395056938,
      longitude: 12.5479174049529,
    });
    expect(listing.rental).toEqual({ priority: 'Danica Pension' });
  });

  it('claims nothing about the deposit, the utilities or the date when the portal states none', () => {
    const listing = normalize(stigbordene);

    expect(listing.charges).toBeUndefined();
    expect(listing.chargesIncluded).toBeUndefined();
    expect(listing.rental).not.toHaveProperty('deposit');
    expect(listing.rental).not.toHaveProperty('availableFrom');
  });

  it("falls back to the portal's own page when there is no presentation page", () => {
    const listing = normalize({ ...stigbordene, PresentationUrl: null });

    expect(listing.link).toBe('https://bolig.danicaejendomme.dk/hjem/ejendomsdetaljer?sagsnummer=12150000394');
  });

  it('keeps the rent in the id, so a change to it arrives as a new listing', () => {
    expect(normalize(stigbordene).id).not.toBe(normalize({ ...stigbordene, MonthlyRent: 16950 }).id);
    expect(normalize(stigbordene).id).toBe(normalize({ ...stigbordene }).id);
  });

  it('leaves a reserved home out, and keeps the rest', async () => {
    expect(reserved.Reserved).toBe(true);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => RECORDED }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const rows = await provider.config.getListings('https://bolig.danicaejendomme.dk/hjem/findbolig?search=');

      expect(rows).toHaveLength(RECORDED.Data.List.length - 1);
      expect(rows.some((row) => row.Reserved === true)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('#danicaejendomme what a vacancy may state', () => {
  const base = {
    CaseNo: '1',
    CaseName: 'Test',
    Road: 'Vej',
    HouseNo: '1',
    ZipCode: 2100,
    City: 'København Ø',
    MonthlyRent: 10000,
    Area: 60,
    RoomCount: 2,
  };
  const normalize = (extra) => provider.config.normalize({ ...base, ...extra });

  it('reads utilities on account as the extra costs, and the rent as quoted without them', () => {
    const listing = normalize({ AccountHeat: 500, AccountWater: 150, AccountOperating: null });

    expect(listing.charges).toBe(650);
    expect(listing.chargesIncluded).toBe(false);
  });

  it('reads the deposit, or works it out from a number of months', () => {
    expect(normalize({ Deposit: 30000 }).rental.deposit).toBe(30000);
    expect(normalize({ DepositMonths: 3 }).rental.deposit).toBe(30000);
    expect(normalize({ Deposit: 25000, DepositMonths: 3 }).rental.deposit).toBe(25000);
  });

  it('reads a date as a date and "as soon as possible" as available now', () => {
    expect(normalize({ AvailableDate: '2027-01-15T00:00:00' }).rental.availableFrom).toBe('2027-01-15');
    expect(normalize({ AvailableDate: 'Snarest muligt' }).rental).toMatchObject({ availableImmediately: true });
    expect(normalize({ AvailableDate: null }).rental).toBeUndefined();
  });

  it('does not take a position that is not in Denmark', () => {
    for (const GpsCoordinates of ['0 0', '12.5 55.6', 'junk', null, '55.6']) {
      expect(normalize({ GpsCoordinates }).latitude, String(GpsCoordinates)).toBeUndefined();
    }
  });

  it('builds an address without a floor when there is none', () => {
    expect(normalize({ Floor: null }).address).toBe('Vej 1, 2100 København Ø');
    expect(normalize({ Floor: '1.' }).address).toBe('Vej 1, 1., 2100 København Ø');
  });
});

describe('#danicaejendomme asking the portal', () => {
  const page = (list, total = list.length) => ({
    ok: true,
    status: 200,
    json: async () => ({ IsError: false, Data: { List: list, PageInfo: { TotalRecords: total } } }),
  });
  const URL_ = 'https://bolig.danicaejendomme.dk/hjem/findbolig?search=amager&area=Sjælland';
  let fetchMock;

  beforeEach(() => {
    sleepMock.mockClear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts the search the way the portal does, as vacant rentals only', async () => {
    fetchMock.mockResolvedValue(page([{ CaseNo: '1' }]));

    await provider.config.getListings(URL_);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://bolig.danicaejendomme.dk/api/admin/Property/list/');
    expect(init.method).toBe('POST');
    expect(init.headers['User-Agent']).toMatch(/\S/);
    expect(JSON.parse(init.body)).toMatchObject({
      pStatus: 'Til leje',
      pType: 'Lejebolig',
      pArea: 'Sjælland',
      page: { PageNo: 1, Criteria: { SearchText: 'amager', SearchPType: 'Lejebolig', SearchPArea: 'Sjælland' } },
    });
  });

  it('makes one request, and does not wait, when everything fits on a page', async () => {
    fetchMock.mockResolvedValue(page([{ CaseNo: '1' }, { CaseNo: '2' }]));

    const rows = await provider.config.getListings(URL_);

    expect(rows).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("waits the landlord's crawl delay between pages, and stops at the page limit", async () => {
    fetchMock.mockImplementation(async () => page([{ CaseNo: String(Math.random()) }], 100000));

    const rows = await provider.config.getListings(URL_);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(3);
    expect(sleepMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(5000);
  });

  it('answers with nothing, rather than throwing, when the portal fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
    expect(await provider.config.getListings(URL_)).toEqual([]);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ IsError: true, Message: 'nope', Data: null }),
    });
    expect(await provider.config.getListings(URL_)).toEqual([]);
  });

  it('answers with nothing for a search URL it cannot read', async () => {
    expect(await provider.config.getListings('not a url')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps what a later page failed to add to, instead of dropping the whole run', async () => {
    fetchMock
      .mockResolvedValueOnce(page([{ CaseNo: '1' }], 500))
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'x' });

    expect(await provider.config.getListings(URL_)).toEqual([{ CaseNo: '1' }]);
  });
});

describe('#danicaejendomme declared', () => {
  it('is a Danish provider in kroner', () => {
    expect(provider.metaInformation).toMatchObject({ id: 'danicaejendomme', countries: ['dk'], currency: 'DKK' });
  });

  it('applies the job blacklist', () => {
    const config = provider.createConfig({ url: 'https://bolig.danicaejendomme.dk/hjem/findbolig?search=' }, [
      'Tuborg',
    ]);

    expect(config.filter({ title: 'Tuborg Bakkedrag', address: 'x', description: null })).toBe(false);
    expect(config.filter({ title: 'Sluseholmen', address: 'x', description: null })).toBe(true);
  });
});
