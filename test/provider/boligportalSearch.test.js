/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

vi.mock('../../lib/utils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sleep: () => Promise.resolve(),
}));
vi.mock('../../lib/services/tracking/Tracker.js', () => ({ trackPoi: vi.fn(async () => {}) }));

const { fetchSearchHtml, STORE_SELECTOR } = await import('../../lib/services/boligportal/boligportalSearch.js');
const { config, readSearchPage, createConfig, metaInformation } = await import('../../lib/provider/boligportal.js');
const { trackPoi } = await import('../../lib/services/tracking/Tracker.js');

const FIXTURE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'testFixtures', 'boligportal.html'),
  'utf8',
);

/**
 * A stand-in for the shared browser. `challengeFor` is how long, in `waitForFunction` calls, the page
 * stays a challenge before the real one arrives; `Infinity` is a wall that never clears.
 */
function fakeBrowser({ status = 200, waitFails = false, html = FIXTURE } = {}) {
  const page = {
    goto: vi.fn(async () => ({ status: () => status })),
    waitForFunction: vi.fn(async () => {
      if (waitFails) throw new Error('Waiting failed: timeout');
    }),
    content: vi.fn(async () => html),
    close: vi.fn(async () => {}),
  };
  return { page, newPage: vi.fn(async () => page) };
}

/** A search page whose store holds the given adverts and successor. */
const pageWith = (ads, nextPageUrl = null) =>
  `<html><body><script id="store" type="application/json">${JSON.stringify({
    component: 'Search',
    props: { page_props: { results: ads, next_page_url: nextPageUrl } },
  })}</script></body></html>`;

const advert = (id, extra = {}) => ({
  id,
  url: `/lejligheder/x/${id}m2-2-vaer-id-${id}`,
  title: `Ad ${id}`,
  monthly_rent: 8000,
  size_m2: 60,
  rooms: 2,
  advertised_date: '2026-09-18T08:00:00.000000+00:00',
  ...extra,
});

beforeEach(() => vi.clearAllMocks());

describe('readSearchPage', () => {
  it('reads the adverts and the address of the next page out of the fixture', () => {
    const search = readSearchPage(FIXTURE);

    expect(search.ads).toHaveLength(8);
    expect(search.nextUrl).toBe(
      'https://www.boligportal.dk/lejeboliger/hiller%C3%B8d/alle-v%C3%A6relser/?max_monthly_rent=18424&offset=18',
    );
  });

  it('resolves a next page that comes as an absolute url as well as a relative one', () => {
    expect(readSearchPage(pageWith([advert(1)], 'https://www.boligportal.dk/x/?offset=18')).nextUrl).toBe(
      'https://www.boligportal.dk/x/?offset=18',
    );
    expect(readSearchPage(pageWith([advert(1)], '/x/?offset=18')).nextUrl).toBe(
      'https://www.boligportal.dk/x/?offset=18',
    );
  });

  it('reports an empty result list as empty, not as a failure', () => {
    expect(readSearchPage(pageWith([]))).toEqual({ ads: [], nextUrl: null });
  });

  it.each([
    ['nothing at all', null],
    ['a page without the store', '<html><body>Just a moment...</body></html>'],
    ['a store that is not JSON', '<script id="store" type="application/json">{oops</script>'],
    [
      'a store without a result list',
      '<script id="store" type="application/json">{"props":{"page_props":{}}}</script>',
    ],
  ])('says so, rather than reporting no adverts, for %s', (_label, html) => {
    expect(readSearchPage(html)).toBeNull();
  });
});

