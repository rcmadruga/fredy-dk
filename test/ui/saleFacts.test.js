/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { buildSaleFacts, RELISTED_GAP_DAYS } from '../../ui/src/views/listings/listingFacts.js';
import { formatPrice } from '../../ui/src/services/price/priceService.js';
import en from '../../ui/src/locales/en.json';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Echoes the key and its values, so an assertion can say which line carries what without depending
// on wording.
const t = (key, params) => (params ? `${key}(${Object.values(params).join(',')})` : key);
const NOW = new Date('2026-10-10T10:00:00Z');
const ctx = (extra = {}) => ({ t, locale: 'en', currency: 'DKK', now: NOW, ...extra });
const money = (n) => formatPrice(n, 'en', null, 'DKK');

const terms = (over = {}) => ({
  ownerCostMonthly: 3900,
  downPayment: 325000,
  grossPaymentMonthly: 35406,
  netPaymentMonthly: 28476,
  pricePerM2: 26322,
  publicValuation: 2700000,
  sales: [],
  daysOnMarket: { current: 20, total: 406 },
  previousRealtors: ['home Odense - Skibhus'],
  priceChangePct: -4.09,
  energyLabel: 'B',
  lotArea: 355,
  basementArea: 106,
  bathrooms: 3,
  yearBuilt: 1934,
  yearRenovated: 2015,
  heating: 'Fjernvarme/blokvarme',
  landTaxPerMille: 5.7,
  municipalTaxPct: 25.5,
  propertyType: 'villa',
  floorPlanUrl: 'https://example.com/plan.webp',
  nextOpenHouse: { date: '2026-10-20T08:00:00Z', signUpUrl: 'http://example.com/signup' },
  ...over,
});
const sale = (over = {}, listing = {}) => ({
  dealType: 'buy',
  provider: 'boligsiden',
  price: 6495000,
  sale_terms: terms(over),
  ...listing,
});
const empty = {
  ownerCostMonthly: null,
  downPayment: null,
  grossPaymentMonthly: null,
  netPaymentMonthly: null,
  pricePerM2: null,
  publicValuation: null,
  sales: [],
  daysOnMarket: { current: null, total: null },
  previousRealtors: [],
  priceChangePct: null,
  energyLabel: null,
  lotArea: null,
  basementArea: null,
  bathrooms: null,
  yearBuilt: null,
  yearRenovated: null,
  heating: null,
  landTaxPerMille: null,
  municipalTaxPct: null,
  propertyType: null,
  floorPlanUrl: null,
  nextOpenHouse: null,
};
const row = (rows, id) => rows.find((r) => r.id === id);

