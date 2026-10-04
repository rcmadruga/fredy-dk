/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { classifyJobTitle } from './jobTitles.js';
import { placeAd } from './jobPlacement.js';

/**
 * @typedef {Object} JobPosting One dot on the map: an advert at one place.
 * @property {string} id Unique per dot (`<advert id>@<kommune code>`), so a multi-town advert has one per town.
 * @property {string} adId
 * @property {string} title
 * @property {string} employer
 * @property {string|null} url The advert on Jobindex.
 * @property {string|null} firstDate
 * @property {string|null} lastDate Application deadline.
 * @property {'exact'|'kitchen'} tier Whether the title names the profession or is other kitchen work.
 * @property {string} kommuneCode
 * @property {string} kommuneName
 * @property {number} lat
 * @property {number} lng
 * @property {boolean} approximate True when the dot is a postcode's or a town's centre, not the workplace.
 * @property {string[]} alsoIn Names of the other kommuner the same advert lists; empty for most.
 */

/**
 * What the jobs layer shows, worked out from the adverts.
 *
 * Derived on every read from the raw adverts, never stored: the title rules and the placement are
 * ours and will change, and a cache holding their old answers would keep serving them for weeks (see
 * the note on `GROCERY_CACHE_KEY`).
 *
 *  - `postings`: a dot per advert and place, for the map's postings layer.
 *  - `choropleth`: every kommune, with `count` = the number of distinct adverts placed in it (zero
 *    included, so the shading can say "none"). An advert listing two towns counts once in each, so the
 *    kommune counts can add up to more than `total`.
 *
 * @param {Array<import('./jobsClient.js').RawJobAd>} ads
 * @param {Array<{code: string, name: string, geometry: Object}>} kommuner
 * @returns {{total: number, postings: JobPosting[], choropleth: {type: 'FeatureCollection', features: Array<Object>}}}
 */
export function buildJobsLayer(ads, kommuner) {
  /** @type {JobPosting[]} */
  const postings = [];
  const counts = new Map();
  let total = 0;

  for (const ad of ads) {
    const tier = classifyJobTitle(ad.title);
    if (tier == null) continue;
    const places = placeAd(ad);
    if (places.length === 0) continue;

    total += 1;
    const names = [...new Set(places.map((p) => p.kommuneName))];
    for (const code of new Set(places.map((p) => p.kommuneCode))) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    for (const place of places) {
      postings.push({
        id: `${ad.id}@${place.kommuneCode}`,
        adId: ad.id,
        title: ad.title,
        employer: ad.employer,
        url: ad.url,
        firstDate: ad.firstDate,
        lastDate: ad.lastDate,
        tier,
        kommuneCode: place.kommuneCode,
        kommuneName: place.kommuneName,
        lat: place.lat,
        lng: place.lng,
        approximate: place.approximate,
        alsoIn: names.filter((n) => n !== place.kommuneName),
      });
    }
  }

  // By kommune code, not name: Danish collation files `Aarhus` under `Å`, and nothing here is read as a list.
  postings.sort((a, b) => a.kommuneCode.localeCompare(b.kommuneCode) || a.title.localeCompare(b.title, 'da'));

  return {
    total,
    postings,
    choropleth: {
      type: 'FeatureCollection',
      features: kommuner.map((k) => ({
        type: 'Feature',
        id: k.code,
        geometry: k.geometry,
        properties: { code: k.code, name: k.name, count: counts.get(k.code) ?? 0 },
      })),
    },
  };
}