describe('normalize', () => {
  const normalize = (ad) => config.normalize(ad);

  it('turns an advert into a listing with the rent as the price', () => {
    const listing = normalize({
      id: 5671615,
      url: '/lejligheder/hiller%C3%B8d/23m2-1-vaer-id-5671615',
      title: '1 værelses lejlighed',
      street_name: 'Bakkegade',
      street_number: '23',
      postal_code: '3400',
      city: 'Hillerød',
      rooms: 1,
      size_m2: 23,
      monthly_rent: 5900,
      monthly_rent_extra_costs: 450,
      deposit: 17700,
      location: { lat: 55.932, lng: 12.31 },
      images: [
        { url: 'https://img/plan', is_floor_plan: true },
        { url: 'https://img/photo', is_floor_plan: false },
      ],
      advertised_date: '2026-09-18T08:13:24.116254+00:00',
    });

    expect(listing).toMatchObject({
      title: '1 værelses lejlighed',
      link: 'https://www.boligportal.dk/lejligheder/hiller%C3%B8d/23m2-1-vaer-id-5671615',
      // The rent as advertised: neither the extra costs nor the deposit are in it.
      price: 5900,
      size: 23,
      rooms: 1,
      address: 'Bakkegade 23, 3400 Hillerød',
      // A floor plan says nothing about the place as a thumbnail.
      image: 'https://img/photo',
      latitude: 55.932,
      longitude: 12.31,
      publishedAt: Date.parse('2026-09-18T08:13:24.116Z'),
    });
  });

  it('falls back to postcode and town when the landlord hides the street', () => {
    expect(normalize(advert(1, { postal_code: '3400', city: 'Hillerød' })).address).toBe('3400 Hillerød');
  });

  it('has no address, rather than a made-up one, when there is nothing to build it from', () => {
    expect(normalize(advert(1, { postal_code: null, city: null })).address).toBeNull();
  });

  it('leaves the coordinates off when the page gives none, so the geocoder can try', () => {
    const listing = normalize(advert(1, { location: null }));
    expect(listing).not.toHaveProperty('latitude');
    expect(listing).not.toHaveProperty('longitude');
  });

  it('uses a floor plan as the image only when there is nothing else', () => {
    expect(normalize(advert(1, { images: [{ url: 'https://img/plan', is_floor_plan: true }] })).image).toBe(
      'https://img/plan',
    );
    expect(normalize(advert(1, { images: [] })).image).toBeNull();
  });

  it('puts the price into the id, so a reduction arrives as a new listing', () => {
    expect(normalize(advert(1, { monthly_rent: 8000 })).id).not.toBe(normalize(advert(1, { monthly_rent: 7500 })).id);
    expect(normalize(advert(1, { monthly_rent: 8000 })).id).toBe(normalize(advert(1, { monthly_rent: 8000 })).id);
  });

  it('reads a missing figure as null, never as 0', () => {
    const listing = normalize(advert(1, { monthly_rent: null, size_m2: '', rooms: undefined }));
    expect(listing.price).toBeNull();
    expect(listing.size).toBeNull();
    expect(listing.rooms).toBeNull();
  });
});

describe('the provider config', () => {
  it('declares Danish kroner, so prices are not shown as euros', () => {
    expect(metaInformation.currency).toBe('DKK');
    expect(metaInformation.countries).toEqual(['dk']);
  });

  it('names the rent parameters the site uses, so a price range can be read off a search url', () => {
    expect(config.priceRangeParams).toEqual({ min: 'min_monthly_rent', max: 'max_monthly_rent' });
  });

  it('applies the job blacklist to title, address and description', () => {
    const { filter } = createConfig({ url: 'https://www.boligportal.dk/lejeboliger/x/', enabled: true }, ['kollektiv']);
    expect(filter({ title: 'Værelse i kollektiv', address: 'a', description: null })).toBe(false);
    expect(filter({ title: 'Lejlighed', address: 'Kollektivvej 1', description: null })).toBe(false);
    expect(filter({ title: 'Lejlighed', address: 'a', description: 'fint kollektiv' })).toBe(false);
    expect(filter({ title: 'Lejlighed', address: 'a', description: null })).toBe(true);
  });
});

