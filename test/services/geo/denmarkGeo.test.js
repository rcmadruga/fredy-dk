/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import {
  findPostcodesByName,
  getGeoAttribution,
  getKommunePolygons,
  kommuneByCode,
  kommuneByName,
  kommuneOfPoint,
  kommuneOfPostcode,
  normalizePlaceName,
  postcodeInfo,
  resolvePlace,
} from '../../../lib/services/geo/denmarkGeo.js';

describe('the bundled boundaries', () => {
  it('holds the 98 kommuner, four-digit codes, and not Christiansø', () => {
    const kommuner = getKommunePolygons();

    expect(kommuner).toHaveLength(98);
    expect(new Set(kommuner.map((k) => k.code)).size).toBe(98);
    expect(kommuner.every((k) => /^\d{4}$/.test(k.code))).toBe(true);
    expect(kommuner.map((k) => k.code)).not.toContain('0411');
    expect(kommuner.every((k) => ['Polygon', 'MultiPolygon'].includes(k.geometry.type))).toBe(true);
  });

  it('survives the JSON round trip the disk cache puts it through', () => {
    const kommuner = getKommunePolygons();

    expect(JSON.parse(JSON.stringify(kommuner))).toEqual(kommuner);
  });

  it('places every postcode in a kommune that exists, with a position inside Denmark', () => {
    const bad = [];
    for (let n = 800; n <= 9999; n++) {
      const p = postcodeInfo(n);
      if (!p) continue;
      const known = p.kommuner.every((k) => kommuneByCode(k.code));
      const inDenmark = p.lat > 54.4 && p.lat < 57.9 && p.lng > 8 && p.lng < 15.3;
      // Greenland and the Faroes (3xxx, 8xx) are not in the DAGI file; anything that is must be Danish.
      if (!known || !inDenmark || !p.kommuner.length) bad.push(p.zip);
    }

    expect(bad).toEqual([]);
  });

  it('carries an attribution', () => {
    expect(getGeoAttribution()).toMatch(/Klimadatastyrelsen/);
  });
});

describe('kommuneOfPoint', () => {
  it.each([
    ['Rådhuspladsen', 55.6761, 12.57, '0101', 'København'],
    ['Aarhus Rådhus', 56.1535, 10.204, '0751', 'Aarhus'],
    ['Rønne', 55.1, 14.7, '0400', 'Bornholm'],
    ['Nordby on Fanø', 55.436, 8.404, '0563', 'Fanø'],
    ['Hvide Sande', 56.0, 8.126, '0760', 'Ringkøbing-Skjern'],
  ])('finds %s', (_label, lat, lng, code, name) => {
    expect(kommuneOfPoint(lat, lng)).toEqual({ code, name });
  });

  it('answers null at sea, abroad and for garbage', () => {
    expect(kommuneOfPoint(56.5, 11.6)).toBeNull(); // Kattegat
    expect(kommuneOfPoint(55.6, 13.0)).toBeNull(); // Malmö
    expect(kommuneOfPoint(NaN, 12)).toBeNull();
    expect(kommuneOfPoint(undefined, undefined)).toBeNull();
  });
});

describe('postcodes', () => {
  it('knows a postcode, its town, its centre and its kommune', () => {
    const p = postcodeInfo('3400');

    expect(p).toMatchObject({ zip: '3400', name: 'Hillerød' });
    expect(p.lat).toBeCloseTo(55.93, 1);
    expect(p.lng).toBeCloseTo(12.31, 1);
    expect(kommuneOfPostcode('3400')).toMatchObject({ code: '0219', name: 'Hillerød' });
  });

  it('accepts a number, and returns a copy a caller cannot corrupt the index through', () => {
    expect(postcodeInfo(3400)).toMatchObject({ zip: '3400' });
    postcodeInfo('3400').kommuner.length = 0;
    expect(postcodeInfo('3400').kommuner.length).toBeGreaterThan(0);
  });

  it('is null for a postcode that does not exist', () => {
    expect(postcodeInfo('0001')).toBeNull();
    expect(kommuneOfPostcode('0001')).toBeNull();
  });

  it('names the largest kommune of a postcode that straddles a border, and keeps the rest', () => {
    let straddling = null;
    for (let n = 1000; n <= 9999 && !straddling; n++) {
      const p = postcodeInfo(n);
      if (p && !p.street && p.kommuner.length > 1) straddling = p;
    }

    const k = kommuneOfPostcode(straddling.zip);

    expect(k.code).toBe(straddling.kommuner[0].code);
    expect(k.others.map((o) => o.code)).toEqual(straddling.kommuner.slice(1).map((o) => o.code));
    expect(k.share).toBeGreaterThanOrEqual(k.others[0].share);
  });

  it('flags a postcode whose area holds no land, rather than passing a guess off as measured', () => {
    expect(postcodeInfo('6960')).toMatchObject({ nearest: true });
    expect(kommuneOfPostcode('6960').code).toBe('0760');
  });
});

