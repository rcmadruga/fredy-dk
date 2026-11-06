/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { formatListing, formatSaleCosts } from '../../lib/utils/formatListing.js';
import { buildListingMessage } from '../../lib/notification/adapter/gotify.js';

const house = {
  id: 'dk1',
  currency: 'DKK',
  title: 'Villa',
  price: 2000000,
  size: 120,
  rooms: 5,
  sale: { ownerCostMonthly: 3900, pricePerM2: 26322, publicValuation: 2700000 },
};

describe('formatSaleCosts', () => {
  it('prints the ejerudgift and the price per m² in kroner, grouped the way the price is', () => {
    expect(formatSaleCosts(house, 'en')).toBe('Ejerudgift 3.900 kr./month | 26.322 kr./m²');
  });

  it('follows the interface language for the one word that has one', () => {
    expect(formatSaleCosts(house, 'de')).toBe('Ejerudgift 3.900 kr./Monat | 26.322 kr./m²');
    expect(formatSaleCosts(house, 'tr')).toBe('Ejerudgift 3.900 kr./ay | 26.322 kr./m²');
    expect(formatSaleCosts(house, 'fr')).toContain('/month');
  });

  it('prints what the advert states and leaves out what it does not', () => {
    expect(formatSaleCosts({ currency: 'DKK', sale: { ownerCostMonthly: 3900 } }, 'en')).toBe(
      'Ejerudgift 3.900 kr./month',
    );
    expect(formatSaleCosts({ currency: 'DKK', sale: { pricePerM2: 26322 } }, 'en')).toBe('26.322 kr./m²');
  });

  it('is nothing at all without either figure, so no empty line is ever sent', () => {
    expect(formatSaleCosts({ currency: 'DKK', sale: { ownerCostMonthly: null, pricePerM2: null } }, 'en')).toBeNull();
    expect(formatSaleCosts({ currency: 'DKK', sale: { publicValuation: 2700000 } }, 'en')).toBeNull();
    expect(formatSaleCosts({ currency: 'DKK' }, 'en')).toBeNull();
  });

  it('is nothing for a provider that does not price in kroner', () => {
    expect(formatSaleCosts({ ...house, currency: 'EUR' }, 'en')).toBeNull();
    expect(formatSaleCosts({ ...house, currency: undefined }, 'en')).toBeNull();
  });
});

describe('formatListing carries the line', () => {
  it('adds saleCosts for a Danish sale and leaves the rest of the listing as it was', () => {
    const formatted = formatListing(house, 'en');
    expect(formatted.saleCosts).toBe('Ejerudgift 3.900 kr./month | 26.322 kr./m²');
    expect(formatted.price).toBe('2.000.000 kr.');
    expect(formatted.size).toBe('120 m²');
  });

  it('is null for every listing that is not one, so those notifications read as before', () => {
    expect(formatListing({ id: 'x', price: 1200, size: 74 }, 'en').saleCosts).toBeNull();
    expect(formatListing({ ...house, sale: undefined }, 'en').saleCosts).toBeNull();
  });
});

describe('an adapter shows the line', () => {
  it('puts it among the details when there is one, and not when there is none', () => {
    const withLine = buildListingMessage(formatListing(house, 'en'), null);
    // The adapter escapes the markdown characters of the line; the line itself is tested above.
    expect(withLine).toMatch(/\*\*Costs:\*\* Ejerudgift 3/);

    const without = buildListingMessage(formatListing({ id: 'x', price: 1200, size: 74 }, 'en'), null);
    expect(without).not.toContain('Costs');
  });
});
