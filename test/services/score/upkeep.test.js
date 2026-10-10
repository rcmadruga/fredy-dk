/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { UPKEEP_CONSTANTS, ageInYears, estimateUpkeep } from '../../../lib/services/score/upkeep.js';

const NOW = { currentYear: 2026 };

describe('ageInYears', () => {
  it('counts from the build year', () => {
    expect(ageInYears({ yearBuilt: 1990 }, 2026)).toBe(36);
  });

  it('counts from the last renovation when that is later', () => {
    expect(ageInYears({ yearBuilt: 1960, yearRenovated: 2015 }, 2026)).toBe(11);
  });

  it('ignores a renovation older than the build', () => {
    expect(ageInYears({ yearBuilt: 2000, yearRenovated: 1990 }, 2026)).toBe(26);
  });

  it('uses the renovation alone when the build year is unknown', () => {
    expect(ageInYears({ yearRenovated: 2010 }, 2026)).toBe(16);
  });

  it('reads years given as text', () => {
    expect(ageInYears({ yearBuilt: '1990' }, 2026)).toBe(36);
  });

  it('is null without a plausible year', () => {
    expect(ageInYears({}, 2026)).toBeNull();
    expect(ageInYears(null, 2026)).toBeNull();
    expect(ageInYears({ yearBuilt: 2031 }, 2026)).toBeNull();
    expect(ageInYears({ yearBuilt: 0 }, 2026)).toBeNull();
    expect(ageInYears({ yearBuilt: 'unknown' }, 2026)).toBeNull();
  });
});

describe('estimateUpkeep', () => {
  it('takes the base from the age band', () => {
    expect(estimateUpkeep({ yearBuilt: 2020 }, NOW)).toBe(80);
    expect(estimateUpkeep({ yearBuilt: 2005 }, NOW)).toBe(150);
    expect(estimateUpkeep({ yearBuilt: 1980 }, NOW)).toBe(250);
    expect(estimateUpkeep({ yearBuilt: 1900 }, NOW)).toBe(350);
  });

  it('puts the band edges where the plan says', () => {
    expect(estimateUpkeep({ yearBuilt: 2017 }, NOW)).toBe(80); // 9 years
    expect(estimateUpkeep({ yearBuilt: 2016 }, NOW)).toBe(150); // 10 years
    expect(estimateUpkeep({ yearBuilt: 1997 }, NOW)).toBe(150); // 29 years
    expect(estimateUpkeep({ yearBuilt: 1996 }, NOW)).toBe(250); // 30 years
    expect(estimateUpkeep({ yearBuilt: 1966 }, NOW)).toBe(250); // 60 years
    expect(estimateUpkeep({ yearBuilt: 1965 }, NOW)).toBe(350); // 61 years
  });

  it('adds 100 for a fibre cement roof', () => {
    expect(estimateUpkeep({ yearBuilt: 1980, roofingMaterial: 'Fibercement (asbest)' }, NOW)).toBe(350);
    expect(estimateUpkeep({ yearBuilt: 1980, roofingMaterial: 'Fibre cement' }, NOW)).toBe(350);
    expect(estimateUpkeep({ yearBuilt: 1980, roofingMaterial: 'Eternit' }, NOW)).toBe(350);
  });

  it('adds nothing for another roof', () => {
    expect(estimateUpkeep({ yearBuilt: 1980, roofingMaterial: 'Tegl' }, NOW)).toBe(250);
  });

  it('adds 50 for an energy label of E, F or G, in any scheme', () => {
    expect(estimateUpkeep({ yearBuilt: 1980, energyLabel: 'E' }, NOW)).toBe(300);
    expect(estimateUpkeep({ yearBuilt: 1980, energyLabel: 'f' }, NOW)).toBe(300);
    expect(estimateUpkeep({ yearBuilt: 1980, energyLabel: 'G' }, NOW)).toBe(300);
    expect(estimateUpkeep({ yearBuilt: 1980, energyLabel: 'C' }, NOW)).toBe(250);
    expect(estimateUpkeep({ yearBuilt: 1980, energyLabel: 'A2020' }, NOW)).toBe(250);
  });

  it('takes 30 off for district heating', () => {
    expect(estimateUpkeep({ yearBuilt: 1980, heating: 'Fjernvarme/blokvarme' }, NOW)).toBe(220);
    expect(estimateUpkeep({ yearBuilt: 1980, heating: 'Naturgas' }, NOW)).toBe(250);
  });

  it('combines the terms', () => {
    const terms = { yearBuilt: 1900, roofingMaterial: 'Eternit', energyLabel: 'F', heating: 'Fjernvarme' };
    expect(estimateUpkeep(terms, NOW)).toBe(350 + 100 + 50 - 30);
  });

  it('drops a term whose input is missing', () => {
    expect(estimateUpkeep({ yearBuilt: 1980, roofingMaterial: null, energyLabel: undefined }, NOW)).toBe(250);
  });

  it('has no estimate without an age', () => {
    expect(estimateUpkeep({ roofingMaterial: 'Eternit', energyLabel: 'G' }, NOW)).toBeNull();
    expect(estimateUpkeep(null, NOW)).toBeNull();
  });

  it('accepts replacement constants', () => {
    const constants = {
      ...UPKEEP_CONSTANTS,
      ageBands: [{ under: Infinity, perM2: 10 }],
      districtHeating: -50,
    };
    expect(estimateUpkeep({ yearBuilt: 1900, heating: 'fjernvarme' }, { ...NOW, constants })).toBe(0);
  });

  it('never goes negative', () => {
    const constants = { ...UPKEEP_CONSTANTS, districtHeating: -1000 };
    expect(estimateUpkeep({ yearBuilt: 2025, heating: 'fjernvarme' }, { ...NOW, constants })).toBe(0);
  });

  it('defaults to this year', () => {
    const thisYear = new Date().getFullYear();
    expect(estimateUpkeep({ yearBuilt: thisYear - 1 })).toBe(80);
  });
});