describe('getListings', () => {
  const run = (browser, url = 'https://www.boligportal.dk/lejeboliger/x/') => config.getListings(url, browser);

  it('follows the page the site names as the next one, and stops after two pages', async () => {
    const pages = [
      pageWith([advert(1), advert(2)], '/lejeboliger/x/?offset=18'),
      pageWith([advert(3)], '/lejeboliger/x/?offset=36'),
      pageWith([advert(4)], null),
    ];
    const browser = fakeBrowser();
    browser.page.content.mockImplementation(async () => pages.shift());

    const ads = await run(browser);

    expect(ads.map((ad) => ad.id).sort()).toEqual([1, 2, 3]);
    expect(browser.page.goto.mock.calls.map(([url]) => url)).toEqual([
      'https://www.boligportal.dk/lejeboliger/x/',
      'https://www.boligportal.dk/lejeboliger/x/?offset=18',
    ]);
  });

  it('does not ask for a second page when the site names none', async () => {
    const browser = fakeBrowser({ html: pageWith([advert(1)], null) });

    await run(browser);

    expect(browser.page.goto).toHaveBeenCalledTimes(1);
  });

  it('lists the newest advert first, whatever order the site sent them in', async () => {
    const browser = fakeBrowser({
      html: pageWith([
        advert(1, { advertised_date: '2026-09-10T08:00:00.000000+00:00' }),
        advert(2, { advertised_date: '2026-09-19T08:00:00.000000+00:00' }),
        advert(3, { advertised_date: '2026-09-15T08:00:00.000000+00:00' }),
      ]),
    });

    expect((await run(browser)).map((ad) => ad.id)).toEqual([2, 3, 1]);
  });

  it('counts an advert once when two pages both carry it', async () => {
    const pages = [pageWith([advert(1), advert(2)], '/x/?offset=18'), pageWith([advert(2), advert(3)])];
    const browser = fakeBrowser();
    browser.page.content.mockImplementation(async () => pages.shift());

    expect((await run(browser)).map((ad) => ad.id).sort()).toEqual([1, 2, 3]);
  });

  it('drops what says outright it is not live, and keeps what says nothing', async () => {
    const browser = fakeBrowser({
      html: pageWith([
        advert(1),
        advert(2, { deleted: true }),
        advert(3, { state: 'EXPIRED' }),
        advert(4, { state: 'ACTIVE_APPROVED' }),
        advert(5, { state: undefined }),
      ]),
    });

    expect((await run(browser)).map((ad) => ad.id).sort()).toEqual([1, 4, 5]);
  });

  it('fails the run when the first page cannot be read, so a wall is not reported as "no listings"', async () => {
    await expect(run(fakeBrowser({ waitFails: true }))).rejects.toThrow(/did not return a search page/);
  });

  it('keeps what it has when a later page cannot be read', async () => {
    const pages = [pageWith([advert(1)], '/x/?offset=18'), '<html>Just a moment...</html>'];
    const browser = fakeBrowser();
    browser.page.content.mockImplementation(async () => pages.shift());

    expect((await run(browser)).map((ad) => ad.id)).toEqual([1]);
  });
});

describe('fetchSearchHtml', () => {
  it('returns the page once the store is there, and closes the page it opened', async () => {
    const browser = fakeBrowser();

    const html = await fetchSearchHtml('https://www.boligportal.dk/lejeboliger/x/', browser);

    expect(html).toBe(FIXTURE);
    expect(browser.page.waitForFunction).toHaveBeenCalledOnce();
    expect(browser.page.waitForFunction.mock.calls[0][2]).toBe(STORE_SELECTOR);
    expect(browser.page.close).toHaveBeenCalledOnce();
  });

  it('waits for the real page even when the challenge that came first was answered 403', async () => {
    // Cloudflare serves its challenge as a 403 and the page follows; a verdict taken from that first
    // status would discard a page that had loaded fine. This is the reason the shared extractor is not used.
    const browser = fakeBrowser({ status: 403 });

    await expect(fetchSearchHtml('https://www.boligportal.dk/lejeboliger/x/', browser)).resolves.toBe(FIXTURE);
    expect(trackPoi).not.toHaveBeenCalled();
  });

  it('gives up and records a bot detection when the store never arrives', async () => {
    const browser = fakeBrowser({ status: 403, waitFails: true });

    await expect(fetchSearchHtml('https://www.boligportal.dk/lejeboliger/x/', browser)).resolves.toBeNull();
    expect(trackPoi).toHaveBeenCalledOnce();
    expect(browser.page.close).toHaveBeenCalledOnce();
  });

  it('stops at once when rate limited, without waiting for a page that will not come', async () => {
    const browser = fakeBrowser({ status: 429 });

    await expect(fetchSearchHtml('https://www.boligportal.dk/lejeboliger/x/', browser)).resolves.toBeNull();
    expect(browser.page.waitForFunction).not.toHaveBeenCalled();
    expect(browser.page.close).toHaveBeenCalledOnce();
  });

  it('closes the page and returns null when navigation itself throws', async () => {
    const browser = fakeBrowser();
    browser.page.goto.mockRejectedValue(new Error('net::ERR_CONNECTION_RESET'));

    await expect(fetchSearchHtml('https://www.boligportal.dk/lejeboliger/x/', browser)).resolves.toBeNull();
    expect(browser.page.close).toHaveBeenCalledOnce();
  });
});
