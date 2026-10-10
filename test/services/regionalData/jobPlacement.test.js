/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { placeAd, splitPlaceText } from '../../../lib/services/regionalData/jobPlacement.js';

describe('splitPlaceText', () => {
  it('splits lists the way adverts write them', () => {
    expect(splitPlaceText('Herning, Holstebro, Skive eller Karup J')).toEqual([
      'Herning',
      'Holstebro',
      'Skive',
      'Karup J',
    ]);
    expect(splitPlaceText('Varde eller Esbjerg')).toEqual(['Varde', 'Esbjerg']);
    expect(splitPlaceText('Aarhus / Silkeborg')).toEqual(['Aarhus', 'Silkeborg']);
    expect(splitPlaceText('Hillerød')).toEqual(['Hillerød']);
    expect(splitPlaceText('')).toEqual([]);
    expect(splitPlaceText(null)).toEqual([]);
  });
});

describe('placeAd', () => {
  it('uses the workplace coordinates first, and calls them precise', () => {
    // Nøddebo Børnehave, Solrød Strand: the advert's own address.
    const places = placeAd({
      area: 'Solrød Strand',
      addresses: [{ zip: '2680', city: 'Solrød Strand', lat: 55.520382, lng: 12.201775 }],
    });

    expect(places).toEqual([
      { kommuneCode: '0269', kommuneName: 'Solrød', lat: 55.520382, lng: 12.201775, approximate: false },
    ]);
  });

  it('places by the postcode when there are no coordinates, and says it is approximate', () => {
    const [place] = placeAd({ addresses: [{ zip: '3400', city: 'Hillerød' }] });

    expect(place).toMatchObject({ kommuneCode: '0219', kommuneName: 'Hillerød', approximate: true });
    expect(place.lat).toBeCloseTo(55.93, 1);
  });

  it('places by the place text when that is all there is', () => {
    expect(placeAd({ area: '3400 Hillerød', addresses: [] })).toMatchObject([
      { kommuneCode: '0219', approximate: true },
    ]);
    expect(placeAd({ area: 'Ølgod', addresses: [] })).toMatchObject([{ kommuneCode: '0573', kommuneName: 'Varde' }]);
  });

  it('ignores coordinates outside Denmark and falls through to what else it has', () => {
    const places = placeAd({
      area: 'Hjørring',
      addresses: [{ zip: null, city: 'Nuuk', lat: 64.18, lng: -51.72 }],
    });

    expect(places).toMatchObject([{ kommuneName: 'Hjørring', approximate: true }]);
  });

  it('splits a list of towns across every one, each approximate', () => {
    const places = placeAd({ area: 'Varde eller Esbjerg', addresses: [] });

    expect(places.map((p) => p.kommuneName).sort()).toEqual(['Esbjerg', 'Varde']);
    expect(places.every((p) => p.approximate)).toBe(true);
  });

  it('leaves a list off the map when any town in it is not a place it knows', () => {
    expect(placeAd({ area: 'Varde eller Atlantis', addresses: [] })).toEqual([]);
  });

  it('counts two addresses in the same spot once, and keeps two different places', () => {
    const same = placeAd({
      addresses: [
        { lat: 55.520382, lng: 12.201775 },
        { lat: 55.520382, lng: 12.201775 },
      ],
    });
    const two = placeAd({
      addresses: [
        { lat: 55.520382, lng: 12.201775 },
        { lat: 56.1535, lng: 10.204 },
      ],
    });

    expect(same).toHaveLength(1);
    expect(two.map((p) => p.kommuneName).sort()).toEqual(['Aarhus', 'Solrød']);
  });

  it('does not place Greenland or the Faroes', () => {
    expect(placeAd({ area: '3905 Nuussuaq', addresses: [{ zip: '3905', city: 'Nuussuaq' }] })).toEqual([]);
    expect(placeAd({ area: 'Grønland', addresses: [] })).toEqual([]);
    expect(placeAd({ area: 'Tórshavn', addresses: [] })).toEqual([]);
  });

  it('copes with an advert that says nothing', () => {
    expect(placeAd({})).toEqual([]);
    expect(placeAd(null)).toEqual([]);
    expect(placeAd({ addresses: [{}] })).toEqual([]);
  });
});
