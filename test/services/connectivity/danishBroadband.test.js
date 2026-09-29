/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  splitCsvLine,
  parseSpeed,
  readRows,
  findLatestCsvUrl,
  importRows,
  lookupAddress,
  readMeta,
  closeStore,
} from '../../../lib/services/connectivity/dk/danishBroadbandData.js';
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

    it('turns the lines of the real file into rows', async () => {
      const rows = await collect([HEADER, FIBRE_ONLY, CABLE_AND_XDSL, EVERYTHING, '']);

      expect(rows).toEqual([
        {
          id: '0000af2c-ae73-485e-8718-dcb918021a2a',
          fixedWireless: null,
          fiber: 6300,
          cable: null,
          xdsl: null,
          mobile: 600,
        },
        {
          id: '00d934c2-950b-49e6-a4c5-eab46c724da2',
          fixedWireless: null,
          fiber: null,
          cable: 1000,
          xdsl: 50,
          mobile: 600,
        },
        {
          id: '0001930f-1d1a-42d2-b168-8cd7ff830b87',
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
        '﻿"download_fiber";"adgadr_id";"download_fasttraadloest";"download_kabel_tv";"download_xdsl";"download_mobil"';
      const rows = await collect([reordered, '"300";"abc";;;;"50"']);

      expect(rows).toEqual([
        {
          id: 'abc',
          fixedWireless: null,
          fiber: 300,
          cable: null,
          xdsl: null,
          mobile: 50,
        },
      ]);
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
    it('stores rows and answers by address id, case-insensitively', async () => {
      const dbPath = tempDbPath();

      const stored = await importRows([HEADER, FIBRE_ONLY, CABLE_AND_XDSL, EVERYTHING], {
        dbPath,
        sourceUrl: 'https://tjekditnet.dk/x.csv',
        minRows: 1,
      });

      expect(stored).toBe(3);
      expect(lookupAddress('00D934C2-950B-49E6-A4C5-EAB46C724DA2', dbPath)).toEqual({
        fixedWireless: null,
        fiber: null,
        cable: 1000,
        xdsl: 50,
        mobile: 600,
      });
      expect(lookupAddress('not-an-address', dbPath)).toBeNull();
      expect(readMeta(dbPath)).toMatchObject({
        sourceUrl: 'https://tjekditnet.dk/x.csv',
      });
    });

    it('answers null while nothing has been imported', () => {
      expect(lookupAddress('anything', tempDbPath())).toBeNull();
    });

    it('keeps the previous data when a new file is too short', async () => {
      const dbPath = tempDbPath();
      await importRows([HEADER, FIBRE_ONLY], {
        dbPath,
        sourceUrl: 'old',
        minRows: 1,
      });

      await expect(
        importRows([HEADER, CABLE_AND_XDSL], {
          dbPath,
          sourceUrl: 'new',
          minRows: 5,
        }),
      ).rejects.toThrow(/only 1 rows/);

      expect(lookupAddress('0000af2c-ae73-485e-8718-dcb918021a2a', dbPath)?.fiber).toBe(6300);
      expect(lookupAddress('00d934c2-950b-49e6-a4c5-eab46c724da2', dbPath)).toBeNull();
      expect(readMeta(dbPath)?.sourceUrl).toBe('old');
      expect(fs.existsSync(`${dbPath}.tmp`)).toBe(false);
    });

    it('swaps in a newer file for lookups already in progress', async () => {
      const dbPath = tempDbPath();
      await importRows([HEADER, FIBRE_ONLY], {
        dbPath,
        sourceUrl: 'old',
        minRows: 1,
      });
      expect(lookupAddress('0000af2c-ae73-485e-8718-dcb918021a2a', dbPath)).not.toBeNull();

      await importRows([HEADER, CABLE_AND_XDSL], {
        dbPath,
        sourceUrl: 'new',
        minRows: 1,
      });

      expect(lookupAddress('0000af2c-ae73-485e-8718-dcb918021a2a', dbPath)).toBeNull();
      expect(lookupAddress('00d934c2-950b-49e6-a4c5-eab46c724da2', dbPath)?.cable).toBe(1000);
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
