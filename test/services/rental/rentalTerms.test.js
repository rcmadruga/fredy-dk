/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import {
  buildRentalTerms,
  parseAvailabilityText,
  parseMoveInTotal,
  parseRentalTerms,
} from '../../../lib/services/rental/rentalTerms.js';

describe('buildRentalTerms', () => {
  it('turns what a Danish advert states into the stored fields', () => {
    expect(
      buildRentalTerms({
        rent: 5900,
        extraCosts: 450,
        deposit: 17700,
        prepaidRent: 5900,
        leasePeriodMonths: 0,
        availableFrom: '2026-12-01',
        socialHousing: false,
      }),
    ).toEqual({
      charges: 450,
      chargesIncluded: false,
      rental: { deposit: 17700, prepaidRent: 5900, leasePeriodMonths: 0, availableFrom: '2026-12-01' },
    });
  });

  describe('the running costs', () => {
    it('says the rent is quoted without them only when a figure is stated', () => {
      expect(buildRentalTerms({ rent: 5000, extraCosts: 600 })).toEqual({ charges: 600, chargesIncluded: false });
      for (const extraCosts of [0, null, undefined, '', 'n/a', -5]) {
        const result = buildRentalTerms({ rent: 5000, extraCosts });
        expect(result.charges, String(extraCosts)).toBeUndefined();
        expect(result.chargesIncluded, String(extraCosts)).toBeUndefined();
      }
    });

    it('does not take a figure as large as the rent for running costs', () => {
      expect(buildRentalTerms({ rent: 5000, extraCosts: 5000 })).toEqual({});
      expect(buildRentalTerms({ rent: 5000, extraCosts: 9000 })).toEqual({});
    });

    it('trusts a stated figure when the rent is unknown', () => {
      expect(buildRentalTerms({ extraCosts: 400 }).charges).toBe(400);
    });

    it('reads a Danish number written as text', () => {
      expect(buildRentalTerms({ rent: 5000, extraCosts: '1.0' }).charges).toBe(1);
      expect(buildRentalTerms({ rent: 9000, extraCosts: '1 250,50' }).charges).toBe(1250.5);
    });
  });

  describe('the figures', () => {
    it('tells a deposit of zero from no deposit stated', () => {
      expect(buildRentalTerms({ deposit: 0 }).rental).toEqual({ deposit: 0 });
      expect(buildRentalTerms({ deposit: null }).rental).toBeUndefined();
      expect(buildRentalTerms({ deposit: '' }).rental).toBeUndefined();
    });

    it('drops what is not a usable amount', () => {
      expect(buildRentalTerms({ deposit: -1, prepaidRent: NaN }).rental).toBeUndefined();
      expect(buildRentalTerms({ deposit: 'lots' }).rental).toBeUndefined();
    });
  });

  describe('the lease', () => {
    it('keeps 0 as open-ended and a positive number as a limit', () => {
      expect(buildRentalTerms({ leasePeriodMonths: 0 }).rental).toEqual({ leasePeriodMonths: 0 });
      expect(buildRentalTerms({ leasePeriodMonths: 12 }).rental).toEqual({ leasePeriodMonths: 12 });
    });

    it('drops a lease length that is not a whole number of months', () => {
      expect(buildRentalTerms({ leasePeriodMonths: 5.5 }).rental).toBeUndefined();
      expect(buildRentalTerms({ leasePeriodMonths: null }).rental).toBeUndefined();
    });
  });

  describe('the date the home is free', () => {
    it('keeps the date of an ISO date or timestamp', () => {
      expect(buildRentalTerms({ availableFrom: '2027-01-15' }).rental.availableFrom).toBe('2027-01-15');
      expect(buildRentalTerms({ availableFrom: '2027-01-15T00:00:00+00:00' }).rental.availableFrom).toBe('2027-01-15');
    });

    it('refuses what is not a real calendar date', () => {
      for (const value of ['2027-02-30', '2027-13-01', 'next month', '', null, undefined, 20270101]) {
        expect(buildRentalTerms({ availableFrom: value }).rental, String(value)).toBeUndefined();
      }
    });
  });

  describe('the stated move-in total', () => {
    it('is kept when it is at least a month of rent and at most a year of it', () => {
      expect(buildRentalTerms({ rent: 5900, moveInTotal: 41300 }).rental).toEqual({ moveInTotal: 41300 });
      expect(buildRentalTerms({ rent: 5900, moveInTotal: 5900 }).rental).toEqual({ moveInTotal: 5900 });
    });

    it('is dropped when it cannot be a move-in price for this rent', () => {
      expect(buildRentalTerms({ rent: 5900, moveInTotal: 900 }).rental).toBeUndefined();
      expect(buildRentalTerms({ rent: 5900, moveInTotal: 5900 * 13 }).rental).toBeUndefined();
      expect(buildRentalTerms({ rent: 5900, moveInTotal: -1 }).rental).toBeUndefined();
    });

    it('is trusted when the rent is unknown', () => {
      expect(buildRentalTerms({ moveInTotal: 41300 }).rental).toEqual({ moveInTotal: 41300 });
    });
  });

  it('flags a housing association home only when it is one', () => {
    expect(buildRentalTerms({ socialHousing: true }).rental).toEqual({ socialHousing: true });
    expect(buildRentalTerms({ socialHousing: false }).rental).toBeUndefined();
  });

  it('is empty for an advert that states nothing, and copes with no input at all', () => {
    expect(buildRentalTerms({ rent: 5000 })).toEqual({});
    expect(buildRentalTerms()).toEqual({});
  });
});

