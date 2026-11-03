/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { parkingForListing, parkingFromText } from '../../../lib/services/score/parkingText.js';

describe('parkingFromText: Danish', () => {
  it.each([
    'Rummelig villa med carport og have.',
    'Fritliggende hus med dobbeltgarage',
    'Lejlighed på 3. sal. P-plads kan lejes for 600 kr. om måneden.',
    'Der er egen parkering i gården.',
    'Fælles parkeringsplads foran ejendommen',
  ])('finds parking in %s', (text) => {
    expect(parkingFromText(text)).toBe(1);
  });

  it.each([
    'Ingen parkering ved ejendommen.',
    'Lejligheden har ingen p-plads.',
    'Der følger ingen egen parkering med.',
    'Boligen er uden parkeringsplads',
  ])('reads the negation in %s', (text) => {
    expect(parkingFromText(text)).toBe(0);
  });
});

describe('parkingFromText: German', () => {
  it.each([
    'Helle 3-Zimmer-Wohnung mit Balkon und Stellplatz im Hof',
    'Tiefgaragenstellplatz kann für 85 EUR monatlich angemietet werden.',
    'Einfamilienhaus mit Doppelgarage und Carport',
    'Zwei Stellplätze vorhanden',
    'Ruhige Lage, Parkplatz direkt vor dem Haus',
  ])('finds parking in %s', (text) => {
    expect(parkingFromText(text)).toBe(1);
  });

  it.each([
    'Leider kein Stellplatz vorhanden.',
    'Wohnung ohne Garage, dafür mit großem Balkon',
    'Keine Parkplätze am Haus',
    'Stellplatz nicht vorhanden',
  ])('reads the negation in %s', (text) => {
    expect(parkingFromText(text)).toBe(0);
  });
});

describe('parkingFromText: English', () => {
  it('finds parking', () => {
    expect(parkingFromText('Bright flat, secure underground parking included.')).toBe(1);
  });

  it('reads a negation', () => {
    expect(parkingFromText('Please note there is no parking on site.')).toBe(0);
    expect(parkingFromText('Without parking.')).toBe(0);
  });
});

describe('parkingFromText: silence and mixtures', () => {
  it('is null when the advert says nothing, which is not the same as none', () => {
    expect(parkingFromText('Altbauwohnung im Zentrum, 3 Zimmer, saniert.')).toBeNull();
    expect(parkingFromText('Parketboden i alle rum')).toBeNull();
    expect(parkingFromText('')).toBeNull();
    expect(parkingFromText(null)).toBeNull();
    expect(parkingFromText(undefined)).toBeNull();
    expect(parkingFromText(42)).toBeNull();
  });

  it('lets a mention outside the negation win', () => {
    expect(parkingFromText('Kein Stellplatz für Besucher, aber eine Garage gehört zur Wohnung.')).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(parkingFromText('CARPORT')).toBe(1);
    expect(parkingFromText('KEIN STELLPLATZ')).toBe(0);
  });

  it('does not let a distant negator cancel a mention', () => {
    expect(parkingFromText('Ohne Balkon. Garage vorhanden.')).toBe(1);
  });
});

describe('parkingForListing', () => {
  it('reads the title and the description together', () => {
    expect(parkingForListing({ title: 'Wohnung mit Garage', description: 'Schön.' })).toBe(1);
    expect(parkingForListing({ title: 'Wohnung', description: 'Mit Stellplatz.' })).toBe(1);
  });

  it('copes with missing fields', () => {
    expect(parkingForListing({ title: 'Wohnung', description: null })).toBeNull();
    expect(parkingForListing({})).toBeNull();
    expect(parkingForListing(null)).toBeNull();
  });
});
