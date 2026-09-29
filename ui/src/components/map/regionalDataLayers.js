/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Denmark-only optional overlays: a kommune-level tax choropleth (kommuneskat + grundskyld),
 * school markers coloured by kind of school, and supermarkets coloured by chain. Both are fed by `lib/services/regionalData/`
 * through `/api/regional-data/dk/*` and are off by default - see `Map.jsx` for the fetch-on-toggle
 * wiring, `MapControls.jsx` for the tax switch and `SchoolPanel.jsx` for everything about schools.
 *
 * Same shape as `overlayLayers.js`: free of React, only talks to the MapLibre map instance handed
 * in, `apply*` idempotent in both directions so it can be replayed on every `styledata`.
 */

import { SCHOOL_CATEGORIES, categoryColor, categoryOf } from './schoolFilters.js';
import { GROCERY_CHAINS, chainColor, chainOf } from './groceryFilters.js';

export const TAX_SOURCE_ID = 'dk-kommune-tax';
export const TAX_FILL_LAYER_ID = 'dk-kommune-tax-fill';
export const TAX_OUTLINE_LAYER_ID = 'dk-kommune-tax-outline';

export const SCHOOL_SOURCE_ID = 'dk-schools';
export const SCHOOL_LAYER_ID = 'dk-schools-points';

export const GROCERY_SOURCE_ID = 'dk-groceries';
export const GROCERY_LAYER_ID = 'dk-groceries-points';

/**
 * Kommuneskat stops, in percent. Denmark's 98 municipalities have run roughly 22.5-27.8 % for years;
 * chosen as fixed stops rather than derived from the fetched min/max so the colour of "24 %" does not
 * change depending on which other municipalities happened to load with it.
 */
const TAX_COLOR_STOPS = [22.5, '#fef0d9', 24, '#fdcc8a', 25.5, '#fc8d59', 27, '#e34a33', 28, '#b30000'];

/**
 * Adds or removes the tax choropleth.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {{type: 'FeatureCollection', features: Array<Object>}|null} data - `null` (or an empty
 *   collection) removes the layer, same as every `apply*` overlay in this app.
 */