describe('parseRentalTerms', () => {
  it('reads back what was stored', () => {
    const rental = { deposit: 17700, prepaidRent: 5900, leasePeriodMonths: 0, availableFrom: '2026-12-01' };

    expect(parseRentalTerms(JSON.stringify(rental))).toEqual(rental);
    expect(parseRentalTerms(rental)).toEqual(rental);
  });

  it('is null for nothing, for broken JSON and for the wrong shape', () => {
    for (const stored of [null, undefined, '', '{not json', '[]', '"text"', '42', [1, 2]]) {
      expect(parseRentalTerms(stored), String(stored)).toBeNull();
    }
  });

  it('drops anything in a stored row that is no longer valid, rather than showing it', () => {
    expect(parseRentalTerms('{"deposit":-5,"availableFrom":"someday","leasePeriodMonths":12}')).toEqual({
      leasePeriodMonths: 12,
    });
  });
});

describe('parseMoveInTotal', () => {
  it.each([
    ['Indflytningspris: 24.050 kr.', 24050],
    ['Samlet indflytningspris kr. 41.300,-', 41300],
    ['Indflytningspris ialt 24.050,- kr.', 24050],
    ['Total indflytningspris er 41300 kr', 41300],
    ['Indflytningsomkostninger udgør 38.500 DKK i alt', 38500],
    ['Indflytningsprisen er 41.300 kr.', 41300],
    ['Indflytningspris: 24.050', 24050],
    ['Indflytningspris 24050', 24050],
    ['Move-in price: DKK 24,050', 24050],
    ['Total move-in cost 41,300 kr', 41300],
    ['I alt ved indflytning: 29.950 kr.', 29950],
    ['Indflytningspris: 24.050,50 kr.', 24050.5],
  ])('reads "%s"', (text, expected) => {
    expect(parseMoveInTotal(text)).toBe(expected);
  });

  it('finds it inside a longer description, across lines', () => {
    const text =
      'Lys lejlighed tæt på stationen.\n\nHusleje: 5.900 kr.\nIndflytningspris: 29.950 kr.\nLedig fra 1. januar.';

    expect(parseMoveInTotal(text)).toBe(29950);
  });

  it('ignores remarks in brackets between the phrase and the sum', () => {
    expect(parseMoveInTotal('Indflytningspris (depositum + forudbetalt leje + første måneds leje): 41.300 kr.')).toBe(
      41300,
    );
  });

  it('is not taken in by a list of the parts, which is not the total', () => {
    expect(parseMoveInTotal('Indflytning: Depositum 17.700 kr. + forudbetalt leje 5.900 kr.')).toBeUndefined();
    expect(parseMoveInTotal('Indflytningspris: depositum 17.700 kr.')).toBeUndefined();
  });

  it('is not taken in by a date, a count or the end of a sentence', () => {
    for (const text of [
      'Indflytningsdato: 1. januar 2027',
      'Indflytningspris: 2 uger efter underskrift',
      'Indflytningspris: 1.1.2027',
      'Indflytningspris: se kontrakten. Husleje 5.900 kr.',
      'Indflytning kan ske 1. oktober, husleje 12.500 kr.',
    ]) {
      expect(parseMoveInTotal(text), text).toBeUndefined();
    }
  });

  it('takes the first usable sum when an earlier mention has none', () => {
    expect(parseMoveInTotal('Indflytningspris oplyses ved fremvisning. Indflytningspris: 24.050 kr.')).toBe(24050);
  });

  it('copes with nothing', () => {
    for (const text of ['', null, undefined, 42, 'Ingen priser her']) expect(parseMoveInTotal(text)).toBeUndefined();
  });
});

