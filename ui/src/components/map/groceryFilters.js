/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * What the Denmark supermarket layer can be narrowed by: which chains are shown.
 *
 * Free of React and MapLibre, like `schoolFilters.js`, so the rules can be tested as rules. The
 * server decides which chain a store belongs to (`lib/services/regionalData/groceryChains.js`); this
 * only knows how each one is coloured and whether it is switched on.
 */

/**
 * The chain groups, in the order the panel lists them. The colours are the Okabe-Ito set plus greys,
 * fixed so a chain keeps its colour whatever is filtered, and chosen not to collide with the school
 * markers' colours where the two layers are on together.
 *
 * @type {ReadonlyArray<{id: string, color: string}>}
 */
export const GROCERY_CHAINS = Object.freeze([
  { id: 'netto', color: '#f0c800' },
  { id: 'rema', color: '#d55e00' },
  { id: 'salling', color: '#cc79a7' },
  { id: 'coop', color: '#c1121f' },
  { id: 'lidl', color: '#56b4e9' },
  { id: 'aldi', color: '#264653' },
  { id: 'meny', color: '#2a9d8f' },
  { id: 'other', color: '#6b7280' },
]);

const CHAIN_IDS = GROCERY_CHAINS.map((chain) => chain.id);

/** The colour of a chain, and the grey of anything the map does not know. */
export const chainColor = (id) => GROCERY_CHAINS.find((chain) => chain.id === id)?.color ?? '#6b7280';

/**
 * @typedef {Object} GroceryFilters
 * @property {Record<string, boolean>} chains - Which chain groups are shown; a missing one is shown.
 */

/** @type {GroceryFilters} */
export const DEFAULT_GROCERY_FILTERS = Object.freeze({
  chains: Object.freeze(Object.fromEntries(CHAIN_IDS.map((id) => [id, true]))),
});

/**
 * @param {{chain?: string}} store
 * @returns {string} The store's chain id; anything the map does not know counts as `other`.
 */
export const chainOf = (store) => (CHAIN_IDS.includes(store?.chain) ? store.chain : 'other');

/**
 * @param {Array<Object>|null|undefined} stores
 * @param {GroceryFilters} filters
 * @returns {Array<Object>}
 */
export function filterStores(stores, filters) {
  return (stores ?? []).filter((store) => filters.chains[chainOf(store)] !== false);
}

/**
 * How many stores each chain has, for the panel's counts.
 *
 * @param {Array<Object>|null|undefined} stores
 * @returns {Record<string, number>}
 */
export function countByChain(stores) {
  const counts = Object.fromEntries(CHAIN_IDS.map((id) => [id, 0]));
  for (const store of stores ?? []) counts[chainOf(store)] += 1;
  return counts;
}

/**
 * Whether the filters differ from showing everything - what a "reset" would change.
 *
 * @param {GroceryFilters} filters
 * @returns {boolean}
 */
export const hasActiveGroceryFilters = (filters) => CHAIN_IDS.some((id) => filters.chains[id] === false);

/**
 * Reads filters back without trusting them: a hand-edited or older value must never be able to break
 * the panel or hide every store for no visible reason.
 *
 * @param {unknown} raw
 * @returns {GroceryFilters}
 */
export function sanitizeGroceryFilters(raw) {
  const value = raw != null && typeof raw === 'object' ? /** @type {Record<string, any>} */ (raw) : {};
  const stored = value.chains != null && typeof value.chains === 'object' ? value.chains : {};
  return {
    chains: Object.fromEntries(CHAIN_IDS.map((id) => [id, typeof stored[id] === 'boolean' ? stored[id] : true])),
  };
}

export const GROCERY_FILTERS_STORAGE_KEY = 'fredy.map.groceryFilters';

/**
 * A per-viewer preference, so it lives in the browser rather than in the URL. Every access is
 * guarded: storage can be missing, full or blocked, and the map must work without it.
 *
 * @returns {GroceryFilters}
 */
export function loadGroceryFilters() {
  try {
    return sanitizeGroceryFilters(JSON.parse(window.localStorage.getItem(GROCERY_FILTERS_STORAGE_KEY) ?? 'null'));
  } catch {
    return sanitizeGroceryFilters(null);
  }
}

/**
 * @param {GroceryFilters} filters
 */
export function saveGroceryFilters(filters) {
  try {
    window.localStorage.setItem(GROCERY_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Not remembering the filters is a small loss; failing to filter would be a large one.
  }
}
