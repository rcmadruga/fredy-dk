/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import {
  fetchJobPostings,
  parseSearchPage,
  toRawAd,
  JOB_SEARCH_TERMS,
  MAX_PAGES_PER_TERM,
  PAGE_PAUSE_MS,
} from '../../../lib/services/regionalData/jobsClient.js';

// A real Jobindex result page from 2026-10-04, trimmed to five of its adverts (see the comment inside).
const PAGE = fs.readFileSync(new URL('../../testFixtures/jobindex/search.html', import.meta.url), 'utf8');

const answer = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body });

/** A result page holding the given adverts, in the shape Jobindex embeds. */
function pageOf(results, totalPages = 1) {
  const stash = { 'jobsearch/result_app': { storeData: { searchResponse: { total_pages: totalPages, results } } } };
  return `<html><script>var Stash = ${JSON.stringify(stash)};\nvar later = {"a": "}"};</script></html>`;
}
const advert = (tid, headline = 'Ernæringsassistent') => ({
  tid,
  headline,
  companytext: 'Plejehjem',
  area: 'Hillerød',
  share_url: `https://www.jobindex.dk/vis-job/${tid}`,
});

describe('parseSearchPage', () => {
  it('reads the real recorded page', () => {
    const parsed = parseSearchPage(PAGE);

    expect(parsed.totalPages).toBe(7);
    expect(parsed.ads).toHaveLength(5);
    expect(parsed.ads[0]).toMatchObject({
      id: 'h1702537',
      title: 'Økonoma eller ernæringsassistent til Nøddebo børnehave',
      employer: 'Solrød Kommune',
      area: 'Solrød Strand',
      url: 'https://www.jobindex.dk/vis-job/h1702537',
      addresses: [{ zip: '2680', city: 'Solrød Strand', lat: 55.520382, lng: 12.201775 }],
    });
  });

  it('keeps an advert that has only a place text, and one that names several towns', () => {
    const { ads } = parseSearchPage(PAGE);

    expect(ads[1]).toMatchObject({ area: '3400 Hillerød' });
    expect(ads[1].addresses.every((a) => a.lat == null)).toBe(true);
    expect(ads[2].area).toBe('Herning, Holstebro, Skive eller Karup J');
  });

  it('is null for anything that is not a result page', () => {
    expect(parseSearchPage('<html>Just a moment...</html>')).toBeNull();
    expect(parseSearchPage('')).toBeNull();
    expect(parseSearchPage(null)).toBeNull();
    expect(parseSearchPage('<script>var Stash = {"common": {}};</script>')).toBeNull();
    expect(parseSearchPage('<script>var Stash = {"broken": </script>')).toBeNull();
  });

  it('is not thrown by braces and quotes inside the data', () => {
    const tricky = pageOf([{ ...advert('x1'), headline: 'Køkken "Nord" {åben} \\ søges' }]);

    expect(parseSearchPage(tricky).ads[0].title).toBe('Køkken "Nord" {åben} \\ søges');
  });
});

describe('toRawAd', () => {
  it('drops an advert with no id or no headline', () => {
    expect(toRawAd({ headline: 'x' })).toBeNull();
    expect(toRawAd({ tid: 'h1' })).toBeNull();
    expect(toRawAd(null)).toBeNull();
  });

  it('only keeps a link that points at Jobindex, since it ends up behind a click', () => {
    expect(toRawAd({ ...advert('h1'), share_url: 'https://evil.example/x' }).url).toBeNull();
    expect(toRawAd({ ...advert('h1'), share_url: 'javascript:alert(1)' }).url).toBeNull();
    expect(toRawAd(advert('h1')).url).toBe('https://www.jobindex.dk/vis-job/h1');
  });

  it('tolerates addresses with nothing in them', () => {
    expect(toRawAd({ ...advert('h1'), addresses: [{}, null] }).addresses).toEqual([
      { zip: null, city: null, lat: null, lng: null },
      { zip: null, city: null, lat: null, lng: null },
    ]);
  });
});

describe('fetchJobPostings', () => {
  const opts = (fetchImpl, extra = {}) => ({
    fetchImpl,
    sleep: vi.fn(async () => {}),
    terms: ['ernæringsassistent'],
    ...extra,
  });

  it('reads every page of a term and each advert once', async () => {
    const pages = {
      1: pageOf([advert('a'), advert('b')], 2),
      2: pageOf([advert('b'), advert('c')], 2),
    };
    const fetchImpl = vi.fn(async (url) => answer(pages[new URL(url).searchParams.get('page') ?? 1]));

    const ads = await fetchJobPostings(opts(fetchImpl));

    expect(ads.map((a) => a.id)).toEqual(['a', 'b', 'c']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain('q=ern%C3%A6ringsassistent');
    expect(fetchImpl.mock.calls[1][0]).toContain('page=2');
  });

  it('identifies itself, and pauses between requests but not before the first', async () => {
    const o = opts(vi.fn(async () => answer(pageOf([advert('a')], 3))));

    await fetchJobPostings(o);

    expect(o.fetchImpl.mock.calls[0][1].headers['User-Agent']).toMatch(/\S/);
    expect(o.sleep).toHaveBeenCalledTimes(2);
    expect(o.sleep).toHaveBeenCalledWith(PAGE_PAUSE_MS);
  });

  it('merges the adverts of several terms', async () => {
    const fetchImpl = vi.fn(async (url) =>
      answer(pageOf(url.includes('kost') ? [advert('k1', 'Kostfaglig')] : [advert('e1')])),
    );

    const ads = await fetchJobPostings(opts(fetchImpl, { terms: ['ernæringsassistent', 'kostfaglig'] }));

    expect(ads.map((a) => a.id)).toEqual(['e1', 'k1']);
  });

  it('stops at the page limit however many pages Jobindex claims', async () => {
    const fetchImpl = vi.fn(async () => answer(pageOf([advert('a')], 500)));

    await fetchJobPostings(opts(fetchImpl));

    expect(fetchImpl).toHaveBeenCalledTimes(MAX_PAGES_PER_TERM);
  });

  it('fails as a whole when one page fails, rather than returning part of the list', async () => {
    const fetchImpl = vi.fn(async (url) =>
      url.includes('page=2') ? answer('', 503) : answer(pageOf([advert('a')], 3)),
    );

    await expect(fetchJobPostings(opts(fetchImpl))).resolves.toBeNull();
  });

  it('fails when a page is not one it recognises', async () => {
    await expect(fetchJobPostings(opts(vi.fn(async () => answer('<html>Access denied</html>'))))).resolves.toBeNull();
  });

  it('fails when the network does', async () => {
    await expect(fetchJobPostings(opts(vi.fn(async () => Promise.reject(new Error('offline')))))).resolves.toBeNull();
  });

  it('treats no adverts at all as a failure, not as an empty country', async () => {
    await expect(fetchJobPostings(opts(vi.fn(async () => answer(pageOf([])))))).resolves.toBeNull();
  });

  it('searches the title families that adverts for the profession are written under', () => {
    expect(JOB_SEARCH_TERMS).toEqual(expect.arrayContaining(['ernæringsassistent', 'køkkenassistent']));
  });
});