describe('normalizeIsoDate', () => {
  it('accepts a date and a timestamp, and returns the date', async () => {
    const { normalizeIsoDate } = await import('../../../lib/services/rental/rentalTerms.js');

    expect(normalizeIsoDate('2027-01-15')).toBe('2027-01-15');
    expect(normalizeIsoDate('2027-01-15T10:30:00Z')).toBe('2027-01-15');
    expect(normalizeIsoDate('2027-01-15 10:30')).toBe('2027-01-15');
  });

  it('refuses what is not a date, and a date with anything else after it', async () => {
    const { normalizeIsoDate } = await import('../../../lib/services/rental/rentalTerms.js');

    for (const bad of [
      '2027-02-30',
      '15-01-2027',
      "2027-01-01'; DROP TABLE x;--",
      '2027-01-01 or later',
      '',
      null,
      5,
    ]) {
      expect(normalizeIsoDate(bad), String(bad)).toBeNull();
    }
  });
});

describe('availability: "as soon as possible" is a state, not a date', () => {
  it('stores the flag when an advert says the home is free now', () => {
    expect(buildRentalTerms({ availableImmediately: true }).rental).toEqual({ availableImmediately: true });
  });

  it('lets a stated date win over the flag, so the two are never stored together', () => {
    expect(buildRentalTerms({ availableFrom: '2027-01-15', availableImmediately: true }).rental).toEqual({
      availableFrom: '2027-01-15',
    });
  });

  it('is not set by anything but true', () => {
    for (const value of [false, null, undefined, 'true', 1]) {
      expect(buildRentalTerms({ availableImmediately: value }).rental, String(value)).toBeUndefined();
    }
  });

  it('survives the stored JSON', () => {
    expect(parseRentalTerms('{"availableImmediately":true}')).toEqual({ availableImmediately: true });
  });

  describe('parseAvailabilityText', () => {
    it.each([
      ['Snarest muligt', { availableImmediately: true }],
      ['snarest', { availableImmediately: true }],
      ['Så hurtigt som muligt', { availableImmediately: true }],
      ['Hurtigst muligt', { availableImmediately: true }],
      ['Straks', { availableImmediately: true }],
      ['Omgående', { availableImmediately: true }],
      ['Ledig nu', { availableImmediately: true }],
      ['ASAP', { availableImmediately: true }],
      ['As soon as possible', { availableImmediately: true }],
      ['2027-01-15', { availableFrom: '2027-01-15' }],
      ['15-01-2027', { availableFrom: '2027-01-15' }],
      ['15.01.2027', { availableFrom: '2027-01-15' }],
      ['1/3/2027', { availableFrom: '2027-03-01' }],
    ])('reads "%s"', (text, expected) => {
      expect(parseAvailabilityText(text)).toEqual(expected);
    });

    it('says nothing for what a filter cannot use', () => {
      for (const text of ['efter aftale', '1. januar eller senere', '31-02-2027', '', '   ', null, undefined, 5]) {
        expect(parseAvailabilityText(text), String(text)).toEqual({});
      }
    });
  });
});

describe('priority', () => {
  it('keeps who the landlord offers a home to first, trimmed and bounded', () => {
    expect(buildRentalTerms({ priority: ' Danica Pension ' }).rental).toEqual({ priority: 'Danica Pension' });
    expect(buildRentalTerms({ priority: 'x'.repeat(200) }).rental.priority).toHaveLength(60);
  });

  it('is dropped when empty or not text', () => {
    for (const value of ['', '   ', null, undefined, 5, {}]) {
      expect(buildRentalTerms({ priority: value }).rental, String(value)).toBeUndefined();
    }
  });
});
