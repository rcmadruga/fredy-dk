/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Denmark-only optional overlays: a kommune-level tax choropleth (kommuneskat + grundskyld),
 * school markers coloured by kind of school, supermarkets coloured by chain, and jobs (a choropleth of adverts per kommune and a dot per advert). All are fed by `lib/services/regionalData/`
 * through `/api/regional-data/dk/*` and are off by default - see `Map.jsx` for the fetch-on-toggle
 * wiring, `MapControls.jsx` for the tax switch and `SchoolPanel.jsx` for everything about schools.
 *
 * Same shape as `overlayLayers.js`: free of React, only talks to the MapLibre map instance handed
 * in, `apply*` idempotent in both directions so it can be replayed on every `styledata`.
 */

import { SCHOOL_CATEGORIES, categoryColor, categoryOf } from './schoolFilters.js';
import { chainOf } from './groceryFilters.js';
import { addGroceryIcons, loadGroceryIcons } from './groceryIcons.js';

export const TAX_SOURCE_ID = 'dk-kommune-tax';
export const TAX_FILL_LAYER_ID = 'dk-kommune-tax-fill';
export const TAX_OUTLINE_LAYER_ID = 'dk-kommune-tax-outline';

export const SCHOOL_SOURCE_ID = 'dk-schools';
export const SCHOOL_LAYER_ID = 'dk-schools-points';

export const GROCERY_SOURCE_ID = 'dk-groceries';
export const GROCERY_LAYER_ID = 'dk-groceries-points';

export const JOBS_AREA_SOURCE_ID = 'dk-jobs-kommuner';
export const JOBS_FILL_LAYER_ID = 'dk-jobs-kommuner-fill';
export const JOBS_OUTLINE_LAYER_ID = 'dk-jobs-kommuner-outline';

export const JOBS_POINT_SOURCE_ID = 'dk-jobs-postings';
export const JOBS_POINT_LAYER_ID = 'dk-jobs-postings-points';

/**
 * How many adverts a kommune needs to reach each shade, and the shade. With a few dozen adverts
 * spread over the country most kommuners have none, one or two, so the steps are fine at the bottom
 * and open-ended at the top. Fixed, like the tax stops, so a colour means the same count whatever else
 * loaded with it. `0` is no fill at all: a kommune with no jobs should look empty, not pale.
 *
 * Exported for the panel's legend, which has to say the same thing as the map.
 */
export const JOB_COUNT_STEPS = Object.freeze([
  { min: 1, color: '#d9f0d3' },
  { min: 2, color: '#a6dba0' },
  { min: 3, color: '#5aae61' },
  { min: 5, color: '#1b7837' },
  { min: 10, color: '#00441b' },
]);

/** The dot of an advert at the workplace's own address, and the outline of one at a postcode's centre. */
export const JOB_POINT_COLOR = '#1b7837';

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
 * Adds or removes the supermarket badges.
 *
 * Drawn as a symbol layer of small square logo badges (see `groceryIcons.js`), under the school
 * markers when those are already there: there are more of them, and where the two layers are on
 * together the schools are what is being looked for. The pins are smaller when zoomed out, where two
 * thousand of them would otherwise be a wall.
 *
 * Async because the pins have to be rasterised before the layer can name them; the first call pays
 * for that and the rest find them ready. Removal stays synchronous.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {Array<Object>|null} stores - Raw store list, or `null`/empty to remove the layer.
 * @param {Object} [options]
 * @param {Promise<Map<string, ImageData>>} [options.icons] - Where the pin pixels come from; the
 *   browser rasterisation by default, replaceable so the layer can be tested without a canvas.
 * @param {() => boolean} [options.shouldApply] - Asked again once the pins are ready, so a layer
 *   switched off in the meantime is not added back by a call that was already waiting.
 * @returns {Promise<void>}
 */
