/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { allDkReleases } from './newsSelection.js';

/**
 * The Fredy DK releases in the shape upstream's release notes dialog reads (`NewsRelease`): a version,
 * a date, the notes as HTML and an outline for the contents column.
 *
 * Upstream's notes come from GitHub and are rendered on the server. Ours are a file in the build,
 * written by `tools/release/dkRelease.js`, whose entry texts are already escaped HTML (the same text
 * the earlier dialog injected). Each entry becomes a heading and its text, so a release with three
 * entries has three sections in the contents column.
 *
 * @param {any} config The parsed news.dk.json.
 * @returns {import('./newsSelection.js').NewsRelease[]} Newest first.
 */
export function dkReleaseNotes(config) {
  return allDkReleases(config).map((release) => ({
    version: release.version,
    date: release.date,
    bodyHtml: release.entries
      .map((entry) => `<h3>${escapeText(entry.title)}</h3>${entry.text ? `<p>${entry.text}</p>` : ''}`)
      .join(''),
    outline: release.entries.map((entry) => ({ title: entry.title, items: 0 })),
  }));
}

/**
 * Entry titles are plain text in the file, unlike the entry texts, which are HTML.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