export function applyTaxLayer(map, data) {
  if (map == null) return;

  if (data == null || data.features.length === 0) {
    removeTaxLayer(map);
    return;
  }

  const existing = map.getSource(TAX_SOURCE_ID);
  if (existing != null) {
    existing.setData(data);
  } else {
    map.addSource(TAX_SOURCE_ID, { type: 'geojson', data });
  }

  if (map.getLayer(TAX_FILL_LAYER_ID) == null) {
    map.addLayer({
      id: TAX_FILL_LAYER_ID,
      type: 'fill',
      source: TAX_SOURCE_ID,
      paint: {
        'fill-color': ['interpolate', ['linear'], ['get', 'kommuneskatPct'], ...TAX_COLOR_STOPS],
        'fill-opacity': 0.55,
      },
    });
  }

  if (map.getLayer(TAX_OUTLINE_LAYER_ID) == null) {
    map.addLayer({
      id: TAX_OUTLINE_LAYER_ID,
      type: 'line',
      source: TAX_SOURCE_ID,
      paint: { 'line-color': '#7a7a7a', 'line-width': 0.75, 'line-opacity': 0.6 },
    });
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 */
export function removeTaxLayer(map) {
  if (map == null) return;
  for (const id of [TAX_FILL_LAYER_ID, TAX_OUTLINE_LAYER_ID]) {
    if (map.getLayer(id) != null) map.removeLayer(id);
  }
  if (map.getSource(TAX_SOURCE_ID) != null) map.removeSource(TAX_SOURCE_ID);
}

/**
 * @param {Array<import('../../services/regionalData/regionalData.js').SchoolStat>} schools
 * @returns {{type: 'FeatureCollection', features: Array<Object>}}
 */
export function schoolsToGeoJson(schools) {
  return {
    type: 'FeatureCollection',
    features: schools.map((school) => ({
      type: 'Feature',
      id: school.id,
      geometry: { type: 'Point', coordinates: [school.lng, school.lat] },
      properties: {
        name: school.name,
        schoolType: school.schoolType,
        category: categoryOf(school),
        isSpecialSchool: school.isSpecialSchool === true,
        inclusionPct: school.inclusionPct,
        specialClassPct: school.specialClassPct,
        pupils: school.pupils,
        gradeAverage: school.gradeAverage,
        schoolYear: school.schoolYear,
        gradeYear: school.gradeYear,
        address: school.address,
        website: school.website,
      },
    })),
  };
}

/**
 * Adds or removes the school markers.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {Array<Object>|null} schools - Raw `SchoolStat` list, or `null`/empty to remove the layer.
 */
export function applySchoolLayer(map, schools) {
  if (map == null) return;

  if (schools == null || schools.length === 0) {
    removeSchoolLayer(map);
    return;
  }

  const data = schoolsToGeoJson(schools);
  const existing = map.getSource(SCHOOL_SOURCE_ID);
  if (existing != null) {
    existing.setData(data);
  } else {
    map.addSource(SCHOOL_SOURCE_ID, { type: 'geojson', data });
  }

  if (map.getLayer(SCHOOL_LAYER_ID) == null) {
    map.addLayer({
      id: SCHOOL_LAYER_ID,
      type: 'circle',
      source: SCHOOL_SOURCE_ID,
      paint: {
        // Coloured by kind of school, from the same table the panel's legend is drawn from, so the two
        // cannot disagree. Inclusion is in the popup rather than on the marker: colour is carrying the
        // kind, and one marker cannot carry two scales legibly.
        'circle-color': [
          'match',
          ['get', 'category'],
          ...SCHOOL_CATEGORIES.filter((category) => category.id !== 'other').flatMap((category) => [
            category.id,
            category.color,
          ]),
          categoryColor('other'),
        ],
        // A special school a little larger: it is the offer being looked for, and it should not vanish
        // among two thousand ordinary markers.
        'circle-radius': ['case', ['==', ['get', 'category'], 'special'], 8, 6],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 */
export function removeSchoolLayer(map) {
  if (map == null) return;
  if (map.getLayer(SCHOOL_LAYER_ID) != null) map.removeLayer(SCHOOL_LAYER_ID);
  if (map.getSource(SCHOOL_SOURCE_ID) != null) map.removeSource(SCHOOL_SOURCE_ID);
}

/**
 * @param {Array<import('../../services/regionalData/regionalData.js').GroceryStore>} stores
 * @returns {{type: 'FeatureCollection', features: Array<Object>}}
 */
export function groceriesToGeoJson(stores) {
  return {
    type: 'FeatureCollection',
    features: stores.map((store) => ({
      type: 'Feature',
      id: store.id,
      geometry: { type: 'Point', coordinates: [store.lng, store.lat] },
      properties: { name: store.name, brand: store.brand, chain: chainOf(store) },
    })),
  };
}

/**
 * Adds or removes the supermarket markers.
 *
 * Smaller than the school markers and drawn underneath them: there are more of them, and where the
 * two layers are on together the schools are what is being looked for.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {Array<Object>|null} stores - Raw store list, or `null`/empty to remove the layer.
 */
export function applyGroceryLayer(map, stores) {
  if (map == null) return;

  if (stores == null || stores.length === 0) {
    removeGroceryLayer(map);
    return;
  }

  const data = groceriesToGeoJson(stores);
  const existing = map.getSource(GROCERY_SOURCE_ID);
  if (existing != null) {
    existing.setData(data);
  } else {
    map.addSource(GROCERY_SOURCE_ID, { type: 'geojson', data });
  }

  if (map.getLayer(GROCERY_LAYER_ID) == null) {
    map.addLayer(
      {
        id: GROCERY_LAYER_ID,
        type: 'circle',
        source: GROCERY_SOURCE_ID,
        paint: {
          // From the same table the panel's legend is drawn from, so the two cannot disagree.
          'circle-color': [
            'match',
            ['get', 'chain'],
            ...GROCERY_CHAINS.filter((chain) => chain.id !== 'other').flatMap((chain) => [chain.id, chain.color]),
            chainColor('other'),
          ],
          'circle-radius': 5,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
        },
      },
      // Under the schools when they are already there.
      map.getLayer(SCHOOL_LAYER_ID) != null ? SCHOOL_LAYER_ID : undefined,
    );
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 */
export function removeGroceryLayer(map) {
  if (map == null) return;
  if (map.getLayer(GROCERY_LAYER_ID) != null) map.removeLayer(GROCERY_LAYER_ID);
  if (map.getSource(GROCERY_SOURCE_ID) != null) map.removeSource(GROCERY_SOURCE_ID);
}
