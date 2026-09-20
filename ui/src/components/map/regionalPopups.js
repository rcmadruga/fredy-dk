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
