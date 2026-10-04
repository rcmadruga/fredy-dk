/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { kommuneOfPoint, kommuneOfPostcode, postcodeInfo, resolvePlace } from '../geo/denmarkGeo.js';

/**
 * Where in Denmark a job advert is, as one or more kommuner.
 *
 * Three sources, most exact first, and the first that yields anything wins:
 *
 *  1. The advert's own coordinates, which are the workplace's address. Precise.
 *  2. The postcode of the workplace address. The postcode's centre, so approximate.
 *  3. The place text the advert shows (`3400 Hillerød`, `Varde eller Esbjerg`). Approximate; a list of
 *     places is split and kept only if every part names a Danish place, since a wrong kommune is worse
 *     than none.
 *
 * An advert in Greenland or the Faroes places nowhere (neither is in the bundled boundaries), and an
 * advert whose place cannot be read places nowhere either: it is left off the map, not guessed at.
 */

/**
 * @typedef {Object} AdAddress
 * @property {string|null} [zip]
 * @property {string|null} [city]
 * @property {number|null} [lat]
 * @property {number|null} [lng]
 */

/**
 * @typedef {Object} AdPlace
 * @property {string} kommuneCode
 * @property {string} kommuneName
 * @property {number} lat
 * @property {number} lng
 * @property {boolean} approximate True when the position is a postcode's or a town's centre, not the workplace.
 */

/** Separators between towns in an advert's place text: `Varde eller Esbjerg`, `A, B, C eller D`, `A/B`. */
const PLACE_SEPARATOR = /\s*(?:,|;|\/|\+|\beller\b|\bog\b)\s*/i;

/**
 * Splits `Herning, Holstebro, Skive eller Karup J` into its towns.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitPlaceText(text) {
  return String(text ?? '')
    .split(PLACE_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * @param {Array<AdAddress>} addresses
 * @returns {AdPlace[]}
 */
function fromCoordinates(addresses) {
  const places = [];
  for (const a of addresses) {
    if (!finite(a?.lat) || !finite(a?.lng)) continue;
    const kommune = kommuneOfPoint(a.lat, a.lng);
    if (kommune) {
      places.push({ kommuneCode: kommune.code, kommuneName: kommune.name, lat: a.lat, lng: a.lng, approximate: false });
    }
  }
  return places;
}

/**
 * @param {Array<AdAddress>} addresses
 * @returns {AdPlace[]}
 */
function fromPostcodes(addresses) {
  const places = [];
  for (const a of addresses) {
    if (!a?.zip) continue;
    const info = postcodeInfo(a.zip);
    const kommune = kommuneOfPostcode(a.zip);
    if (info && kommune) {
      places.push({
        kommuneCode: kommune.code,
        kommuneName: kommune.name,
        lat: info.lat,
        lng: info.lng,
        approximate: true,
      });
    }
  }
  return places;
}

/**
 * @param {string|null|undefined} text
 * @returns {AdPlace[]} Empty unless every part of the text names a Danish place.
 */
function fromPlaceText(text) {
  const parts = splitPlaceText(text);
  if (parts.length === 0) return [];
  const resolved = parts.map((part) => resolvePlace(part));
  if (resolved.some((place) => place == null)) return [];
  return resolved.map((place) => ({
    kommuneCode: place.kommuneCode,
    kommuneName: place.kommuneName,
    lat: place.lat,
    lng: place.lng,
    approximate: true,
  }));
}

/**
 * Keeps one place per spot: two addresses in the same kommune are one place for counting, and the
 * same position twice is one dot.
 *
 * @param {AdPlace[]} places
 * @returns {AdPlace[]}
 */
function distinct(places) {
  const seen = new Set();
  return places.filter((p) => {
    const key = `${p.kommuneCode}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {{addresses?: Array<AdAddress>, area?: string|null}} ad
 * @returns {AdPlace[]} Empty when the advert cannot be placed.
 */
export function placeAd(ad) {
  const addresses = Array.isArray(ad?.addresses) ? ad.addresses : [];
  const places = fromCoordinates(addresses);
  if (places.length > 0) return distinct(places);
  const byPostcode = fromPostcodes(addresses);
  if (byPostcode.length > 0) return distinct(byPostcode);
  return distinct(fromPlaceText(ad?.area ?? addresses[0]?.city));
}
