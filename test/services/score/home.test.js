/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { HOME_METRICS } from '../../../lib/services/score/metrics/home.js';
import { finiteNumber, saleTermsOf } from '../../../lib/services/score/saleTermsReader.js';
import { scoreListing } from '../../../lib/services/score/score.js';

const byId = (id) => HOME_METRICS.find((metric) => metric.id === id);
const NOW = { currentYear: 2026 };
const homeScore = (listing, ctx, ids) =>
  scoreListing(
    listing,
    null,
    { ...NOW, ...ctx },
    HOME_METRICS.filter((m) => ids.includes(m.id)),
  ).groups[3];

describe('saleTermsOf', () => {
  it('returns an object as is', () => {
    expect(saleTermsOf({ sale_terms: { bathrooms: 2 } })).toEqual({ bathrooms: 2 });
  });

  it('parses JSON text', () => {
    expect(saleTermsOf({ sale_terms: '{"bathrooms":2}' })).toEqual({ bathrooms: 2 });
  });

  it('is null when absent, broken or not an object', () => {
    expect(saleTermsOf({})).toBeNull();
    expect(saleTermsOf(null)).toBeNull();
    expect(saleTermsOf({ sale_terms: null })).toBeNull();
    expect(saleTermsOf({ sale_terms: '{not json' })).toBeNull();
    expect(saleTermsOf({ sale_terms: '[1]' })).toBeNull();
    expect(saleTermsOf({ sale_terms: 5 })).toBeNull();
    expect(saleTermsOf({ sale_terms: [1] })).toBeNull();
  });

  it('also reads the camel-case spelling', () => {
    expect(saleTermsOf({ saleTerms: { yearBuilt: 1990 } })).toEqual({ yearBuilt: 1990 });
  });
});

describe('finiteNumber', () => {
  it('accepts numbers and numeric text', () => {
    expect(finiteNumber(3)).toBe(3);
    expect(finiteNumber('3.5')).toBe(3.5);
    expect(finiteNumber(0)).toBe(0);
  });

  it('refuses everything else', () => {
    for (const value of [null, undefined, '', 'x', NaN, Infinity, true, {}]) {
      expect(finiteNumber(value)).toBeNull();
    }
  });
});

describe('home.size', () => {
  const size = byId('size');

  it('reads the living space', () => {
    expect(size.raw({ size: 72 }, {})).toBe(72);
  });

  it('is missing without a size', () => {
    expect(size.raw({}, {})).toBeNull();
    expect(size.raw({ size: 0 }, {})).toBeNull();
  });

  it('defaults to the job minimum +40 % as ideal and the minimum as worst', () => {
    expect(size.defaults({ job: { minSize: 50 } })).toEqual({ ideal: 70, worst: 50 });
  });

  it('has no default targets without a job minimum', () => {
    expect(size.defaults({ job: { minSize: null } })).toBeNull();
    expect(size.defaults({})).toBeNull();
  });

  it('scores 70 m2 as 100 and 50 m2 as 0 for a job asking 50', () => {
    const ctx = { job: { minSize: 50 } };
    expect(homeScore({ dealType: 'rent', size: 70 }, ctx, ['size']).score).toBe(100);
    expect(homeScore({ dealType: 'rent', size: 60 }, ctx, ['size']).score).toBe(50);
    expect(homeScore({ dealType: 'rent', size: 50 }, ctx, ['size']).score).toBe(0);
  });
});

describe('home.bathrooms', () => {
  const bathrooms = byId('bathrooms');

  it('reads the sale terms', () => {
    expect(bathrooms.raw({ sale_terms: { bathrooms: 2 } })).toBe(2);
    expect(bathrooms.raw({ sale_terms: '{"bathrooms":1}' })).toBe(1);
  });

  it('is missing without sale terms or the field', () => {
    expect(bathrooms.raw({})).toBeNull();
    expect(bathrooms.raw({ sale_terms: { bathrooms: null } })).toBeNull();
  });

  it('scores two bathrooms as 100 and one as 0', () => {
    expect(homeScore({ dealType: 'buy', sale_terms: { bathrooms: 2 } }, {}, ['bathrooms']).score).toBe(100);
    expect(homeScore({ dealType: 'buy', sale_terms: { bathrooms: 1 } }, {}, ['bathrooms']).score).toBe(0);
  });
});

