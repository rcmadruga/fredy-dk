/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import { verdictExplanation } from '../../ui/src/services/finance/rentBasis.js';
import { buildObjectFacts } from '../../ui/src/views/listings/listingFacts.js';

/** Echoes the key and its parameters, as the sibling fact suites do. */
const t = (key, params) =>
  params == null ? key : `${key}(${Object.entries(params).map(([name, value]) => `${name}=${value}`)})`;

const THRESHOLDS = { buy: { affordableMaxPrice: 400000 }, rent: { affordableMaxRent: 1400 } };

describe('the explanation of a verdict on a home priced in kroner', () => {
  it('uses the Danish sentence and quotes no euro ceiling', () => {
    expect(verdictExplanation('stretch', { dealType: 'buy', currency: 'DKK' }, THRESHOLDS)).toEqual({
      key: 'listings.affordabilityTooltipDk.stretch',
      limit: null,
    });
  });

  it('leaves a purchase in euros, and a rental in kroner, on the sentences they always had', () => {
    expect(verdictExplanation('stretch', { dealType: 'buy', currency: 'EUR' }, THRESHOLDS)).toEqual({
      key: 'listings.affordabilityTooltip.stretch',
      limit: 400000,
    });
    expect(verdictExplanation('stretch', { dealType: 'buy' }, THRESHOLDS).key).toBe(
      'listings.affordabilityTooltip.stretch',
    );
    expect(verdictExplanation('affordable', { dealType: 'rent', currency: 'DKK' }, THRESHOLDS)).toEqual({
      key: 'listings.rentAffordabilityTooltip.affordable',
      limit: 1400,
    });
  });
});

describe('the verdict chip in the listing detail summary of a Danish sale', () => {
  const sale = { id: 'dk', dealType: 'buy', price: 2500000, size: 100, provider: 'boligsiden' };

  it('shows the verdict the server decided, with the Danish sentence', () => {
    const { affordability } = buildObjectFacts(
      { ...sale, affordabilityVerdict: 'stretch' },
      { t, locale: 'da-DK', currency: 'DKK', financeThresholds: THRESHOLDS, formatEuro: (value) => `${value} EUR` },
    );
    expect(affordability.verdict).toBe('stretch');
    expect(affordability.label).toBe('finance.verdict.stretch');
    expect(affordability.helpText).toContain('listings.affordabilityTooltipDk.stretch');
    expect(affordability.helpText).not.toContain('EUR');
  });

  it('shows nothing before the server has an opinion', () => {
    expect(buildObjectFacts(sale, { t, locale: 'da-DK', currency: 'DKK' }).affordability).toBeNull();
  });
});

describe('the Danish verdict sentences', () => {
  const localeDir = path.join(path.dirname(new URL(import.meta.url).pathname), '../../ui/src/locales');

  it('exist in every language and carry no placeholder for a ceiling they do not quote', () => {
    for (const file of fs.readdirSync(localeDir).filter((name) => name.endsWith('.json'))) {
      const translations = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf-8'));
      for (const verdict of ['affordable', 'stretch', 'unaffordable']) {
        const text = translations[`listings.affordabilityTooltipDk.${verdict}`];
        expect(text, `${file} ${verdict}`).toEqual(expect.any(String));
        expect(text).not.toContain('{{');
      }
    }
  });
});
