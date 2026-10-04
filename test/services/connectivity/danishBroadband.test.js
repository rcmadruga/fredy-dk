/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import {
  splitCsvLine,
  parseSpeed,
  parseCoordinate,
  readRows,
  findLatestCsvUrl,
  importRows,
  lookupNearest,
  hasDanishBroadbandData,
  readMeta,
  closeStore,
  CELL_METERS,
  MAX_SNAP_METERS,
  SCHEMA_VERSION,
} from '../../../lib/services/connectivity/dk/danishBroadbandData.js';
import { fromEtrs89 } from '../../../lib/services/geo/etrs89.js';
import { normalizeDanish } from '../../../lib/services/connectivity/normalize.js';
import { sourceForCountries } from '../../../lib/services/connectivity/sources.js';

/**
 * The header and three rows are copied from the 2026 file ("BBK26_udbudt private ... inkl. mobil.csv"):
 * fibre only, cable + xDSL with a decimal comma and a `0` for fibre, and all four fixed technologies.
 */
const HEADER =
  '"adgadr_id";"vejnavn";"husnr";"postnr";"kommunenavn";"etrs89koordinat_oest";"etrs89koordinat_nord";"download_fasttraadloest";"upload_fasttraadloest";"download_fiber";"upload_fiber";"download_kabel_tv";"upload_kabel_tv";"download_xdsl";"upload_xdsl";"download_mobil";"upload_mobil"';
const FIBRE_ONLY =
  '"0000af2c-ae73-485e-8718-dcb918021a2a";"Jægergårdsgade";"90A";8000;"Aarhus";"574730,160000000033";"6223215,94000000041";;;"6300";"6300";;;;;"600";"30"';
const CABLE_AND_XDSL =
  '"00d934c2-950b-49e6-a4c5-eab46c724da2";"Søhusvej";"8H";8400;"Syddjurs";"604132,979999999981";"6227239,05999999959";;;"0";"0";"1000";"100";"50,000";"10,240";"600";"30"';
const EVERYTHING =
  '"0001930f-1d1a-42d2-b168-8cd7ff830b87";"Hyldeblomsthaven";"18";4622;"Solrød";"696268,069999999949";"6159507,23000000045";"100";"100";"2500";"2500";"2000";"500";;;"200";"10"';

