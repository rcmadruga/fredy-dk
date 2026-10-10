/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import fetch from 'node-fetch';
import logger from '../../logger.js';
import { toEtrs89 } from '../../geo/etrs89.js';
import { selfHostedUserAgent } from '../../userAgent.js';

/**
 * The Danish address-level broadband file, kept in a SQLite file of its own.
 *
 * Digitaliseringsstyrelsen publishes, on tjekditnet.dk/dataudtræk and free of charge (CC0), a CSV
 * with the highest speed each technology is offered at for every access address in the country.
 * That is the same data the site's API answers from, minus the provider names, and it is the
 * intended way to get at it in bulk - the API is for single lookups and needs a `uid` by email.
 *
 * The file also carries every address's position (ETRS89 / UTM 32, metres), and that is the lookup
 * key: a listing's coordinate is matched to the nearest address in the file, locally. It used to be
 * matched through DAWA's reverse geocoder, which was shut down in October 2026, so the importer now
 * keeps the position and drops the address id, which nothing asks for any more.
 *
 * About 2.5 million rows and 380 MB as text, so it is streamed into a separate database rather than
 * the main one: it would dwarf `listings.db` and its backups, and a refresh is "build a new file,
 * swap it in" rather than a migration. The file is refreshed once a year when the ministry
 * publishes the next one (the 2026 set is dated June), which is why nothing here runs on a
 * schedule: it is started by the first lookup that finds it missing or out of date.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Next to the SQLite database, and gitignored with it (`db/*.db*`). */
export const DEFAULT_DB_PATH = path.join(ROOT, 'db', 'danishBroadband.db');

/** The page that lists the downloads. */
export const DOWNLOADS_PAGE_URL = 'https://tjekditnet.dk/dataudtr%C3%A6k';

/**
 * Fewer rows than this and the download was cut short or is not the file it was taken for. The real
 * file has millions; keeping the old data is better than swapping in a fragment.
 */
export const MIN_ROWS = 100_000;

/**
 * The layout of the stored file. Raised whenever the table changes shape; a file written by an
 * earlier layout is treated as absent, which is what makes the next lookup import it afresh. The
 * first layout (1) was keyed by DAWA's address id and held no positions.
 */
export const SCHEMA_VERSION = '2';

/** Side of the grid cells addresses are bucketed into, in metres. */
export const CELL_METERS = 250;

/**
 * How far from the listing the nearest address may be. A listing geocoded to a street is within a few
 * tens of metres of an address; a farm may be a few hundred. Beyond this the answer is "nothing known
 * here" rather than a neighbour's connection.
 */
export const MAX_SNAP_METERS = 500;

/** Cell rings searched: enough to cover {@link MAX_SNAP_METERS} from anywhere inside a cell. */
const MAX_RING = Math.ceil(MAX_SNAP_METERS / CELL_METERS) + 1;

/** Multiplier that keeps a cell's two indices in one integer: `cell = cx * CELL_STRIDE + cy`. */
const CELL_STRIDE = 100_000;

/** How often a stored file is compared with what the page currently offers. */
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;

/** How long a failed download or check is left alone before the next attempt. */
const RETRY_INTERVAL = 6 * 60 * 60 * 1000;

const BATCH_SIZE = 20_000;

/**
 * The columns of the file that are kept, by header name. Uploads and the address text are not needed:
 * the lookup key is the position.
 */
const COLUMNS = {
  east: 'etrs89koordinat_oest',
  north: 'etrs89koordinat_nord',
  fixedWireless: 'download_fasttraadloest',
  fiber: 'download_fiber',
  cable: 'download_kabel_tv',
  xdsl: 'download_xdsl',
  mobile: 'download_mobil',
};

/**
 * Splits one line of the file. Fields are semicolon-separated and usually quoted, a quote inside a
 * quoted field is doubled, and an empty field is bare (`;;`).
 *
 * @param {string} line
 * @returns {string[]}
 */
export function splitCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ';') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Reads a speed as the file writes it: a decimal comma, sometimes trailing zeros (`50,000`), and
 * empty or `0` for a technology nobody sells at the address.
 *
 * @param {string|undefined} raw
 * @returns {number|null} `null` for empty, zero or anything that is not a positive number.
 */
