/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { findElements, coordsOf } from '../poi/overpassClient.js';
import { chainOf } from './groceryChains.js';
import logger from '../logger.js';

/**
 * @typedef {Object} GroceryStore
 * @property {string} id - OSM element, `node/123`, unique across the three element kinds.
 * @property {string} name - The store's name, else its brand or operator; empty when it has none.
 * @property {string|null} brand
 * @property {string} chain - A chain id from `groceryChains.js`.
 * @property {number} lat
 * @property {number} lng
 */

/**
 * Every supermarket in Denmark.
 *
 * `nwr` because a supermarket is a node in one town and a building outline in the next, and
 * `out center` collapses either to a point. Country-wide, so the budget is far beyond the ten seconds
 * of a bounded `around` search: this is asked once per cache period, not once per view.
 */
const QUERY = `[out:json][timeout:90];
area["ISO3166-1"="DK"][admin_level=2]->.dk;
nwr["shop"="supermarket"](area.dk);
out center;`;

/** A little longer than the query's own budget, so Overpass gives up before we do. */
const REQUEST_TIMEOUT_MS = 100_000;

const text = (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null);

/**
 * @param {Object} element One Overpass element.
 * @returns {GroceryStore|null} Null for anything without a position.
 */
export function toStore(element) {
  const coords = coordsOf(element);
  if (coords == null || element?.type == null || element?.id == null) return null;

  const tags = element.tags ?? {};
  const brand = text(tags.brand);
  return {
    id: `${element.type}/${element.id}`,
    name: text(tags.name) ?? brand ?? text(tags.operator) ?? '',
    brand,
    chain: chainOf(tags),
    lat: coords.lat,
    lng: coords.lng,
  };
}

/**
 * All Danish supermarkets from OpenStreetMap.
 *
 * @returns {Promise<GroceryStore[]|null>} `null` when Overpass could not be asked or did not answer,
 *   which is not the same as an empty list and must not be cached as one.
 */
export async function fetchGroceryStores() {
  const elements = await findElements(QUERY, { requestTimeoutMs: REQUEST_TIMEOUT_MS });
  if (elements == null) {
    logger.warn('Could not fetch the Danish supermarkets from Overpass.');
    return null;
  }
  return elements.map(toStore).filter((store) => store != null);
}
