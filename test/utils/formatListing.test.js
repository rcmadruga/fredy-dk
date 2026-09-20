/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { formatListing, formatPriceChange } from '../../lib/utils/formatListing.js';

/**
 * Notification text used to be German whatever the user had set the interface to, because the
 * "rooms" unit was hard-coded as "Zimmer". Currency and area carry no language, so only that one
 * word follows the setting.
 */
describe('formatListing', () => {
  const listing = { id: 'l1', title: 'Flat', price: 1200, size: 74, rooms: 3 };

  it('uses the German word when the owner runs the interface in German', () => {
    expect(formatListing(listing, 'de').rooms).toBe('3 Zimmer');
  });

  it('uses the English word when the owner runs the interface in English', () => {
    expect(formatListing(listing, 'en').rooms).toBe('3 rooms');
  });

  it('defaults to English rather than German for an unknown or missing language', () => {
    expect(formatListing(listing).rooms).toBe('3 rooms');
    expect(formatListing(listing, 'fr').rooms).toBe('3 rooms');
  });

  it('formats price and size with their language-neutral units', () => {
    const formatted = formatListing(listing, 'de');
    expect(formatted.price).toBe('1200 €');
    expect(formatted.size).toBe('74 m²');
  });

  it('leaves missing numbers as null instead of printing a bare unit', () => {
    const sparse = formatListing({ id: 'l2', title: 'Flat' }, 'de');
    expect(sparse.price).toBeNull();
    expect(sparse.size).toBeNull();
    expect(sparse.rooms).toBeNull();
  });

  it('keeps every other field untouched', () => {
    const formatted = formatListing({ ...listing, link: 'https://example.com', address: 'Main 1' }, 'en');
    expect(formatted.id).toBe('l1');
    expect(formatted.title).toBe('Flat');
    expect(formatted.link).toBe('https://example.com');
    expect(formatted.address).toBe('Main 1');
  });

  it('does not mutate the listing it was given', () => {
    const original = { ...listing };
    formatListing(listing, 'de');
    expect(listing).toEqual(original);
  });
});

describe('formatListing currency', () => {
  const listing = { id: 'l1', title: 'Hus', price: 2000000, size: 120, rooms: 5 };

  it('prints euros unless told otherwise', () => {
    expect(formatListing(listing, 'en').price).toBe('2000000 €');
  });

  it('prints kroner for a provider that lists in DKK', () => {
    expect(formatListing(listing, 'en', 'DKK').price).toBe('2000000 kr.');
  });

  it('falls back to the code for a currency it has no symbol for, and to euros for junk', () => {
    expect(formatListing(listing, 'en', 'SEK').price).toBe('2000000 SEK');
    expect(formatListing(listing, 'en', 'kroner').price).toBe('2000000 €');
  });

  it('carries the currency through a price change', () => {
    const change = { listing, oldPrice: 2100000, newPrice: 2000000, changePercent: -4.8, direction: 'down' };
    const formatted = formatPriceChange(change, 'en', 'DKK');
    expect(formatted.oldPrice).toBe('2100000 kr.');
    expect(formatted.newPrice).toBe('2000000 kr.');
    expect(formatted.price).toBe('2000000 kr.');
  });
});
