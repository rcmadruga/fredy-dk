/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Danica Ejendomme, the property arm of Danica Pension, which rents out 2,700+ homes in Copenhagen,
 * Aarhus and Odense. Customers of Danica Pension have priority for them (savings of at least 200,000 kr
 * or contributions of at least 25,000 kr a year, through a waiting list), which is the reason to watch
 * this landlord for someone who is one: a vacancy here is offered to them first.
 *
 * The marketing site, danicaejendomme.dk, is not where the vacancies are. They are on
 * bolig.danicaejendomme.dk, an AngularJS page whose search POSTs JSON to the portal's own API:
 *
 *   POST /api/admin/Property/list/
 *   {"page": {"PageNo": 1, "PageSize": 100, "Criteria": {...}}, "pStatus": "Til leje", "pType": "Lejebolig", "pArea": ""}
 *
 * `pStatus` `Til leje` is a home that is vacant now; `Udlejet` is a home that is let, which is how the
 * portal lists the complexes a waiting list is for. This reads only the vacant ones. The API answers a
 * bare request - no login, no challenge - and is the same call the page makes.
 *
 * Etiquette: the landlord's robots.txt sets `Crawl-delay: 5`, which is honoured between pages; a search
 * is one request unless the portal ever lists more than a page of vacancies, and Danica has a handful at
 * a time. The site's terms let a visitor read and print for private use and ask for written consent to
 * copy or store content; they say nothing about bots. Reading a few vacancies once per job run for a
 * customer of the landlord is the mildest case there is, but the data is stored in Fredy's database, which
 * is the part those terms speak to.
 *
 * The search URL is the portal's own page, so it can be copied from the browser:
 *
 *   https://bolig.danicaejendomme.dk/hjem/findbolig?search=amager
 *
 * `search` is the free-text box (`SearchText`). `area` is the portal's area filter, passed on as `pArea`.
 * Nothing else is a filter here: the job's own price, rooms and size filters do the rest, as for Lejebolig.
 *
 * What a vacancy carries: the case number, a name, the address in parts, `GpsCoordinates` ("lat lon"),
 * `MonthlyRent`, `Area`, `RoomCount`, `PensionFund` (who has priority), `Reserved`, and fields for the
 * deposit, the utilities on account and the date it is free. The last three were empty on every vacancy
 * seen, so they are read when present and nothing is claimed when they are not. There is no image URL in
 * the response that works (every guess redirects), so a listing has none.
 */

import { buildHash, isOneOf, sleep } from '../utils.js';
import { selfHostedUserAgent } from '../services/userAgent.js';
import { buildRentalTerms, parseAvailabilityText } from '../services/rental/rentalTerms.js';
import logger from '../services/logger.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://bolig.danicaejendomme.dk/';
const LIST_ENDPOINT = 'https://bolig.danicaejendomme.dk/api/admin/Property/list/';

/** Vacancies asked for per request. Danica has a handful at a time; this is far above that. */
const PAGE_SIZE = 100;

/** The most pages read in one run, in case the portal ever lists far more than it does. */
const MAX_PAGES = 3;

/** The landlord's `Crawl-delay`, in milliseconds, between two requests. */
const CRAWL_DELAY_MS = 5000;

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function toNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The search the job URL asks for.
 *
 * @param {string} url
 * @returns {{search: string, area: string}|null} `null` when the URL cannot be read.
 */
function criteriaFrom(url) {
  try {
    const params = new URL(url).searchParams;
    return { search: params.get('search') ?? '', area: params.get('area') ?? '' };
  } catch {
    return null;
  }
}

/**
 * Asks the portal for one page of vacant homes.
 *
 * @param {{search: string, area: string}} criteria
 * @param {number} pageNo
 * @returns {Promise<{list: Object[], total: number}|null>} `null` on any failure.
 */
