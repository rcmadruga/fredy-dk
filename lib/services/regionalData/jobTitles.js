/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Which job adverts count as "ernæringsassistent work", judged from the advert's headline alone.
 *
 * An ernæringsassistent is trained for large kitchens, so the adverts that suit one are advertised
 * under many titles: the exact one, `køkkenassistent`, `kostfaglig medarbejder`, a plain
 * `køkkenmedarbejder`. Two tiers keep that visible instead of hiding it in one regex:
 *
 *  - `exact`   the title names the profession (ernæring-, køkkenassistent, kostassistent).
 *  - `kitchen` the title is some other kitchen or canteen job (køkken-, kost-, kok, cater, kantine, mad...).
 *
 * Both are counted by the map; the tier is kept so a strict view can be offered later without
 * fetching anything again. Apprentice posts are never counted - they are not jobs for someone already
 * qualified - and neither are leadership-only and cleaning titles, which share the kitchen's
 * vocabulary without being its work. An advert that names the profession wins over those exclusions,
 * so `Køkkenleder/-ernæringsassistent` stays in.
 *
 * Headlines are all there is to go on: the search result carries no structured occupation. Adverts
 * with a generic headline ("Vil du skabe gode måltider?") are missed on purpose rather than guessed at.
 */

/** The profession itself. */
const EXACT = /ernæring|ernaering|køkkenassistent|kostassistent/i;

/** Other kitchen and canteen work. */
const KITCHEN =
  /køkken|kost|\bkok\b|kokke|cater|kantine|smørrebrød|forplejning|måltid|\bmad(?:glad|glæde|håndværker)?\b|\bmad\b/i;

/** Training posts: elev, elever, elevstilling, caterelev, gastronomelev, praktikant, lærling. */
const APPRENTICE = /elev(?:er|en|stilling)?(?![a-zæøå])|praktikant|lærling/i;

/** Words that make a kitchen headline a management or cleaning job rather than kitchen work. */
const NOT_KITCHEN_WORK =
  /\bleder\b|kantineleder|køkkenleder|souschef|\bchef\b|funktionsleder|koordinator|husassistent|opvask|rengøring/i;

/**
 * @typedef {'exact'|'kitchen'} JobTier
 */

/**
 * @param {string|null|undefined} headline
 * @returns {JobTier|null} `null` when the advert is not ernæringsassistent work or is an apprentice post.
 */
export function classifyJobTitle(headline) {
  const title = typeof headline === 'string' ? headline.trim() : '';
  if (title === '' || APPRENTICE.test(title)) {
    return null;
  }
  if (EXACT.test(title)) {
    return 'exact';
  }
  if (KITCHEN.test(title) && !NOT_KITCHEN_WORK.test(title)) {
    return 'kitchen';
  }
  return null;
}
