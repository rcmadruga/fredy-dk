/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Which chain a Danish supermarket belongs to, as far as the map cares.
 *
 * OpenStreetMap spells the same chain many ways (`Netto`, `Netto Marken`, `Rema 1000`, `REMA1000`,
 * `Dagli'Brugsen`, `SuperBrugsen`), so the map groups them into a few families rather than showing
 * hundreds of labels. The groups are the ones a person shopping thinks in: the discounters, the two
 * big groups (Salling and Coop), and the rest. The ids are what the browser filters and colours by;
 * their labels and colours live in `ui/src/components/map/groceryFilters.js`, since the UI may not
 * import server code.
 */

/**
 * In the order they are tried, most specific first. A pattern matches against the lower-cased
 * `brand`, `name` and `operator` tags joined together, so a store tagged only by its name is still
 * found.
 *
 * @type {ReadonlyArray<{id: string, pattern: RegExp}>}
 */
const CHAINS = Object.freeze([
  { id: 'netto', pattern: /\bnetto\b/ },
  { id: 'rema', pattern: /\brema\b|\brema ?1000\b/ },
  { id: 'lidl', pattern: /\blidl\b/ },
  { id: 'aldi', pattern: /\baldi\b/ },
  { id: 'meny', pattern: /\bmeny\b/ },
  { id: 'salling', pattern: /f[øo]tex|\bbilka\b|\bsalling\b/ },
  // The Brugsen family is one cooperative under many shopfront names; Irma and 365discount are Coop's too.
  { id: 'coop', pattern: /brugsen|kvickly|\birma\b|365 ?discount|\bcoop\b|\bfakta\b/ },
]);

/** Every id the classifier can answer with, `other` included. */
export const CHAIN_IDS = Object.freeze([...CHAINS.map((chain) => chain.id), 'other']);

/**
 * @param {{brand?: unknown, name?: unknown, operator?: unknown}|null|undefined} tags OSM tags.
 * @returns {string} A chain id; `other` for anything unrecognised, unbranded or independent.
 */
export function chainOf(tags) {
  const haystack = [tags?.brand, tags?.name, tags?.operator]
    .filter((value) => typeof value === 'string')
    .join(' | ')
    .toLowerCase();
  return CHAINS.find((chain) => chain.pattern.test(haystack))?.id ?? 'other';
}