export function parseSpeed(raw) {
  if (raw == null || raw === '') {
    return null;
  }
  const value = Number(String(raw).replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Reads a coordinate as the file writes it: a decimal comma (`574730,160000000033`).
 *
 * @param {string|undefined} raw
 * @returns {number|null} `null` for empty or anything that is not a number.
 */
export function parseCoordinate(raw) {
  if (raw == null || raw === '') {
    return null;
  }
  const value = Number(String(raw).replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * The grid cell a position lies in.
 *
 * @param {number} east Metres, EPSG:25832.
 * @param {number} north
 * @returns {number}
 */
function cellOf(east, north) {
  return Math.floor(east / CELL_METERS) * CELL_STRIDE + Math.floor(north / CELL_METERS);
}

/**
 * Turns the lines of the file into rows.
 *
 * @param {AsyncIterable<string>|Iterable<string>} lines Including the header line.
 * @returns {AsyncGenerator<{id: string, east: number|null, north: number|null, fixedWireless: number|null, fiber: number|null, cable: number|null, xdsl: number|null, mobile: number|null}>}
 * @throws {Error} When the header lacks the id or a speed column - a changed layout has to fail the
 * import, not store rows of nothing.
 */
export async function* readRows(lines) {
  let index = null;

  for await (const rawLine of lines) {
    if (index == null) {
      const header = splitCsvLine(rawLine.replace(/^﻿/, '')).map((name) => name.trim());
      const positions = { id: header.indexOf('adgadr_id') };
      for (const [key, name] of Object.entries(COLUMNS)) {
        positions[key] = header.indexOf(name);
      }
      const missing = Object.entries(positions).filter(([, position]) => position < 0);
      if (missing.length > 0) {
        throw new Error(`Danish broadband file has an unexpected header, missing: ${missing.map(([k]) => k)}`);
      }
      index = positions;
      continue;
    }

    if (rawLine.trim() === '') {
      continue;
    }
    const fields = splitCsvLine(rawLine);
    const id = fields[index.id];
    if (!id) {
      continue;
    }
    yield {
      id,
      east: parseCoordinate(fields[index.east]),
      north: parseCoordinate(fields[index.north]),
      fixedWireless: parseSpeed(fields[index.fixedWireless]),
      fiber: parseSpeed(fields[index.fiber]),
      cable: parseSpeed(fields[index.cable]),
      xdsl: parseSpeed(fields[index.xdsl]),
      mobile: parseSpeed(fields[index.mobile]),
    };
  }
}

/**
 * Picks the current private "offered speeds" file out of the downloads page.
 *
 * The page carries several CSVs in the same folder: offered and technically possible speeds, private
 * and business, and older years' (`2025-06/...`). The newest folder wins, and the name has to say
 * `udbudt` and `priv` and not `erhverv` - the 2026 set also has a file called "erhverv private
 * hatigheder", which is the business one.
 *
 * @param {string} html
 * @returns {string|null} Absolute URL, or `null` when the page lists no such file.
 */
export function findLatestCsvUrl(html) {
  const candidates = [];

  for (const match of String(html).matchAll(/href="([^"]+\.csv)"/gi)) {
    let url;
    try {
      url = new URL(match[1], DOWNLOADS_PAGE_URL);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'tjekditnet.dk') {
      continue;
    }
    const name = decodeURIComponent(url.pathname).toLowerCase();
    const folder = name.match(/\/(\d{4}-\d{2})\//)?.[1];
    if (folder == null || !name.includes('udbudt') || !name.includes('priv') || name.includes('erhverv')) {
      continue;
    }
    candidates.push({ url: url.href, folder });
  }

  candidates.sort((a, b) => b.folder.localeCompare(a.folder));
  return candidates[0]?.url ?? null;
}

/**
 * Builds a fresh database from rows and swaps it in for the old one.
 *
 * Written to a temporary file first, so a failed or truncated import leaves the previous data in
 * place, and renamed over the target only once it has passed the row-count check.
 *
 * @param {AsyncIterable<string>|Iterable<string>} lines
 * @param {Object} options
 * @param {string} options.dbPath
 * @param {string} options.sourceUrl Recorded, so the next update check can tell whether the page offers anything newer.
 * @param {number} [options.minRows]
 * @returns {Promise<number>} Rows stored.
 */
export async function importRows(lines, { dbPath, sourceUrl, minRows = MIN_ROWS }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const tmpPath = `${dbPath}.tmp`;
  fs.rmSync(tmpPath, { force: true });

  const db = new Database(tmpPath);
  let stored = 0;

  try {
    // Nothing here needs to survive a crash: the file is thrown away if the import does not finish.
    db.pragma('journal_mode = OFF');
    db.pragma('synchronous = OFF');
    db.exec(`
      CREATE TABLE address (
        cell INTEGER NOT NULL,
        east_dm INTEGER NOT NULL,
        north_dm INTEGER NOT NULL,
        fixed_wireless REAL, fiber REAL, cable REAL, xdsl REAL, mobile REAL
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    // Positions are stored in decimetres: 10 cm is far finer than any listing's geocode, and an
    // integer is half the size of the float the file writes.
    const insert = db.prepare(
      'INSERT INTO address VALUES (@cell, @eastDm, @northDm, @fixedWireless, @fiber, @cable, @xdsl, @mobile)',
    );
    const insertBatch = db.transaction((batch) => {
      for (const row of batch) {
        insert.run({
          cell: cellOf(row.east, row.north),
          eastDm: Math.round(row.east * 10),
          northDm: Math.round(row.north * 10),
          fixedWireless: row.fixedWireless,
          fiber: row.fiber,
          cable: row.cable,
          xdsl: row.xdsl,
          mobile: row.mobile,
        });
      }
    });

    let batch = [];
    for await (const row of readRows(lines)) {
      // An address without a position cannot be found by one, so it is not worth a row.
      if (row.east == null || row.north == null) {
        continue;
      }
      batch.push(row);
      if (batch.length >= BATCH_SIZE) {
        insertBatch(batch);
        stored += batch.length;
        batch = [];
      }
    }
    insertBatch(batch);
    stored += batch.length;

    if (stored < minRows) {
      throw new Error(`Danish broadband file held only ${stored} rows, expected at least ${minRows}`);
    }

    // Built after the load: one sort instead of 2.5 million index insertions.
    db.exec('CREATE INDEX address_cell ON address (cell)');

    const setMeta = db.prepare('INSERT INTO meta VALUES (?, ?)');
    setMeta.run('schema_version', SCHEMA_VERSION);
    setMeta.run('source_url', sourceUrl);
    setMeta.run('imported_at', String(Date.now()));
    setMeta.run('rows', String(stored));
    db.close();
  } catch (error) {
    try {
      db.close();
    } catch {
      // Already closed or never opened; the original error is the one worth reporting.
    }
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }

  closeStore(dbPath);
  reportedOutdated.delete(dbPath);
  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
  fs.renameSync(tmpPath, dbPath);
  return stored;
}

/** @type {Map<string, {db: import('better-sqlite3').Database, ring: import('better-sqlite3').Statement[]}>} */
const open = new Map();

/** Files already reported as written by an earlier layout, so the log says it once rather than per lookup. */
const reportedOutdated = new Set();

/**
 * The statement that reads every row in the square of cells `radius` rings around a cell: one range
 * per column of cells, `cell BETWEEN x*STRIDE + y-r AND x*STRIDE + y+r`.
 */
function prepareRing(db, radius) {
  const columns = 2 * radius + 1;
  const ranges = Array.from({ length: columns }, () => '(cell BETWEEN ? AND ?)').join(' OR ');
  return db.prepare(
    `SELECT east_dm, north_dm, fixed_wireless, fiber, cable, xdsl, mobile FROM address WHERE ${ranges}`,
  );
}

function openStore(dbPath) {
  const existing = open.get(dbPath);
  if (existing) {
    return existing;
  }
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    let version = null;
    try {
      version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value ?? null;
    } catch {
      // No meta table at all: older than the layouts that have a version.
    }
    if (version !== SCHEMA_VERSION) {
      db.close();
      if (!reportedOutdated.has(dbPath)) {
        reportedOutdated.add(dbPath);
        logger.info('The stored Danish broadband file has an older layout (no positions) and will be imported again.');
      }
      return null;
    }
    const store = { db, ring: Array.from({ length: MAX_RING + 1 }, (_, r) => (r === 0 ? null : prepareRing(db, r))) };
    open.set(dbPath, store);
    return store;
  } catch (error) {
    logger.warn('Could not open the Danish broadband database', error);
    return null;
  }
}

/**
 * Drops the cached read handle, so the next lookup opens whatever file is there now.
 *
 * @param {string} [dbPath]
 * @returns {void}
 */
export function closeStore(dbPath = DEFAULT_DB_PATH) {
  const store = open.get(dbPath);
  if (store) {
    try {
      store.db.close();
    } catch {
      // Nothing useful to do about a handle that will not close; it is dropped either way.
    }
    open.delete(dbPath);
  }
}

/**
 * Whether the file has been imported.
 *
 * @param {string} [dbPath]
 * @returns {boolean}
 */
export function hasDanishBroadbandData(dbPath = DEFAULT_DB_PATH) {
  return openStore(dbPath) != null;
}

/**
 * The speeds offered at the address nearest to a coordinate.
 *
 * Searches the grid cell the point lies in and the rings around it, widening only while a closer
 * address could still be outside what has been read, and gives up beyond {@link MAX_SNAP_METERS}.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} [dbPath]
 * @returns {{fixedWireless: number|null, fiber: number|null, cable: number|null, xdsl: number|null, mobile: number|null, distanceMeters: number}|null}
 * `null` when no address is within range, the point is not a coordinate, or the file has not been
 * imported (or is of an older layout).
 */
export function lookupNearest(lat, lng, dbPath = DEFAULT_DB_PATH) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const store = openStore(dbPath);
  if (store == null) {
    return null;
  }

  const { east, north } = toEtrs89(lat, lng);
  const cx = Math.floor(east / CELL_METERS);
  const cy = Math.floor(north / CELL_METERS);
  const eastDm = east * 10;
  const northDm = north * 10;

  let best = null;
  for (let radius = 1; radius <= MAX_RING; radius++) {
    const params = [];
    for (let x = cx - radius; x <= cx + radius; x++) {
      params.push(x * CELL_STRIDE + cy - radius, x * CELL_STRIDE + cy + radius);
    }
    best = null;
    for (const row of store.ring[radius].all(...params)) {
      const d = Math.hypot(row.east_dm - eastDm, row.north_dm - northDm) / 10;
      if (best == null || d < best.distanceMeters) {
        best = { row, distanceMeters: d };
      }
    }
    // Anything outside the square is at least `radius` cells away, so a hit closer than that is final.
    if (best != null && best.distanceMeters <= radius * CELL_METERS) {
      break;
    }
  }

  if (best == null || best.distanceMeters > MAX_SNAP_METERS) {
    return null;
  }
  const { row } = best;
  return {
    fixedWireless: row.fixed_wireless,
    fiber: row.fiber,
    cable: row.cable,
    xdsl: row.xdsl,
    mobile: row.mobile,
    distanceMeters: Math.round(best.distanceMeters * 10) / 10,
  };
}

/**
 * What the stored file was built from.
 *
 * @param {string} [dbPath]
 * @returns {{sourceUrl: string|null, importedAt: number|null}|null} `null` without a file.
 */
export function readMeta(dbPath = DEFAULT_DB_PATH) {
  const store = openStore(dbPath);
  if (store == null) {
    return null;
  }
  try {
    const get = (key) => store.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
    const importedAt = Number(get('imported_at'));
    return {
      sourceUrl: get('source_url'),
      importedAt: Number.isFinite(importedAt) ? importedAt : null,
    };
  } catch {
    return null;
  }
}

async function findCurrentUrl() {
  const response = await fetch(DOWNLOADS_PAGE_URL, {
    signal: AbortSignal.timeout(30_000),
    headers: { 'User-Agent': selfHostedUserAgent },
  });
  if (!response.ok) {
    throw new Error(`tjekditnet.dk/dataudtræk responded with ${response.status}`);
  }
  const url = findLatestCsvUrl(await response.text());
  if (url == null) {
    throw new Error('tjekditnet.dk/dataudtræk lists no offered-speeds file any more');
  }
  return url;
}

async function download(url, dbPath) {
  const response = await fetch(url, {
    // The file is 380 MB; half an hour is generous and still ends a stalled connection.
    signal: AbortSignal.timeout(30 * 60 * 1000),
    headers: { 'User-Agent': selfHostedUserAgent },
  });
  if (!response.ok || response.body == null) {
    throw new Error(`${url} responded with ${response.status}`);
  }
  const lines = readline.createInterface({
    input: response.body,
    crlfDelay: Infinity,
  });
  return importRows(lines, { dbPath, sourceUrl: url });
}

/** @type {Promise<void>|null} */
let running = null;
let lastCheck = 0;
let lastFailure = 0;

/**
 * Makes sure the file is there and current, without making the caller wait for it.
 *
 * Starts an import in the background when nothing is stored, and - at most once a day - compares
 * the stored file with what the downloads page offers, importing again when a newer one is up.
 * Idempotent and cheap, so the lookup path can call it every time. Failures are logged and retried
 * after a few hours; they never throw.
 *
 * @param {Object} [options]
 * @param {string} [options.dbPath]
 * @param {number} [options.now]
 * @returns {Promise<void>|null} The import in progress, if there is one (used by the tests).
 */
export function ensureDanishBroadbandData({ dbPath = DEFAULT_DB_PATH, now = Date.now() } = {}) {
  if (running != null) {
    return running;
  }
  if (now - lastFailure < RETRY_INTERVAL && lastFailure > 0) {
    return null;
  }

  const stored = hasDanishBroadbandData(dbPath);
  if (stored && now - lastCheck < UPDATE_CHECK_INTERVAL) {
    return null;
  }
  lastCheck = now;

  running = (async () => {
    try {
      const url = await findCurrentUrl();
      if (stored && readMeta(dbPath)?.sourceUrl === url) {
        return;
      }
      logger.info(`Importing the Danish broadband file from ${url}. This is about 380 MB and takes a few minutes.`);
      const rows = await download(url, dbPath);
      logger.info(`Danish broadband file imported: ${rows} addresses.`);
    } catch (error) {
      lastFailure = now;
      logger.warn('Danish broadband file could not be imported', error);
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * Forgets the update checks and failures. Only used by the tests.
 *
 * @returns {void}
 */
export function resetDanishBroadbandData() {
  running = null;
  lastCheck = 0;
  lastFailure = 0;
}
