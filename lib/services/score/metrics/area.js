/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The Area group: where the listing is, as opposed to what it is. `grocery` and `park` read the
 * place-type travel times the sweeper already measures; the rest need sources that are not built yet
 * and are registered as placeholders that score missing.
 */

/** Walking pace in km/h, and the factor from a straight line to the walkable route. */
const WALKING_KMH = 5;
const DETOUR_FACTOR = 1.3;

/**
 * Walking minutes for a straight-line distance, with a detour factor. Only used where no routed
 * journey exists (the supermarket layer's fallback), and an estimate by nature.
 *
 * @param {number} meters
 * @returns {number}
 */
export function walkingMinutesFor(meters) {
  return Math.round(((meters * DETOUR_FACTOR) / 1000 / WALKING_KMH) * 60);
}

/**
 * Walking minutes to the nearest place of a type, from the listing's stored place-type journeys.
 *
 * The category is what the journey was measured for (`place.category`), not its label: the label
 * is whatever the user called the address.
 *
 * @param {Object} listing
 * @param {string} category A place category id such as `supermarket` or `park`.
 * @returns {number|null}
 */
export function walkMinutesToPlace(listing, category) {
  const entries = Array.isArray(listing?.travelTimes) ? listing.travelTimes : [];
  const minutes = entries
    .filter((entry) => entry?.place?.category === category)
    .map((entry) => entry?.walk?.minutes)
    .filter((value) => Number.isFinite(value));
  return minutes.length === 0 ? null : Math.min(...minutes);
}

/** @type {import('./types.js').MetricDescriptor[]} */
export const AREA_METRICS = [
  {
    id: 'grocery',
    group: 'area',
    labelKey: 'score.metric.area.grocery',
    unit: 'min',
    direction: 'lower',
    raw: (listing, ctx) => {
      const routed = walkMinutesToPlace(listing, 'supermarket');
      if (routed != null) return routed;
      // The Danish supermarket layer answers where no journey was measured: a straight line.
      return Number.isFinite(ctx?.nearestSupermarketMeters) ? walkingMinutesFor(ctx.nearestSupermarketMeters) : null;
    },
    defaults: () => ({ ideal: 5, worst: 20 }),
  },
  {
    id: 'park',
    group: 'area',
    labelKey: 'score.metric.area.park',
    unit: 'min',
    direction: 'lower',
    raw: (listing) => walkMinutesToPlace(listing, 'park'),
    defaults: () => ({ ideal: 5, worst: 20 }),
  },
  {
    // TODO(Phase C, step 16): share of green area within 500 m, from the Overpass sweeper.
    id: 'green',
    group: 'area',
    labelKey: 'score.metric.area.green',
    unit: 'pct',
    direction: 'higher',
    raw: () => null,
    defaults: () => ({ ideal: 30, worst: 5 }),
  },
  {
    // TODO(Phase C, step 16): distance to the nearest motorway, trunk road or railway, from the
    // Overpass sweeper.
    id: 'quiet',
    group: 'area',
    labelKey: 'score.metric.area.quiet',
    unit: 'm',
    direction: 'higher',
    raw: () => null,
    defaults: () => ({ ideal: 500, worst: 50 }),
  },
  {
    // TODO(Phase C, step 15): the kommune's disposable income against the national median, from
    // Danmarks Statistik.
    id: 'social',
    group: 'area',
    labelKey: 'score.metric.area.social',
    unit: 'pct',
    direction: 'higher',
    qualifier: 'kommune',
    raw: () => null,
    defaults: () => ({ ideal: 10, worst: -10 }),
  },
  {
    // TODO(Phase C, step 15): reported crimes per 1,000 inhabitants in the kommune against the
    // national rate (percent above or below it), from Danmarks Statistik STRAF22.
    id: 'safety',
    group: 'area',
    labelKey: 'score.metric.area.safety',
    unit: 'pct',
    direction: 'lower',
    qualifier: 'kommune',
    raw: () => null,
    defaults: () => ({ ideal: -25, worst: 25 }),
  },
];
