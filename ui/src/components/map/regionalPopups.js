/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { escapeHtml } from './escapeHtml.js';

/**
 * The popup markup for the two Denmark layers, as plain HTML strings.
 *
 * Kept out of `Map.jsx` and free of MapLibre so it can be tested on its own. Everything that came
 * from outside - a school's name, its address, its website - goes through `escapeHtml`: the names are
 * typed into a public register, and a popup set with `setHTML` would otherwise run whatever one held.
 */

const percent = (value, t) => (value == null ? t('common.na') : `${Number(value).toFixed(1)}%`);
const perMille = (value, t) => (value == null ? t('common.na') : `${Number(value).toFixed(1)}‰`);

/**
 * @param {string|null|undefined} url
 * @returns {string|null} The URL when it is http(s), null for anything a link must not point at
 *   (`javascript:` and friends).
 */
function safeHttpUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * @param {{name: string, kommuneskatPct?: number|null, grundskyldPromille?: number|null}} properties
 * @param {(key: string) => string} t
 * @returns {string}
 */
export function buildTaxPopupHtml(properties, t) {
  return (
    `<div class="map-popup-content"><h4>${escapeHtml(properties.name)}</h4>` +
    `<p>${t('map.taxPopupKommuneskat')}: ${percent(properties.kommuneskatPct, t)}</p>` +
    `<p>${t('map.taxPopupGrundskyld')}: ${perMille(properties.grundskyldPromille, t)}</p></div>`
  );
}

/**
 * A special school leads with what it is and shows no inclusion figures: its inclusion is nil by
 * definition, so printing "0.0%" beside it would read as a poor result rather than as the offer it is.
 *
 * @param {Object} properties A school feature's properties, see `schoolsToGeoJson`.
 * @param {(key: string) => string} t
 * @returns {string}
 */
export function buildSchoolPopupHtml(properties, t) {
  const {
    name,
    schoolType,
    isSpecialSchool,
    inclusionPct,
    specialClassPct,
    pupils,
    gradeAverage,
    schoolYear,
    gradeYear,
    address,
    website,
  } = properties;

  const lines = [];
  if (schoolType) lines.push(`<p><em>${escapeHtml(schoolType)}</em></p>`);

  if (isSpecialSchool) {
    lines.push(`<p><strong>${t('map.schoolPopupSpecialSchool')}</strong></p>`);
  } else {
    lines.push(`<p>${t('map.schoolPopupInclusionPct')}: ${percent(inclusionPct, t)}</p>`);
    lines.push(`<p>${t('map.schoolPopupSpecialClassPct')}: ${percent(specialClassPct, t)}</p>`);
  }

  if (pupils != null) lines.push(`<p>${t('map.schoolPopupPupils')}: ${escapeHtml(pupils)}</p>`);

  if (gradeAverage != null) {
    const year = gradeYear ? ` (${escapeHtml(gradeYear)})` : '';
    lines.push(`<p>${t('map.schoolPopupGradeAverage')}: ${Number(gradeAverage).toFixed(1)}${year}</p>`);
  }

  if (address) lines.push(`<p>${escapeHtml(address)}</p>`);

  const link = safeHttpUrl(website);
  if (link) {
    lines.push(
      `<p><a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a></p>`,
    );
  }

  if (schoolYear) lines.push(`<p><small>${t('map.schoolPopupYear')}: ${escapeHtml(schoolYear)}</small></p>`);

  return `<div class="map-popup-content"><h4>${escapeHtml(name)}</h4>${lines.join('')}</div>`;
}

/**
 * A supermarket: its name, the chain it belongs to and where the data comes from. OpenStreetMap
 * names are typed by volunteers, so all of it is escaped.
 *
 * @param {{name?: string, brand?: string|null, chain?: string}} properties A store feature's properties.
 * @param {(key: string) => string} t
 * @returns {string}
 */
export function buildGroceryPopupHtml(properties, t) {
  const { name, brand, chain } = properties;
  const title = name || brand || t('map.groceryPopupUnnamed');
  const lines = [];
  if (brand && brand !== title) lines.push(`<p><em>${escapeHtml(brand)}</em></p>`);
  lines.push(`<p>${t(`map.groceryChain.${chain}`)}</p>`);
  lines.push(
    `<p><small><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a></small></p>`,
  );
  return `<div class="map-popup-content"><h4>${escapeHtml(title)}</h4>${lines.join('')}</div>`;
}

/** Only Jobindex's own pages are linked to: the address comes from a scraped page, and a link is a click. */
const JOBINDEX_LINK = /^https:\/\/www\.jobindex\.dk\//;

/**
 * A kommune on the jobs choropleth: how many adverts it has.
 *
 * @param {{name?: string, count?: number}} properties A kommune feature's properties.
 * @param {(key: string, values?: Object) => string} t
 * @returns {string}
 */
export function buildJobsAreaPopupHtml(properties, t) {
  const count = Number(properties.count) || 0;
  return `<div class="map-popup-content"><h4>${escapeHtml(properties.name ?? '')}</h4><p>${escapeHtml(
    t('map.jobsAreaPopupCount', { count }),
  )}</p></div>`;
}

/**
 * One job advert: its title, who is hiring, where, the deadline and a link to the advert itself.
 * Titles and employers come from a scraped page, so all of it is escaped and the link is checked.
 *
 * @param {{title?: string, employer?: string, url?: string|null, lastDate?: string|null, kommuneName?: string, approximate?: boolean|string, alsoIn?: string}} properties A posting feature's properties.
 * @param {(key: string, values?: Object) => string} t
 * @returns {string}
 */
export function buildJobPostingPopupHtml(properties, t) {
  const { title, employer, url, lastDate, kommuneName, alsoIn } = properties;
  const approximate = properties.approximate === true || properties.approximate === 'true';
  const lines = [];
  if (employer) lines.push(`<p>${escapeHtml(employer)}</p>`);
  lines.push(`<p>${escapeHtml(kommuneName ?? '')}</p>`);
  if (alsoIn) lines.push(`<p><em>${escapeHtml(t('map.jobsPopupAlsoIn', { places: alsoIn }))}</em></p>`);
  if (approximate) lines.push(`<p><small>${escapeHtml(t('map.jobsPopupApproximate'))}</small></p>`);
  if (lastDate) lines.push(`<p>${escapeHtml(t('map.jobsPopupDeadline', { date: lastDate }))}</p>`);
  if (typeof url === 'string' && JOBINDEX_LINK.test(url)) {
    lines.push(
      `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('map.jobsPopupOpen'))}</a></p>`,
    );
  }
  return `<div class="map-popup-content"><h4>${escapeHtml(title ?? '')}</h4>${lines.join('')}</div>`;
}