describe('buildSaleFacts', () => {
  it('is null for a rental, for a listing without terms, and for terms that state nothing to show', () => {
    expect(buildSaleFacts({ ...sale(), dealType: 'rent' }, ctx())).toBeNull();
    expect(buildSaleFacts({ dealType: 'buy', price: 1, sale_terms: null }, ctx())).toBeNull();
    expect(buildSaleFacts({ dealType: 'buy', price: 1 }, ctx())).toBeNull();
    expect(buildSaleFacts({ dealType: 'buy', price: 1, sale_terms: empty }, ctx())).toBeNull();
    expect(buildSaleFacts(null, ctx())).toBeNull();
  });

  describe('price and monthly costs', () => {
    it('leads with the asking price and then the owner costs, in the currency of the listing', () => {
      const { costs } = buildSaleFacts(sale(), ctx());

      expect(costs.map((c) => c.id)).toEqual([
        'price',
        'ownerCost',
        'pricePerM2',
        'downPayment',
        'grossPayment',
        'netPayment',
        'priceChange',
      ]);
      expect(row(costs, 'price').value).toBe(money(6495000));
      expect(row(costs, 'ownerCost').value).toBe(money(3900));
      expect(row(costs, 'ownerCost').value).toContain('DKK');
      expect(row(costs, 'downPayment').value).toBe(money(325000));
      expect(row(costs, 'grossPayment').value).toBe(money(35406));
      expect(row(costs, 'netPayment').value).toBe(money(28476));
    });

    it('prints kroner the Danish way in a Danish locale', () => {
      const { costs } = buildSaleFacts(sale(), ctx({ locale: 'da' }));

      expect(row(costs, 'ownerCost').value).toMatch(/3\.900.*kr\./);
    });

    it('says how much the price has fallen, signed, and says nothing for a price never changed', () => {
      expect(row(buildSaleFacts(sale(), ctx()).costs, 'priceChange').value).toBe('-4.1 %');
      expect(row(buildSaleFacts(sale({ priceChangePct: 0 }), ctx()).costs, 'priceChange')).toBeUndefined();
      expect(row(buildSaleFacts(sale({ priceChangePct: 3 }), ctx()).costs, 'priceChange').value).toBe('+3 %');
    });

    it('leaves out a figure the advert did not state instead of printing zero', () => {
      const { costs } = buildSaleFacts(sale({ ownerCostMonthly: null, downPayment: null }), ctx());

      expect(row(costs, 'ownerCost')).toBeUndefined();
      expect(row(costs, 'downPayment')).toBeUndefined();
      expect(costs.every((c) => !/\b0\b/.test(c.value))).toBe(true);
    });

    it('does not repeat the asking price when it is the only thing it could say', () => {
      const facts = buildSaleFacts(
        sale({
          ownerCostMonthly: null,
          pricePerM2: null,
          downPayment: null,
          grossPaymentMonthly: null,
          netPaymentMonthly: null,
          priceChangePct: null,
        }),
        ctx(),
      );

      expect(facts.costs).toEqual([]);
    });
  });

  describe('time on the market', () => {
    it('says relisted, and how long longer, when the total is well above the current stay', () => {
      const { market } = buildSaleFacts(sale(), ctx());

      expect(market).toMatchObject({
        current: 'listing.detail.saleDays(20)',
        total: 'listing.detail.saleDays(406)',
        relisted: true,
        gapDays: 386,
        previousRealtors: ['home Odense - Skibhus'],
      });
    });

    it('applies the threshold exactly: 60 days apart is relisted, 59 is not', () => {
      expect(RELISTED_GAP_DAYS).toBe(60);
      expect(buildSaleFacts(sale({ daysOnMarket: { current: 10, total: 70 } }), ctx()).market.relisted).toBe(true);
      expect(buildSaleFacts(sale({ daysOnMarket: { current: 10, total: 69 } }), ctx()).market.relisted).toBe(false);
    });

    it('is not relisted when only one of the two day counts is known', () => {
      const { market } = buildSaleFacts(sale({ daysOnMarket: { current: 20, total: null } }), ctx());

      expect(market).toMatchObject({
        current: 'listing.detail.saleDays(20)',
        total: null,
        relisted: false,
        gapDays: null,
      });
    });

    it('is absent when neither is known', () => {
      expect(buildSaleFacts(sale({ daysOnMarket: { current: null, total: null } }), ctx()).market).toBeNull();
    });
  });

  describe('the building', () => {
    it('lists what is stated, with the type named in the reader language', () => {
      const { building } = buildSaleFacts(sale(), ctx());

      expect(building.map((b) => b.id)).toEqual([
        'propertyType',
        'yearBuilt',
        'yearRenovated',
        'energyLabel',
        'heating',
        'lotArea',
        'basementArea',
        'bathrooms',
        'landTax',
      ]);
      expect(row(building, 'propertyType').value).toBe('listing.detail.saleTypeVilla');
      expect(row(building, 'yearBuilt').value).toBe('1934');
      expect(row(building, 'lotArea').value).toBe('355 m²');
      expect(row(building, 'landTax').value).toBe('5.7 ‰');
    });

    it('shows a property type it has no name for as the portal wrote it', () => {
      const { building } = buildSaleFacts(sale({ propertyType: 'houseboat' }), ctx());

      expect(row(building, 'propertyType').value).toBe('houseboat');
    });

    it('is empty when nothing is stated', () => {
      const { building } = buildSaleFacts(
        sale({
          yearBuilt: null,
          yearRenovated: null,
          energyLabel: null,
          heating: null,
          lotArea: null,
          basementArea: null,
          bathrooms: null,
          landTaxPerMille: null,
          propertyType: null,
        }),
        ctx(),
      );

      expect(building).toEqual([]);
    });
  });

  describe('links', () => {
    it('gives the floor plan and the next open house with its sign-up link', () => {
      const facts = buildSaleFacts(sale(), ctx());

      expect(facts.floorPlanUrl).toBe('https://example.com/plan.webp');
      expect(facts.openHouse).toEqual({
        text: expect.stringContaining('October'),
        signUpUrl: 'http://example.com/signup',
      });
    });

    it('sets the open house in Danish time', () => {
      const { openHouse } = buildSaleFacts(
        sale({ nextOpenHouse: { date: '2026-10-20T08:00:00Z', signUpUrl: null } }),
        ctx(),
      );

      expect(openHouse.text).toContain('10:00');
      expect(openHouse.signUpUrl).toBeNull();
    });

    it('drops an open house that is over', () => {
      const facts = buildSaleFacts(
        sale({ nextOpenHouse: { date: '2026-09-12T08:00:00Z', signUpUrl: 'http://x.example/' } }),
        ctx(),
      );

      expect(facts.openHouse).toBeNull();
    });
  });

  it('only asks for translation keys the English locale has', () => {
    const asked = new Set();
    const record = (key, params) => {
      asked.add(key);
      return t(key, params);
    };
    const types = ['villa', 'terraced house', 'condo', 'double house', 'villa apartment'];
    for (const propertyType of types) buildSaleFacts(sale({ propertyType }), ctx({ t: record }));

    expect(asked.size).toBeGreaterThan(20);
    for (const key of asked) expect(en[key], key).toBeTruthy();
  });

  it('is rendered by a card that only asks for keys the English locale has', () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../ui/src/views/listings/components');
    const card = fs.readFileSync(path.join(dir, 'ListingSaleCard.jsx'), 'utf-8');
    const used = [...card.matchAll(/t\('(listing\.detail\.[A-Za-z]+)'/g)].map((m) => m[1]);

    expect(used.length).toBeGreaterThan(10);
    for (const key of used) expect(en[key], key).toBeTruthy();
  });
});