const tempDirs = [];
function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-broadband-'));
  tempDirs.push(dir);
  return path.join(dir, 'danishBroadband.db');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    closeStore(path.join(dir, 'danishBroadband.db'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function collect(lines) {
  const rows = [];
  for await (const row of readRows(lines)) {
    rows.push(row);
  }
  return rows;
}

describe('services/connectivity/dk/danishBroadbandData', () => {
  describe('parsing', () => {
    it('splits quoted, bare and empty fields', () => {
      expect(splitCsvLine('"a";"b c";;7;"d"')).toEqual(['a', 'b c', '', '7', 'd']);
    });

    it('keeps a semicolon and a doubled quote inside a quoted field', () => {
      expect(splitCsvLine('"x;y";"say ""hi"""')).toEqual(['x;y', 'say "hi"']);
    });

    it('reads the decimal comma and treats zero and empty as not offered', () => {
      expect(parseSpeed('50,000')).toBe(50);
      expect(parseSpeed('7,5')).toBe(7.5);
      expect(parseSpeed('1000')).toBe(1000);
      expect(parseSpeed('0')).toBeNull();
      expect(parseSpeed('')).toBeNull();
      expect(parseSpeed(undefined)).toBeNull();
      expect(parseSpeed('n/a')).toBeNull();
    });

    it('reads a coordinate with a decimal comma, and nothing else as one', () => {
      expect(parseCoordinate('574730,160000000033')).toBeCloseTo(574730.16, 2);
      expect(parseCoordinate('6223215')).toBe(6223215);
      expect(parseCoordinate('')).toBeNull();
      expect(parseCoordinate(undefined)).toBeNull();
      expect(parseCoordinate('n/a')).toBeNull();
    });

    it('turns the lines of the real file into rows', async () => {
      const rows = await collect([HEADER, FIBRE_ONLY, CABLE_AND_XDSL, EVERYTHING, '']);

      expect(rows).toEqual([
        {
          id: '0000af2c-ae73-485e-8718-dcb918021a2a',
          east: 574730.16,
          north: 6223215.94,
          fixedWireless: null,
          fiber: 6300,
          cable: null,
          xdsl: null,
          mobile: 600,
        },
        {
          id: '00d934c2-950b-49e6-a4c5-eab46c724da2',
          east: 604132.98,
          north: 6227239.06,
          fixedWireless: null,
          fiber: null,
          cable: 1000,
          xdsl: 50,
          mobile: 600,
        },
        {
          id: '0001930f-1d1a-42d2-b168-8cd7ff830b87',
          east: 696268.07,
          north: 6159507.23,
          fixedWireless: 100,
          fiber: 2500,
          cable: 2000,
          xdsl: null,
          mobile: 200,
        },
      ]);
    });

    it('survives a byte order mark and moved columns', async () => {
      const reordered =
        '﻿"download_fiber";"etrs89koordinat_nord";"adgadr_id";"download_fasttraadloest";"download_kabel_tv";"download_xdsl";"download_mobil";"etrs89koordinat_oest"';
      const rows = await collect([reordered, '"300";"6000000,5";"abc";;;;"50";"500000,25"']);

      expect(rows).toEqual([
        {
          id: 'abc',
          east: 500000.25,
          north: 6000000.5,
          fixedWireless: null,
          fiber: 300,
          cable: null,
          xdsl: null,
          mobile: 50,
        },
      ]);
    });

    it('passes an address with no position through as null coordinates', async () => {
      const noPosition = FIBRE_ONLY.replace('"574730,160000000033";"6223215,94000000041"', ';');
      const rows = await collect([HEADER, noPosition]);

      expect(rows[0]).toMatchObject({ east: null, north: null, fiber: 6300 });
    });

    it('refuses a file whose layout has changed', async () => {
      await expect(collect(['"adgadr_id";"something_else"', '"a";"b"'])).rejects.toThrow(/unexpected header/);
    });
  });

  describe('finding the file', () => {
    const page = `
      <a href="https://tjekditnet.dk/sites/default/files/2025-06/Udbundt_erhverv_inkl_mobil.csv">old business</a>
      <a href="https://tjekditnet.dk/sites/default/files/2026-06/BBK26_erhverv%20private%20hatigheder%20inkl.%20mobil.csv">business</a>
      <a href="https://tjekditnet.dk/sites/default/files/2026-06/BBK26_Tekniske%20hatigheder%20inkl.%20mobil.csv">possible</a>
      <a href="https://tjekditnet.dk/sites/default/files/2026-06/BBK26_udbudt%20private%20hatigheder%20inkl.%20mobil.csv">offered</a>
      <a href="https://tjekditnet.dk/sites/default/files/2025-06/API%20private%20udbudt.csv">last year</a>
      <a href="https://tjekditnet.dk/sites/default/files/2026-06/restgruppe_1gbit_BBK26.csv">rest group</a>
      <a href="http:///sites/default/files/raadata/bbk23-privat.zip">zip</a>`;

    it('picks the newest offered-speeds file for private homes', () => {
      expect(findLatestCsvUrl(page)).toBe(
        'https://tjekditnet.dk/sites/default/files/2026-06/BBK26_udbudt%20private%20hatigheder%20inkl.%20mobil.csv',
      );
    });

    it('resolves relative links and ignores other hosts', () => {
      const html = `<a href="https://evil.example/2027-01/udbudt-private.csv">x</a>
        <a href="/sites/default/files/2027-06/BBK27_udbudt%20private.csv">y</a>`;

      expect(findLatestCsvUrl(html)).toBe(
        'https://tjekditnet.dk/sites/default/files/2027-06/BBK27_udbudt%20private.csv',
      );
    });

    it('answers null when the page lists no such file', () => {
      expect(findLatestCsvUrl('<html></html>')).toBeNull();
    });
  });

  describe('importing and looking up', () => {
    /** The position of the first real row, as the lat/lng a listing would carry. */
    const AARHUS = { east: 574730.16, north: 6223215.94 };
    const at = (east, north) => fromEtrs89(east, north);
    const row = (east, north, fiber) =>
      `"id-${east}-${north}";"Testvej";"1";8000;"Aarhus";"${String(east).replace('.', ',')}";"${String(north).replace('.', ',')}";;;"${fiber}";"${fiber}";;;;;"100";"10"`;
    const importInto = (dbPath, lines, sourceUrl = 'https://tjekditnet.dk/x.csv') =>
      importRows([HEADER, ...lines], { dbPath, sourceUrl, minRows: 1 });

    it('stores rows and finds the address at a coordinate', async () => {
      const dbPath = tempDbPath();

      const stored = await importInto(dbPath, [FIBRE_ONLY, CABLE_AND_XDSL, EVERYTHING]);

      expect(stored).toBe(3);
      const { lat, lng } = at(AARHUS.east, AARHUS.north);
      expect(lookupNearest(lat, lng, dbPath)).toMatchObject({
        fixedWireless: null,
        fiber: 6300,
        cable: null,
        xdsl: null,
        mobile: 600,
        distanceMeters: expect.any(Number),
      });
      expect(lookupNearest(lat, lng, dbPath).distanceMeters).toBeLessThan(1);
      const søhus = at(604132.98, 6227239.06);
      expect(lookupNearest(søhus.lat, søhus.lng, dbPath)).toMatchObject({ cable: 1000, xdsl: 50 });
      expect(readMeta(dbPath)).toMatchObject({ sourceUrl: 'https://tjekditnet.dk/x.csv' });
    });

    it('does not store an address that has no position', async () => {
      const dbPath = tempDbPath();
      const noPosition = FIBRE_ONLY.replace('"574730,160000000033";"6223215,94000000041"', ';');

      const stored = await importInto(dbPath, [noPosition, CABLE_AND_XDSL]);

      expect(stored).toBe(1);
    });

    it('picks the nearer of two addresses', async () => {
      const dbPath = tempDbPath();
      await importInto(dbPath, [row(574730, 6223215, 100), row(574850, 6223215, 900)]);

      const near = at(574830, 6223215);
      expect(lookupNearest(near.lat, near.lng, dbPath)?.fiber).toBe(900);
      const nearer = at(574760, 6223215);
      expect(lookupNearest(nearer.lat, nearer.lng, dbPath)?.fiber).toBe(100);
    });

    it('finds the nearest address across a cell border', async () => {
      const dbPath = tempDbPath();
      // 574750 is a cell border (250 m grid): the address is in the cell next door to the query.
      const border = Math.ceil(574730 / CELL_METERS) * CELL_METERS;
      await importInto(dbPath, [row(border + 5, 6223215, 700), row(border - 220, 6223215, 111)]);

      const q = at(border - 5, 6223215);
      const hit = lookupNearest(q.lat, q.lng, dbPath);

      expect(hit?.fiber).toBe(700);
      expect(hit?.distanceMeters).toBeCloseTo(10, 0);
    });

    it('widens the search for a far address, and stops at the snapping distance', async () => {
      const dbPath = tempDbPath();
      await importInto(dbPath, [row(574730, 6223215, 100)]);

      const within = at(574730 + MAX_SNAP_METERS - 20, 6223215);
      expect(lookupNearest(within.lat, within.lng, dbPath)?.fiber).toBe(100);
      const beyond = at(574730 + MAX_SNAP_METERS + 50, 6223215);
      expect(lookupNearest(beyond.lat, beyond.lng, dbPath)).toBeNull();
    });

    it('is null for something that is not a coordinate', async () => {
      const dbPath = tempDbPath();
      await importInto(dbPath, [FIBRE_ONLY]);

      expect(lookupNearest(NaN, 10, dbPath)).toBeNull();
      expect(lookupNearest(undefined, undefined, dbPath)).toBeNull();
    });

    it('answers null while nothing has been imported', () => {
      expect(lookupNearest(56.15, 10.2, tempDbPath())).toBeNull();
    });

    it('treats a file written by the first layout, which held no positions, as not imported', async () => {
      const dbPath = tempDbPath();
      const old = new Database(dbPath);
      old.exec(`
        CREATE TABLE address (id TEXT PRIMARY KEY, fixed_wireless REAL, fiber REAL, cable REAL, xdsl REAL, mobile REAL) WITHOUT ROWID;
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO address VALUES ('0000af2c-ae73-485e-8718-dcb918021a2a', NULL, 6300, NULL, NULL, 600);
        INSERT INTO meta VALUES ('source_url', 'https://tjekditnet.dk/old.csv');
      `);
      old.close();

      expect(hasDanishBroadbandData(dbPath)).toBe(false);
      const { lat, lng } = at(AARHUS.east, AARHUS.north);
      expect(lookupNearest(lat, lng, dbPath)).toBeNull();
      expect(readMeta(dbPath)).toBeNull();

      // ...and the next import replaces it with a usable one.
      await importInto(dbPath, [FIBRE_ONLY], 'https://tjekditnet.dk/new.csv');
      expect(hasDanishBroadbandData(dbPath)).toBe(true);
      expect(lookupNearest(lat, lng, dbPath)?.fiber).toBe(6300);
    });

    it('records the layout it was written in', async () => {
      const dbPath = tempDbPath();
      await importInto(dbPath, [FIBRE_ONLY]);

      const db = new Database(dbPath, { readonly: true });
      expect(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value).toBe(SCHEMA_VERSION);
      db.close();
    });

    it('keeps the previous data when a new file is too short', async () => {
      const dbPath = tempDbPath();
      await importInto(dbPath, [FIBRE_ONLY], 'old');

      await expect(importRows([HEADER, CABLE_AND_XDSL], { dbPath, sourceUrl: 'new', minRows: 5 })).rejects.toThrow(
        /only 1 rows/,
      );

      const aarhus = at(AARHUS.east, AARHUS.north);
      expect(lookupNearest(aarhus.lat, aarhus.lng, dbPath)?.fiber).toBe(6300);
      const søhus = at(604132.98, 6227239.06);
      expect(lookupNearest(søhus.lat, søhus.lng, dbPath)).toBeNull();
      expect(readMeta(dbPath)?.sourceUrl).toBe('old');
      expect(fs.existsSync(`${dbPath}.tmp`)).toBe(false);
    });

    it('swaps in a newer file for lookups already in progress', async () => {
      const dbPath = tempDbPath();
      await importInto(dbPath, [FIBRE_ONLY], 'old');
      const aarhus = at(AARHUS.east, AARHUS.north);
      expect(lookupNearest(aarhus.lat, aarhus.lng, dbPath)).not.toBeNull();

      await importInto(dbPath, [CABLE_AND_XDSL], 'new');

      expect(lookupNearest(aarhus.lat, aarhus.lng, dbPath)).toBeNull();
      const søhus = at(604132.98, 6227239.06);
      expect(lookupNearest(søhus.lat, søhus.lng, dbPath)?.cable).toBe(1000);
    });
  });
});

describe('services/connectivity/normalize: normalizeDanish', () => {
  it('reports fibre, its speed, and no share', () => {
    const result = normalizeDanish({
      fixedWireless: null,
      fiber: 6300,
      cable: null,
      xdsl: null,
      mobile: 600,
    });

    expect(result).toMatchObject({
      maxDownMbit: 6300,
      sharePercent: null,
      fiber: true,
      mobile: null,
      source: 'dk-tjekditnet',
    });
    expect(result.technologies.ftthb.maxDownMbit).toBe(6300);
  });

  it('does not call an address fibre for a fibre speed of zero', () => {
    const result = normalizeDanish({ fiber: 0, cable: 1000, xdsl: 50 });

    expect(result.fiber).toBe(false);
    expect(result.technologies.ftthb.maxDownMbit).toBeNull();
    expect(result.technologies.hfc.maxDownMbit).toBe(1000);
    expect(result.technologies.fttc.maxDownMbit).toBe(50);
    expect(result.maxDownMbit).toBe(1000);
  });

  it('counts fixed wireless towards the headline but not towards a bucket', () => {
    const result = normalizeDanish({ fixedWireless: 100 });

    expect(result.maxDownMbit).toBe(100);
    expect(result.fiber).toBe(false);
    expect(Object.values(result.technologies).every((tech) => tech.maxDownMbit == null)).toBe(true);
  });

  it('answers null for an address the file does not list', () => {
    expect(normalizeDanish(null)).toBeNull();
  });
});

describe('services/connectivity/sources: Denmark', () => {
  it('has a register for a Danish listing', () => {
    expect(sourceForCountries(['dk'])?.id).toBe('dk-tjekditnet');
  });
});
