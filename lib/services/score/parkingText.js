/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Parking, read off the advert text. A heuristic and always labelled as an estimate: an advert is
 * not a register, and what it leaves out is not evidence either way.
 *
 * Case-insensitive match over the title and description:
 *
 *  - Danish: `carport`, `garage`, `p-plads`, `parkeringsplads`, `egen parkering`
 *  - German: `Stellplatz`, `Garage`, `Tiefgarage`, `Carport`
 *  - English: `parking`
 *
 * Matched as substrings rather than whole words, because German builds its nouns by compounding
 * (`Tiefgaragenstellplatz`, `Einzelgarage`, `Stellplätze`) and a whole-word match would miss most of
 * them. A negation (`ingen parkering`, `kein Stellplatz`) says there is none, and scores 0. No
 * match at all is `null`, not 0: an advert's silence says nothing.
 */

/** What says there is parking. */
const PARKING = String.raw`(?:carport|garage|p-plads|parkeringsplads|parkering|stellplatz|stellplätze|stellplaetze|parkplatz|parkplätze|parking)`;

/**
 * Negators in the three languages, followed by up to two filler words before the parking term:
 * "kein eigener Stellplatz", "ingen egen parkering", "no off-street parking".
 */
const NEGATED_BEFORE = new RegExp(
  String.raw`\b(?:ingen|uden|kein|keine|keinen|keiner|ohne|no|without)\s+(?:[\p{L}-]+\s+){0,2}?[\p{L}-]*${PARKING}`,
  'giu',
);

/** The same said afterwards: "Stellplatz nicht vorhanden", "parkering ikke muligt". */
const NEGATED_AFTER = new RegExp(
  String.raw`[\p{L}-]*${PARKING}[\p{L}-]*\s+(?:nicht\s+(?:vorhanden|möglich|moeglich)|ikke\s+mulig(?:t)?|not\s+(?:available|included))`,
  'giu',
);

const POSITIVE = new RegExp(PARKING, 'iu');

/**
 * Whether an advert mentions parking.
 *
 * @param {string|null|undefined} text Title and description, in any order.
 * @returns {1|0|null} `1` when parking is mentioned, `0` when the advert says there is none, `null`
 *   when it says nothing. A mention outside any negation wins over a negation elsewhere in the text.
 */
export function parkingFromText(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const withoutNegations = text.replace(NEGATED_BEFORE, ' ').replace(NEGATED_AFTER, ' ');
  if (POSITIVE.test(withoutNegations)) return 1;
  // Something was cut out above and nothing positive is left: the advert says there is none.
  return withoutNegations.length < text.length ? 0 : null;
}

/**
 * Parking for a listing row, from its title and description.
 *
 * @param {{title?: string|null, description?: string|null}|null|undefined} listing
 * @returns {1|0|null}
 */
export function parkingForListing(listing) {
  return parkingFromText([listing?.title, listing?.description].filter((part) => typeof part === 'string').join('\n'));
}