describe('home.internet', () => {
  const internet = byId('internet');

  it('reads the best fixed download', () => {
    expect(internet.raw({ connectivity_max_down: 1000 })).toBe(1000);
  });

  it('is missing when never looked up or unserved', () => {
    expect(internet.raw({})).toBeNull();
    expect(internet.raw({ connectivity_max_down: null })).toBeNull();
    expect(internet.raw({ connectivity_max_down: 0 })).toBeNull();
  });

  it('scores 1000 Mbit/s as 100 and 50 as 0', () => {
    expect(homeScore({ dealType: 'rent', connectivity_max_down: 1000 }, {}, ['internet']).score).toBe(100);
    expect(homeScore({ dealType: 'rent', connectivity_max_down: 50 }, {}, ['internet']).score).toBe(0);
    expect(homeScore({ dealType: 'rent', connectivity_max_down: 525 }, {}, ['internet']).score).toBe(50);
  });
});

describe('home.newBuild', () => {
  const newBuild = byId('newBuild');

  it('is buy-only', () => {
    expect(newBuild.buyOnly).toBe(true);
    expect(homeScore({ dealType: 'rent', build_year: 2020 }, {}, ['newBuild']).metrics).toEqual([]);
  });

  it('counts from the build year or the renovation, whichever is later', () => {
    expect(newBuild.raw({ sale_terms: { yearBuilt: 1990 } }, NOW)).toBe(36);
    expect(newBuild.raw({ sale_terms: { yearBuilt: 1960, yearRenovated: 2016 } }, NOW)).toBe(10);
  });

  it('falls back to the build year on the listing', () => {
    expect(newBuild.raw({ build_year: 2006 }, NOW)).toBe(20);
  });

  it('is missing without a year', () => {
    expect(newBuild.raw({}, NOW)).toBeNull();
    expect(newBuild.raw({ sale_terms: {} }, NOW)).toBeNull();
  });

  it('scores 5 years as 100 and 60 as 0', () => {
    expect(homeScore({ dealType: 'buy', build_year: 2021 }, {}, ['newBuild']).score).toBe(100);
    expect(homeScore({ dealType: 'buy', build_year: 1966 }, {}, ['newBuild']).score).toBe(0);
  });
});

describe('home.upkeep', () => {
  const upkeep = byId('upkeep');

  it('is a buy-only estimate', () => {
    expect(upkeep.buyOnly).toBe(true);
    expect(upkeep.qualifier).toBe('estimate');
  });

  it('estimates from the sale terms', () => {
    expect(upkeep.raw({ sale_terms: { yearBuilt: 1980, energyLabel: 'F' } }, NOW)).toBe(300);
  });

  it('is missing without sale terms or an age', () => {
    expect(upkeep.raw({}, NOW)).toBeNull();
    expect(upkeep.raw({ sale_terms: { energyLabel: 'F' } }, NOW)).toBeNull();
  });

  it('scores 100 kr/m2 as 100 and 400 as 0', () => {
    expect(homeScore({ dealType: 'buy', sale_terms: { yearBuilt: 2020 } }, {}, ['upkeep']).score).toBe(100);
    expect(homeScore({ dealType: 'buy', sale_terms: { yearBuilt: 1900 } }, {}, ['upkeep']).score).toBe(16.7);
  });
});

describe('home.parking', () => {
  const parking = byId('parking');

  it('is an estimate at half weight', () => {
    expect(parking.qualifier).toBe('estimate');
    expect(parking.defaultWeight).toBe(0.5);
  });

  it('reads the advert text', () => {
    expect(parking.raw({ title: 'Wohnung', description: 'Mit Stellplatz' })).toBe(1);
    expect(parking.raw({ title: 'Lejlighed', description: 'Ingen parkering' })).toBe(0);
  });

  it('is missing when the advert is silent', () => {
    expect(parking.raw({ title: 'Wohnung', description: 'Schön' })).toBeNull();
  });

  it('applies to rentals too', () => {
    expect(homeScore({ dealType: 'rent', description: 'Garage' }, {}, ['parking']).score).toBe(100);
    expect(homeScore({ dealType: 'rent', description: 'Kein Stellplatz' }, {}, ['parking']).score).toBe(0);
  });
});

describe('the Home group', () => {
  it('registers six metrics in the plan order', () => {
    expect(HOME_METRICS.map((metric) => metric.id)).toEqual([
      'size',
      'bathrooms',
      'internet',
      'newBuild',
      'upkeep',
      'parking',
    ]);
    expect(HOME_METRICS.every((metric) => metric.group === 'home')).toBe(true);
  });

  it('judges a rental over the four metrics that apply to it', () => {
    const result = scoreListing({ dealType: 'rent' }, null, {}, HOME_METRICS);
    expect(result.groups[3].metrics.map((m) => m.id)).toEqual(['size', 'bathrooms', 'internet', 'parking']);
  });

  it('judges a purchase over all six', () => {
    const result = scoreListing({ dealType: 'buy' }, null, {}, HOME_METRICS);
    expect(result.groups[3].metrics).toHaveLength(6);
  });
});