async function fetchPage(criteria, pageNo) {
  const response = await fetch(LIST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${BASE_URL}hjem/findbolig?search=`,
      'User-Agent': selfHostedUserAgent,
    },
    body: JSON.stringify({
      page: {
        PageNo: pageNo,
        PageSize: PAGE_SIZE,
        Criteria: { SearchText: criteria.search, SearchPType: 'Lejebolig', SearchPArea: criteria.area },
      },
      pStatus: 'Til leje',
      pType: 'Lejebolig',
      pArea: criteria.area,
    }),
  });
  if (!response.ok) {
    logger.error(`Error fetching vacancies from Danica Ejendomme: ${response.status} ${response.statusText}`);
    return null;
  }
  const body = await response.json();
  if (body?.IsError === true || !Array.isArray(body?.Data?.List)) {
    logger.error(`Danica Ejendomme answered with an error: ${body?.Message ?? 'no list in the answer'}`);
    return null;
  }
  return { list: body.Data.List, total: toNumber(body.Data.PageInfo?.TotalRecords) ?? body.Data.List.length };
}

/**
 * All vacant homes the search matches.
 *
 * @param {string} url the job's search URL
 * @returns {Promise<Object[]>}
 */
async function getListings(url) {
  const criteria = criteriaFrom(url);
  if (criteria == null) {
    logger.error(`Could not read the Danica Ejendomme search URL: ${url}`);
    return [];
  }

  const all = [];
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    if (pageNo > 1) await sleep(CRAWL_DELAY_MS);
    const page = await fetchPage(criteria, pageNo);
    if (page == null) return pageNo === 1 ? [] : all;
    all.push(...page.list);
    if (all.length >= page.total || page.list.length === 0) break;
  }
  return all;
}

/**
 * The address the way Danish ones are written: street, floor, postcode and town.
 *
 * @param {Object} o
 * @returns {string|null}
 */
function buildAddress(o) {
  const street = [o.Road, o.HouseNo].filter(Boolean).join(' ');
  const floor = typeof o.Floor === 'string' && o.Floor.trim() !== '' ? o.Floor.trim() : null;
  const town = [o.ZipCode, o.City].filter(Boolean).join(' ');
  const full = [street, floor, town].filter((part) => part != null && String(part).trim() !== '').join(', ');
  return full === '' ? null : full;
}

/**
 * `GpsCoordinates` is one string, `"55.6452395056938 12.5479174049529"`: latitude, then longitude.
 *
 * @param {unknown} value
 * @returns {{latitude: number, longitude: number}|null}
 */
function readCoordinates(value) {
  if (typeof value !== 'string') return null;
  const [lat, lng] = value.trim().split(/\s+/).map(Number);
  // Denmark is 54-58 N, 8-16 E; anything else is another kind of number, not a position.
  return Number.isFinite(lat) && Number.isFinite(lng) && lat > 54 && lat < 58 && lng > 7 && lng < 16
    ? { latitude: lat, longitude: lng }
    : null;
}

/**
 * The monthly utilities charged on account, where the portal states any.
 *
 * @param {Object} o
 * @returns {number|null}
 */
function utilitiesOf(o) {
  const parts = [o.AccountHeat, o.AccountWater, o.AccountOperating].map(toNumber).filter((n) => n != null && n > 0);
  return parts.length === 0 ? null : parts.reduce((a, b) => a + b, 0);
}

/**
 * @param {Object} o One vacancy of the portal's list.
 * @returns {ParsedListing}
 */
function normalize(o) {
  const rent = toNumber(o.MonthlyRent);
  const position = readCoordinates(o.GpsCoordinates);
  const months = toNumber(o.DepositMonths);
  const deposit = toNumber(o.Deposit) ?? (months != null && rent != null ? months * rent : null);
  const address = buildAddress(o);

  return {
    // The rent goes into the hash like everywhere else, so a change reaches the user as a new listing.
    id: buildHash(String(o.CaseNo), rent == null ? null : String(rent)),
    title: o.CaseName || address || '',
    // Some homes are let through EDC, which has its own page for them; the rest have the portal's.
    link:
      typeof o.PresentationUrl === 'string' && /^https:\/\//.test(o.PresentationUrl)
        ? o.PresentationUrl
        : `${BASE_URL}hjem/ejendomsdetaljer?sagsnummer=${encodeURIComponent(o.CaseNo)}`,
    price: rent,
    size: toNumber(o.Area),
    rooms: toNumber(o.RoomCount),
    address,
    description: [o.AnnounceTextInternet, o.AnnounceText15].find(
      (text) => typeof text === 'string' && text.trim() !== '',
    ),
    ...(position ?? {}),
    ...buildRentalTerms({
      rent,
      extraCosts: utilitiesOf(o),
      deposit,
      // "Snarest muligt" on most adverts, a date on a few.
      ...parseAvailabilityText(typeof o.AvailableDate === 'string' ? o.AvailableDate : null),
      priority: o.PensionFund,
    }),
  };
}

/**
 * A home somebody has reserved is not available to the user whatever its status says, so it is left
 * out. It is not stored, so it arrives as new if the reservation falls through.
 *
 * @param {Object} raw
 * @returns {boolean}
 */
function isOpen(raw) {
  return raw?.Reserved !== true;
}

/**
 * @param {ParsedListing} o
 * @param {string[]} appliedBlackList
 * @returns {boolean}
 */
function applyBlacklist(o, appliedBlackList) {
  return (
    o.title != null &&
    !isOneOf(o.title, appliedBlackList) &&
    !isOneOf(o.address, appliedBlackList) &&
    !isOneOf(o.description, appliedBlackList)
  );
}

/** @type {ProviderConfig} */
const config = {
  url: null,
  requiredFieldNames: ['id', 'title', 'link', 'price', 'size', 'rooms', 'address'],
  crawlContainer: null,
  crawlFields: {},
  // The list comes in the portal's own order and is short; there is nothing to sort by.
  sortByDateParam: null,
  priceRangeParams: null,
  getListings: async (url) => (await getListings(url)).filter(isOpen),
  normalize,
};

export const metaInformation = {
  countries: ['dk'],
  currency: 'DKK',
  name: 'Danica Ejendomme',
  baseUrl: BASE_URL,
  id: 'danicaejendomme',
};

/**
 * Build a run-scoped provider configuration.
 *
 * @param {{url: string, enabled?: boolean}} sourceConfig
 * @param {string[]} [blacklist]
 * @returns {ProviderConfig}
 */
export const createConfig = (sourceConfig, blacklist = []) => ({
  ...config,
  enabled: sourceConfig.enabled,
  url: sourceConfig.url,
  filter: (listing) => applyBlacklist(listing, blacklist ?? []),
});

export { config };