describe('buildSaleFacts, the earlier sales', () => {
  const history = [
    { date: '2023-08-29', amount: 1500000, type: 'family', area: 170 },
    { date: '2013-04-24', amount: 1450000, type: 'normal', area: 229 },
    { date: '1999-11-10', amount: 900000, type: 'normal', area: null },
    { date: '2010-03-11', amount: 400000, type: 'auction', area: null },
  ];

  it('is null when there are no sales and no valuation', () => {
    expect(buildSaleFacts(sale({ sales: [], publicValuation: null }), ctx()).sales).toBeNull();
  });

  it('lists the sales in the order given, which is newest first, with the amount in kroner', () => {
    const { sales } = buildSaleFacts(sale({ sales: history }), ctx()).sales;

    expect(sales.map((s) => s.date)).toEqual(['Aug 29, 2023', 'Apr 24, 2013', 'Nov 10, 1999', 'Mar 11, 2010']);
    expect(sales[1].amount).toBe(money(1450000));
  });

  it('works out the price per m2 at the time, and leaves it out where the register has no area', () => {
    const { sales } = buildSaleFacts(sale({ sales: history }), ctx()).sales;

    expect(sales[1].perM2).toBe(formatPrice(Math.round(1450000 / 229), 'en', 0, 'DKK') + '/m²');
    expect(sales[2].perM2).toBeNull();
  });

  describe('the change to today', () => {
    it('is the asking price against what was paid, as a signed percentage', () => {
      // (6,495,000 - 1,450,000) / 1,450,000 = +347.93 %
      const { sales } = buildSaleFacts(sale({ sales: history }), ctx()).sales;

      expect(sales[1].change.percent).toBeCloseTo(347.93, 2);
      expect(sales[1].change.text).toBe('+347.9 %');
      expect(sales[1].change.diffText).toBe(`+${money(6495000 - 1450000)}`);
    });

    it('is negative when the home is asked for less than it once sold for', () => {
      const earlier = [{ date: '2022-01-01', amount: 7000000, type: 'normal', area: 229 }];
      const { sales } = buildSaleFacts(sale({ sales: earlier }), ctx()).sales;

      expect(sales[0].change.text).toBe('-7.2 %');
      expect(sales[0].change.diffText).toBe(money(-505000));
    });

    it('is zero when nothing changed', () => {
      const earlier = [{ date: '2022-01-01', amount: 6495000, type: 'normal', area: null }];
      const { sales } = buildSaleFacts(sale({ sales: earlier }), ctx()).sales;

      expect(sales[0].change.percent).toBe(0);
      expect(sales[0].change.text).toBe('0 %');
    });

    it('is unknown when the listing has no asking price', () => {
      const { sales } = buildSaleFacts(sale({ sales: history }, { price: null }), ctx()).sales;

      expect(sales.every((s) => s.change === null)).toBe(true);
    });
  });

  describe('the sales that were not free', () => {
    it('labels them and compares none of them with today', () => {
      const { sales, hasNonFree } = buildSaleFacts(sale({ sales: history }), ctx()).sales;

      expect(hasNonFree).toBe(true);
      expect(sales.map((s) => [s.free, s.typeLabel, s.change === null])).toEqual([
        [false, 'listing.detail.saleSaleTypeFamily', true],
        [true, 'listing.detail.saleSaleTypeNormal', false],
        [true, 'listing.detail.saleSaleTypeNormal', false],
        [false, 'listing.detail.saleSaleTypeAuction', true],
      ]);
    });

    it('treats anything but "normal" as not free, including a type it has never heard of', () => {
      const earlier = [{ date: '2020-01-01', amount: 1000000, type: 'gift', area: null }];
      const { sales } = buildSaleFacts(sale({ sales: earlier }), ctx()).sales;

      expect(sales[0]).toMatchObject({ free: false, typeLabel: 'listing.detail.saleSaleTypeOther', change: null });
    });

    it('does not ask for the note when every sale was free', () => {
      const { hasNonFree } = buildSaleFacts(sale({ sales: [history[1]] }), ctx()).sales;

      expect(hasNonFree).toBe(false);
    });
  });

  it('puts the public valuation underneath, with the explanation that it is not a market price', () => {
    const { valuation } = buildSaleFacts(sale({ sales: history }), ctx()).sales;

    expect(valuation).toEqual({ text: money(2700000), helpText: 'listing.detail.saleValuationHelp' });
    expect(buildSaleFacts(sale({ sales: history, publicValuation: null }), ctx()).sales.valuation).toBeNull();
  });

  it('shows the valuation of a home that has never been sold', () => {
    const { sales } = buildSaleFacts(sale({ sales: [] }), ctx());

    expect(sales.sales).toEqual([]);
    expect(sales.valuation.text).toBe(money(2700000));
  });

  it('only asks for translation keys the English locale has', () => {
    const asked = new Set();
    const record = (key, params) => {
      asked.add(key);
      return t(key, params);
    };
    buildSaleFacts(sale({ sales: history }), ctx({ t: record }));

    for (const key of ['saleSaleTypeNormal', 'saleSaleTypeFamily', 'saleSaleTypeAuction', 'saleValuationHelp']) {
      expect(asked.has(`listing.detail.${key}`), key).toBe(true);
    }
    for (const key of asked) expect(en[key], key).toBeTruthy();
  });
});
