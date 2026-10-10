/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import {
  danishResultForListing,
  danishVerdictForListing,
  scoreDanishListing,
} from '../../../../lib/services/finance/dk/listingVerdict.js';
import { thresholdsFor, verdictForListing } from '../../../../lib/services/finance/affordability.js';
import { affordabilityBandFor } from '../../../../lib/services/finance/listingFilter.js';

/**
 * 40,000 kr net a month, 12,000 kr of living costs, 300,000 kr in cash. The German gate (Bundesland,
 * rate scenario) is satisfied too, so the same profile can be judged both ways.
 */
const PROFILE = {
  personA: { label: 'A', enabled: true, age: 35, primaryIncome: 40000, secondaryIncome: 0 },
  livingCosts: 12000,
  financing: {
    equity: 300000,
    market: 'dk',
    bundesland: 'NW',
    scenarios: [{ id: 'mid', annualRate: 3.8, tilgung: 2, fixedYears: 10 }],
  },
};

const home = (price, ownerCostMonthly = null) => ({
  id: `home-${price}-${ownerCostMonthly}`,
  price,
  sale_terms: ownerCostMonthly == null ? null : { ownerCostMonthly },
});

describe('danishVerdictForListing', () => {
  it('judges a home priced in kroner with the Danish model', () => {
    expect(danishVerdictForListing(home(2000000), PROFILE)).toBe('affordable');
    expect(danishVerdictForListing(home(4000000), PROFILE)).toBe('unaffordable');
  });

  it('is not the German verdict for the same number', () => {
    // 3,000,000 sits between the German ceilings of this household, which know nothing of kroner or of
    // the Danish loans. Judged the Danish way it is affordable with no ejerudgift and out of reach with one.
    const thresholds = thresholdsFor(PROFILE);
    expect(verdictForListing(3000000, 'buy', thresholds)).toBe('stretch');
    expect(danishVerdictForListing(home(3000000), PROFILE)).toBe('affordable');
    expect(danishVerdictForListing(home(3000000, 4000), PROFILE)).toBe('unaffordable');
  });

  it("uses the advert's own ejerudgift, so one price can land in every band", () => {
    expect(danishVerdictForListing(home(2500000, 0), PROFILE)).toBe('affordable');
    expect(danishVerdictForListing(home(2500000, 4000), PROFILE)).toBe('stretch');
    expect(danishVerdictForListing(home(2500000, 9000), PROFILE)).toBe('unaffordable');
  });

  it('takes the valuation of the advert into the one-off costs', () => {
    const plain = danishResultForListing(home(2000000), PROFILE);
    const valued = danishResultForListing({ price: 2000000, sale_terms: { publicValuation: 3000000 } }, PROFILE);
    expect(valued.dk.oneOff.skoede.basis).toBe(3000000);
    expect(valued.dk.oneOff.total).toBeGreaterThan(plain.dk.oneOff.total);
  });

  it('judges nothing without a price or with a profile too thin for the model', () => {
    expect(danishVerdictForListing(home(null), PROFILE)).toBeNull();
    expect(danishVerdictForListing(home(0), PROFILE)).toBeNull();
    expect(danishVerdictForListing(home(2000000), null)).toBeNull();
    expect(danishVerdictForListing(home(2000000), { ...PROFILE, livingCosts: null })).toBeNull();
  });
});

describe('scoreDanishListing', () => {
  it('returns the sweep shape in kroner, with the same verdict as the chip', () => {
    const listing = { ...home(2500000, 4000), title: 'Villa', address: 'Vej 1' };
    const scored = scoreDanishListing(listing, PROFILE);
    expect(scored).toMatchObject({
      id: listing.id,
      title: 'Villa',
      address: 'Vej 1',
      currency: 'DKK',
      price: 2500000,
      verdict: 'stretch',
    });
    expect(scored.verdict).toBe(danishVerdictForListing(listing, PROFILE));
    expect(scored.monthlyPayment).toBeGreaterThan(0);
    expect(scored.closingCosts).toBeGreaterThan(0);
    expect(scored.loanAmount).toBeGreaterThan(0);
  });

  it('returns null for a listing without a price', () => {
    expect(scoreDanishListing(home(null), PROFILE)).toBeNull();
  });
});

describe('affordabilityBandFor with providers priced in kroner', () => {
  it('is exactly what it was without any', () => {
    expect(affordabilityBandFor('affordable', PROFILE)).toEqual(affordabilityBandFor('affordable', PROFILE, {}));
    expect(affordabilityBandFor('affordable', PROFILE).dk).toBeUndefined();
    expect(affordabilityBandFor('affordable', PROFILE, { dkkProviders: [] }).dk).toBeUndefined();
  });

  it('adds the Danish band beside the German windows', () => {
    const band = affordabilityBandFor('stretch', PROFILE, { dkkProviders: ['boligsiden'] });
    expect(band.buy).toEqual(affordabilityBandFor('stretch', PROFILE).buy);
    expect(band.dk).toMatchObject({ band: 'stretch', providers: ['boligsiden'] });
  });

  it('still filters when only the Danish half of the profile is there', () => {
    const danishOnly = { ...PROFILE, financing: { equity: 300000, market: 'dk' } };
    expect(affordabilityBandFor('affordable', danishOnly)).toBeNull();
    const band = affordabilityBandFor('affordable', danishOnly, { dkkProviders: ['boligsiden'] });
    expect(band.buy).toBeNull();
    expect(band.dk.providers).toEqual(['boligsiden']);
  });
});