describe('normalizePlaceName', () => {
  it('makes the spellings of a Danish name meet', () => {
    expect(normalizePlaceName('Århus')).toBe(normalizePlaceName('Aarhus'));
    expect(normalizePlaceName('Ølgod')).toBe(normalizePlaceName('Oelgod'));
    expect(normalizePlaceName('  Ringkøbing-Skjern  ')).toBe('ringkoebing skjern');
    expect(normalizePlaceName(null)).toBe('');
  });
});

describe('kommuneByName', () => {
  it.each([
    ['Aarhus Kommune', '0751'],
    ['Århus', '0751'],
    ['Københavns Kommune', '0101'],
    ['Ringkøbing-Skjern', '0760'],
    ['Hillerød Kommune', '0219'],
  ])('resolves %s', (name, code) => {
    expect(kommuneByName(name)?.code).toBe(code);
  });

  it('is null for something that is not a kommune', () => {
    expect(kommuneByName('Ølgod')).toBeNull();
    expect(kommuneByName('')).toBeNull();
  });
});

describe('findPostcodesByName', () => {
  it('finds a postal town with or without its district letter', () => {
    expect(findPostcodesByName('København K').map((p) => p.zip)).toContain('1050');
    expect(findPostcodesByName('København').length).toBeGreaterThan(5);
    expect(findPostcodesByName('Nowhereville')).toEqual([]);
  });
});

describe('resolvePlace', () => {
  it('reads a postcode and a town', () => {
    expect(resolvePlace('3400 Hillerød')).toMatchObject({ zip: '3400', kommuneCode: '0219', kommuneName: 'Hillerød' });
  });

  it('reads a town on its own', () => {
    expect(resolvePlace('Hillerød')).toMatchObject({ zip: '3400', kommuneCode: '0219' });
  });

  it('puts a town in the kommune it is in, not the one it sounds like', () => {
    // Ølgod has been in Varde kommune since the 2007 reform.
    expect(resolvePlace('Ølgod')).toMatchObject({ kommuneCode: '0573', kommuneName: 'Varde' });
  });

  it('copes with a district letter', () => {
    expect(resolvePlace('2100 København Ø')).toMatchObject({ zip: '2100', kommuneCode: '0101' });
    expect(resolvePlace('8200 Aarhus N')).toMatchObject({ zip: '8200', kommuneCode: '0751' });
  });

  it('lets the postcode decide when the town is misspelled', () => {
    expect(resolvePlace('3400 Hilleroed')).toMatchObject({ kommuneCode: '0219' });
  });

  it('gives up on a list of places, since a wrong kommune is worse than none', () => {
    expect(resolvePlace('Herning, Holstebro, Skive eller Karup J')).toBeNull();
    expect(resolvePlace('Varde eller Esbjerg')).toBeNull();
  });

  it('gives up on a name that two kommuner share', () => {
    const shared = [...new Set(['Vejen', 'Nr. Aaby', 'Store Heddinge', 'Hald'])].find(
      (n) =>
        new Set(
          findPostcodesByName(n)
            .filter((p) => !p.street)
            .map((p) => p.kommuner[0].code),
        ).size > 1,
    );
    if (shared) expect(resolvePlace(shared)).toBeNull();
  });

  it('is null for nothing, for abroad and for Greenland', () => {
    expect(resolvePlace('')).toBeNull();
    expect(resolvePlace(undefined)).toBeNull();
    expect(resolvePlace('Nuuk')).toBeNull();
    expect(resolvePlace('3900 Nuuk')).toBeNull();
    expect(resolvePlace('Berlin')).toBeNull();
  });
});
