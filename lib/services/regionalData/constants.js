/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Where cached regional data lands on disk, next to the SQLite database. Gitignored (`db/*.json`). */
export const CACHE_DIR = path.join(ROOT, 'db', 'regionalDataCache');

/**
 * DAWA (Danmarks Adressers Web API), run by Styrelsen for Dataforsyning og Infrastruktur on top of
 * the DAGI dataset. Public, unauthenticated, and the modern successor to the raw DAGI WFS - see
 * https://dawadocs.dataforsyningen.dk/dok/api/kommune.
 */
export const DAWA_KOMMUNER_URL = 'https://api.dataforsyningen.dk/kommuner?format=geojson';

/**
 * Free reuse, attribution required - "Vilkår for brug af frie geografiske data"
 * (https://dataforsyningen.dk/Vilkaar). Shown next to the layer toggle.
 */
export const DAWA_ATTRIBUTION = 'Kommunegrænser: Styrelsen for Dataforsyning og Infrastruktur (DAGI)';

/**
 * Kommune polygons come back at cadastral resolution - about 120 MB for all 98 municipalities - which
 * is unusable as a browser payload. Simplified once on the way into the cache; this is the Douglas-
 * Peucker tolerance in degrees, chosen to still tell neighbouring municipalities apart at the zoom
 * level a country-wide choropleth is actually viewed at.
 */
export const KOMMUNE_SIMPLIFY_TOLERANCE = 0.002;

/**
 * Statistics Denmark's Statbank API (api.statbank.dk), table PSKAT ("Kommunal indkomstskat"), rows
 * SKATPCT=KOM (kommuneskat, in percent) and SKATPCT=GRUND (grundskyldspromille). Public, unauthenticated.
 *
 * svmn.dk (Skatteministeriet's satser section) publishes the same figures but only as a yearly Excel
 * download behind an unpredictable, CMS-generated media URL, with grundskyld split off into a
 * separate "Top 20" page that does not cover all 98 municipalities - there is no stable API there.
 * Statbank exposes both rates for every municipality, every year back to 2007, as one clean request.
 */
export const STATBANK_TABLE_URL = 'https://api.statbank.dk/v1/data/PSKAT/CSV';
export const STATBANK_TABLEINFO_URL = 'https://api.statbank.dk/v1/tableinfo/PSKAT?lang=en';

/** Statistics Denmark data is free to reuse; convention is to name the source. */
export const STATBANK_ATTRIBUTION = 'Kommuneskat og grundskyld: Danmarks Statistik (statistikbanken.dk, tabel PSKAT)';

/**
 * Name of the environment variable holding the caller's own STIL API key. Registration is free at
 * https://api.uddannelsesstatistik.dk/GetStarted (Styrelsen for It og Læring) but is per-person and
 * cannot be done on a user's behalf, so the school layer stays off until this is set - see
 * `schoolClient.js` for how that is handled.
 */
export const UDDANNELSESSTATISTIK_API_KEY_ENV = 'UDDANNELSESSTATISTIK_API_KEY';

/** Generic cube query endpoint. One `POST`, the "cube" (område/emne/underemne) named in the body. */
export const UDDANNELSESSTATISTIK_DATA_URL = 'https://api.uddannelsesstatistik.dk/Api/v1/statistik';

export const UDDANNELSESSTATISTIK_ATTRIBUTION =
  'Inklusionsgrad, specialundervisning og karakterer: Børne- og Undervisningsministeriet (uddannelsesstatistik.dk)';

/**
 * STIL's institution register - the one place that says where a school is. The statistics API knows
 * a school only by its institution number (no address, no coordinates in any of its 248 dimensions),
 * and this register uses the same number, so the two join exactly with no name matching.
 *
 * Deliberately the register's own website API rather than a documented one: STIL publishes a
 * web service for the register too, but that one needs a login, while this answers anonymously
 * (the same call the register's public site makes). It is therefore treated as something that can
 * change without notice - `institutionRegisterClient.js` fails to `null`, never throws, and the
 * school layer degrades to empty rather than breaking the map.
 */
export const STIL_INSTITUTION_REGISTER_URL = 'https://institutionsregisteret.stil.dk/frontend-api/Institutions';

export const STIL_REGISTER_ATTRIBUTION =
  'Skolernes placering og type: Institutionsregisteret, Styrelsen for It og Læring';

/**
 * Kommune polygons and tax rates change at most once a year (a new konstituering, a budget vedtaget
 * in October) and are otherwise completely static, so the cache is intentionally long-lived: a
 * restart should not have to wait tens of seconds to re-simplify 98 polygons before the tax layer
 * can be toggled on.
 */
export const KOMMUNE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const TAX_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** School statistics update roughly annually (one school year at a time), a week is plenty fresh. */
export const SCHOOL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A failed upstream fetch is retried on the next request rather than cached as empty for a week. */
export const FAILURE_CACHE_TTL_MS = 5 * 60 * 1000;
