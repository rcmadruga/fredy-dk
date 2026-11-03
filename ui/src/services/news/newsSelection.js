/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * One installed release, as `GET /api/version/releases` returns it: taken from the GitHub release
 * list, newest first, at most the six newest that are not newer than the running version.
 *
 * @typedef {Object} NewsRelease
 * @property {string} version Semantic version, the tag the release went out under.
 * @property {string} [date] ISO timestamp the release was published at.
 * @property {string} [url] The release page on GitHub.
 * @property {string} bodyHtml The release notes, rendered from markdown and sanitised server-side.
 * @property {{title: string, items: number}[]} [outline] The top-level headings of the notes, down
 *   to h3, each with the number of list items under it.
 */

/**
 * Compare two semantic versions.
 *
 * Only the numeric core is compared: a pre-release suffix ("25.1.0-rc.1") sorts as its release
 * would, which is the right answer here - somebody running a release candidate has already seen
 * what that release contains.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} Negative when `a` is older, positive when newer, 0 when equal.
 */
export function compareVersions(a, b) {
  const parts = (value) =>
    String(value ?? '')
      .split('-')[0]
      .split('.')
      .map((piece) => Number.parseInt(piece, 10) || 0);

  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * The release to tell someone about after an upgrade: the newest installed one, if they have not
 * been shown it yet.
 *
 * Only the newest, even when several were skipped. Somebody coming from 29 to 30 wants to know what
 * 30 brought; the releases in between are in the What's New sheet for whoever cares.
 *
 * A `lastSeen` of null means "no marker stored" - a user created after this shipped. They are shown
 * nothing and the current version is recorded for them, because a brand new account being greeted
 * with the history of a product it has never used is noise, not news.
 *
 * @param {NewsRelease[]} releases Newest first, as the server sends them.
 * @param {string|null|undefined} lastSeen The newest version this user has been shown.
 * @returns {NewsRelease|null} `null` when there is nothing to say.
 */
export function selectUnseenRelease(releases, lastSeen) {
  const newest = Array.isArray(releases) ? releases[0] : null;
  if (newest == null || lastSeen == null || String(lastSeen).length === 0) {
    return null;
  }
  return compareVersions(newest.version, lastSeen) > 0 ? newest : null;
}

/**
 * The newest release in the list, used as the marker to store once the dialog is dismissed.
 *
 * Taken from the list rather than from the running version: the marker has to mean "you have seen
 * everything that was listed". While GitHub cannot be reached the list is empty, so nothing is
 * stored, and the news are still there to be shown once it answers again.
 *
 * @param {NewsRelease[]} releases Newest first, as the server sends them.
 * @returns {string|null}
 */
export function newestVersion(releases) {
  return (Array.isArray(releases) && releases[0]?.version) || null;
}

/* ------------------------------------------------------------------------------------------------
 * Fredy DK
 *
 * The fork's own release news lives in `news.dk.json`, a file of releases like upstream's used to be,
 * not a GitHub release list, so it has its own selection functions. They are pure and unused by the
 * dialogs until the DK part of "What's new" is wired in again after the upstream 30 sync; the release
 * tooling (`tools/release/dkRelease.js`) and the footer's version rely on the ordering below.
 * ---------------------------------------------------------------------------------------------- */

/**
 * Compare two Fredy DK versions, `<upstream version>-dk.<n>`.
 *
 * Ordered by the upstream core first and the dk counter second, so `29.2.1-dk.3` is older than
 * `29.3.0-dk.1`: the counter restarts whenever a sync bumps the upstream version. A version with
 * no `-dk.<n>` suffix counts as counter 0, which makes `0.0.0-dk.0` the "has seen nothing" marker.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} Negative when `a` is older, positive when newer, 0 when equal.
 */
export function compareDkVersions(a, b) {
  const counter = (value) => {
    const match = /-dk\.(\d+)/.exec(String(value ?? ''));
    return match ? Number.parseInt(match[1], 10) : 0;
  };
  const core = compareVersions(a, b);
  return core !== 0 ? core : counter(a) - counter(b);
}

/**
 * Whether a DK news entry is well-formed enough to show. A malformed entry is dropped rather than
 * rendered: the file is hand-edited and a missing field must not take the page down with it.
 *
 * @param {any} release
 * @returns {boolean}
 */
function isUsableDkRelease(release) {
  return (
    release != null &&
    typeof release === 'object' &&
    typeof release.version === 'string' &&
    release.version.length > 0 &&
    Array.isArray(release.entries) &&
    release.entries.some((entry) => entry != null && typeof entry.title === 'string')
  );
}

/**
 * Every Fredy DK release, newest first, with the unusable ones dropped.
 *
 * @param {any} config The parsed news.dk.json.
 * @returns {{version: string, date?: string, entries: {title: string, text?: string}[]}[]}
 */
export function allDkReleases(config) {
  const releases = Array.isArray(config?.releases) ? config.releases : [];
  return releases
    .filter(isUsableDkRelease)
    .map((release) => ({
      ...release,
      entries: release.entries.filter((entry) => entry != null && typeof entry.title === 'string'),
    }))
    .sort((a, b) => compareDkVersions(b.version, a.version));
}

/**
 * The Fredy DK releases someone has not been told about yet, oldest first. A missing marker means
 * a new account and yields nothing: it is not greeted with a history it never used.
 *
 * @param {any} config The parsed news.dk.json.
 * @param {string|null|undefined} lastSeen The newest DK version this user has been shown.
 * @returns {ReturnType<typeof allDkReleases>}
 */
export function selectUnseenDkReleases(config, lastSeen) {
  if (lastSeen == null || String(lastSeen).length === 0) {
    return [];
  }
  return allDkReleases(config)
    .filter((release) => compareDkVersions(release.version, lastSeen) > 0)
    .reverse();
}

/**
 * The newest Fredy DK version named in the file.
 *
 * @param {any} config The parsed news.dk.json.
 * @returns {string|null}
 */
export function newestDkVersion(config) {
  return allDkReleases(config)[0]?.version ?? null;
}

/**
 * The version to show in the footer: the newest DK release (`releasedVersion`, or else the newest
 * news entry) when it belongs to the running upstream version, otherwise the upstream version alone.
 *
 * After a sync bumps package.json, news.dk.json may still name the previous upstream core until the
 * next DK release is cut; showing `29.2.1-dk.3` on a 30.1.3 build would be wrong, so it is not.
 *
 * @param {string|null|undefined} localVersion The running upstream version, from package.json.
 * @param {any} dkConfig The parsed news.dk.json.
 * @returns {string|null|undefined}
 */
export function footerVersion(localVersion, dkConfig) {
  // `releasedVersion` is written by every release, so it is current even when the release had no news.
  const released = typeof dkConfig?.releasedVersion === 'string' ? dkConfig.releasedVersion : null;
  const newest = newestDkVersion(dkConfig);
  const dk = released && (!newest || compareDkVersions(released, newest) >= 0) ? released : newest;
  if (!localVersion || !dk) {
    return localVersion;
  }
  return compareVersions(dk, localVersion) === 0 ? dk : localVersion;
}
