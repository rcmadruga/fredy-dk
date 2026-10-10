/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { buildJobsLayer } from '../../../lib/services/regionalData/jobsLayer.js';
import { getKommunePolygons } from '../../../lib/services/geo/denmarkGeo.js';

const kommuner = getKommunePolygons();

const ad = (id, title, extra = {}) => ({
  id,
  title,
  employer: 'Plejehjemmet',
  area: null,
  url: `https://www.jobindex.dk/vis-job/${id}`,
  firstDate: '2026-09-29',
  lastDate: '2026-10-26',
  addresses: [],
  ...extra,
});
const SOLROED = { zip: '2680', city: 'Solrød Strand', lat: 55.520382, lng: 12.201775 };
const AARHUS = { zip: '8000', city: 'Aarhus C', lat: 56.1535, lng: 10.204 };

const countOf = (layer, code) => layer.choropleth.features.find((f) => f.properties.code === code).properties.count;

describe('buildJobsLayer', () => {
  it('counts an advert in the kommune it is in, and draws a dot for it', () => {
    const layer = buildJobsLayer([ad('a', 'Ernæringsassistent', { addresses: [SOLROED] })], kommuner);

    expect(layer.total).toBe(1);
    expect(countOf(layer, '0269')).toBe(1);
    expect(layer.postings).toEqual([
      expect.objectContaining({
        id: 'a@0269',
        adId: 'a',
        title: 'Ernæringsassistent',
        tier: 'exact',
        kommuneName: 'Solrød',
        approximate: false,
        alsoIn: [],
        url: 'https://www.jobindex.dk/vis-job/a',
      }),
    ]);
  });

  it('lists every kommune, with zero where there is nothing, so the map can say none', () => {
    const layer = buildJobsLayer([ad('a', 'Ernæringsassistent', { addresses: [SOLROED] })], kommuner);

    expect(layer.choropleth.features).toHaveLength(98);
    expect(layer.choropleth.features.filter((f) => f.properties.count === 0)).toHaveLength(97);
    expect(layer.choropleth.features[0]).toMatchObject({ type: 'Feature', geometry: expect.any(Object) });
  });

  it('leaves out what is not ernæringsassistent work, apprentice posts and unplaceable adverts', () => {
    const layer = buildJobsLayer(
      [
        ad('nurse', 'Sygeplejerske søges', { addresses: [SOLROED] }),
        ad('elev', 'Elevstilling som Ernæringsassistent', { addresses: [SOLROED] }),
        ad('nowhere', 'Ernæringsassistent', { area: 'Grønland' }),
        ad('ok', 'Køkkenmedarbejder', { addresses: [SOLROED] }),
      ],
      kommuner,
    );

    expect(layer.total).toBe(1);
    expect(layer.postings.map((p) => p.adId)).toEqual(['ok']);
    expect(layer.postings[0].tier).toBe('kitchen');
  });

  it('counts a multi-town advert once in each town, with a dot in each that names the others', () => {
    const layer = buildJobsLayer([ad('m', 'Ernæringsassistent', { area: 'Varde eller Esbjerg' })], kommuner);

    expect(layer.total).toBe(1);
    expect(countOf(layer, '0573')).toBe(1); // Varde
    expect(countOf(layer, '0561')).toBe(1); // Esbjerg
    expect(layer.postings).toHaveLength(2);
    const varde = layer.postings.find((p) => p.kommuneName === 'Varde');
    expect(varde).toMatchObject({ approximate: true, alsoIn: ['Esbjerg'] });
    expect(new Set(layer.postings.map((p) => p.id)).size).toBe(2);
  });

  it('counts two sites in the same kommune once', () => {
    const layer = buildJobsLayer(
      [ad('two', 'Ernæringsassistent', { addresses: [SOLROED, { ...SOLROED, lat: 55.5215, lng: 12.2025 }] })],
      kommuner,
    );

    expect(countOf(layer, '0269')).toBe(1);
    expect(layer.postings).toHaveLength(2);
    expect(layer.postings.every((p) => p.alsoIn.length === 0)).toBe(true);
  });

  it('adds adverts up per kommune and orders the dots by kommune code and title', () => {
    const layer = buildJobsLayer(
      [
        ad('1', 'Køkkenmedarbejder', { addresses: [AARHUS] }),
        ad('2', 'Ernæringsassistent', { addresses: [AARHUS] }),
        ad('3', 'Ernæringsassistent', { addresses: [SOLROED] }),
      ],
      kommuner,
    );

    expect(countOf(layer, '0751')).toBe(2);
    expect(layer.postings.map((p) => `${p.kommuneName}:${p.title}`)).toEqual([
      'Solrød:Ernæringsassistent', // 0269
      'Aarhus:Ernæringsassistent', // 0751
      'Aarhus:Køkkenmedarbejder',
    ]);
  });

  it('is empty, not broken, for no adverts', () => {
    const layer = buildJobsLayer([], kommuner);

    expect(layer.total).toBe(0);
    expect(layer.postings).toEqual([]);
    expect(layer.choropleth.features.every((f) => f.properties.count === 0)).toBe(true);
  });

  it('survives the JSON round trip the API puts it through', () => {
    const layer = buildJobsLayer([ad('a', 'Ernæringsassistent', { addresses: [SOLROED] })], kommuner);

    expect(JSON.parse(JSON.stringify(layer))).toEqual(layer);
  });
});