export async function applyGroceryLayer(map, stores, { icons = loadGroceryIcons(), shouldApply = () => true } = {}) {
  if (map == null) return;

  if (stores == null || stores.length === 0) {
    removeGroceryLayer(map);
    return;
  }

  const pins = await icons;
  if (!shouldApply()) return;
  addGroceryIcons(map, pins);

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
        type: 'symbol',
        source: GROCERY_SOURCE_ID,
        layout: {
          'icon-image': ['concat', 'dk-grocery-', ['get', 'chain']],
          // Centred on the store, and never hidden where they overlap: there are enough of them that
          // dropping the ones in the way would drop stores.
          'icon-anchor': 'center',
          'icon-allow-overlap': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 11, 0.75, 14, 1],
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

/**
 * Adds or removes the jobs-by-kommune choropleth.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {{type: 'FeatureCollection', features: Array<Object>}|null} data - The server's `choropleth`:
 *   every kommune with a `count`. `null` (or an empty collection) removes the layer.
 */
export function applyJobsAreaLayer(map, data) {
  if (map == null) return;

  if (data == null || data.features.length === 0) {
    removeJobsAreaLayer(map);
    return;
  }

  const existing = map.getSource(JOBS_AREA_SOURCE_ID);
  if (existing != null) {
    existing.setData(data);
  } else {
    map.addSource(JOBS_AREA_SOURCE_ID, { type: 'geojson', data });
  }

  if (map.getLayer(JOBS_FILL_LAYER_ID) == null) {
    map.addLayer({
      id: JOBS_FILL_LAYER_ID,
      type: 'fill',
      source: JOBS_AREA_SOURCE_ID,
      paint: {
        'fill-color': [
          'step',
          ['get', 'count'],
          'rgba(0, 0, 0, 0)',
          ...JOB_COUNT_STEPS.flatMap((step) => [step.min, step.color]),
        ],
        'fill-opacity': 0.65,
      },
    });
  }

  if (map.getLayer(JOBS_OUTLINE_LAYER_ID) == null) {
    map.addLayer({
      id: JOBS_OUTLINE_LAYER_ID,
      type: 'line',
      source: JOBS_AREA_SOURCE_ID,
      paint: { 'line-color': '#7a7a7a', 'line-width': 0.75, 'line-opacity': 0.6 },
    });
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 */
export function removeJobsAreaLayer(map) {
  if (map == null) return;
  for (const id of [JOBS_FILL_LAYER_ID, JOBS_OUTLINE_LAYER_ID]) {
    if (map.getLayer(id) != null) map.removeLayer(id);
  }
  if (map.getSource(JOBS_AREA_SOURCE_ID) != null) map.removeSource(JOBS_AREA_SOURCE_ID);
}

/**
 * @param {Array<import('../../services/regionalData/regionalData.js').JobPosting>} postings
 * @returns {{type: 'FeatureCollection', features: Array<Object>}}
 */
export function jobsToGeoJson(postings) {
  return {
    type: 'FeatureCollection',
    features: postings.map((posting) => ({
      type: 'Feature',
      id: posting.id,
      geometry: { type: 'Point', coordinates: [posting.lng, posting.lat] },
      properties: {
        title: posting.title,
        employer: posting.employer,
        url: posting.url,
        lastDate: posting.lastDate,
        tier: posting.tier,
        kommuneName: posting.kommuneName,
        approximate: posting.approximate === true,
        // MapLibre hands nested values back as JSON strings on a click, so the list is carried as text.
        alsoIn: (posting.alsoIn ?? []).join(', '),
      },
    })),
  };
}

/**
 * Adds or removes the job dots: solid where the position is the workplace's own address, a ring where
 * it is only the centre of a postcode or a town, so a dot is never taken for more exact than it is.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {Array<Object>|null} postings - The server's `postings`, or `null`/empty to remove the layer.
 */
export function applyJobsPointLayer(map, postings) {
  if (map == null) return;

  if (postings == null || postings.length === 0) {
    removeJobsPointLayer(map);
    return;
  }

  const data = jobsToGeoJson(postings);
  const existing = map.getSource(JOBS_POINT_SOURCE_ID);
  if (existing != null) {
    existing.setData(data);
  } else {
    map.addSource(JOBS_POINT_SOURCE_ID, { type: 'geojson', data });
  }

  if (map.getLayer(JOBS_POINT_LAYER_ID) == null) {
    map.addLayer({
      id: JOBS_POINT_LAYER_ID,
      type: 'circle',
      source: JOBS_POINT_SOURCE_ID,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.5, 10, 6, 14, 8],
        'circle-color': ['case', ['get', 'approximate'], '#ffffff', JOB_POINT_COLOR],
        'circle-opacity': ['case', ['get', 'approximate'], 0.55, 0.95],
        'circle-stroke-color': ['case', ['get', 'approximate'], JOB_POINT_COLOR, '#ffffff'],
        'circle-stroke-width': ['case', ['get', 'approximate'], 2, 1.5],
      },
    });
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 */
export function removeJobsPointLayer(map) {
  if (map == null) return;
  if (map.getLayer(JOBS_POINT_LAYER_ID) != null) map.removeLayer(JOBS_POINT_LAYER_ID);
  if (map.getSource(JOBS_POINT_SOURCE_ID) != null) map.removeSource(JOBS_POINT_SOURCE_ID);
}
