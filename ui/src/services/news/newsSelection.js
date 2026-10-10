/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * One shipped release, as `ui/src/assets/news/news.json` declares it.
 *
 * @typedef {Object} NewsRelease
 * @property {string} version Semantic version, matching the tag the release went out under.
 * @property {string} [date] ISO date, shown next to the version.
 * @property {NewsEntry[]} entries What is worth telling someone about, in reading order.
 *
 * @typedef {Object} NewsEntry
 * @property {string} title
 * @property {string} text Inline HTML, rendered as-is. Written in English and not translated:
 *   release prose changes every few weeks and would otherwise have to be written twice, with the
 *   German half going stale the first time somebody forgot.
 * @property {string} [media] File name under `ui/src/assets/news/`. `.mp4` renders as a video.
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
 * Compare two Fredy DK versions, `<upstream version>-dk.<n>`.
 *
 * Ordered by the upstream core first and the dk counter second, so `29.2.1-dk.3` is older than
 * `29.3.0-dk.1`: the counter restarts whenever a sync bumps the upstream version. A version with
 * no `-dk.<n>` suffix counts as counter 0, which makes `0.0.0-dk.0` the "has seen nothing" marker.
 * Upstream's own `compareVersions` is deliberately left alone, since it ignores suffixes.
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
 * Whether a release is well-formed enough to show.
 *
 * A malformed entry is dropped rather than rendered: news.json is hand-edited on every release and
 * a missing field there must not take the dialog - or the page behind it - down with it.
 *
 * @param {any} release
 * @returns {boolean}
 */
function isUsable(release) {
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
 * Every release, newest first, with the unusable ones dropped.
 *
 * @param {any} config The parsed news.json.
 * @param {(a: string, b: string) => number} [compare] Version ordering; upstream's by default.
 * @returns {NewsRelease[]}
 */
export function allReleases(config, compare = compareVersions) {
  const releases = Array.isArray(config?.releases) ? config.releases : [];
  return releases
    .filter(isUsable)
    .map((release) => ({
      ...release,
      entries: release.entries.filter((entry) => entry != null && typeof entry.title === 'string'),
    }))
    .sort((a, b) => compare(b.version, a.version));
}

/**
 * The releases someone has not been told about yet, oldest first.
 *
 * Oldest first because they are shown as consecutive steps and the story only makes sense in the
 * order it happened. Someone who skipped two releases gets both, which is the point: the previous
 * mechanism stored a single hash of the current payload, so skipping a release meant never hearing
 * about it.
 *
 * A `lastSeen` of null means "no marker stored" - a user created after this shipped. They are shown
 * nothing and the current version is recorded for them, because a brand new account being greeted
 * with the history of a product it has never used is noise, not news.
 *
 * @param {any} config The parsed news.json.
 * @param {string|null|undefined} lastSeen The newest version this user has been shown.
 * @param {(a: string, b: string) => number} [compare] Version ordering; upstream's by default.
 * @returns {NewsRelease[]} Empty when there is nothing to say.
 */
export function selectUnseenReleases(config, lastSeen, compare = compareVersions) {
  if (lastSeen == null || String(lastSeen).length === 0) {
    return [];
  }
  return allReleases(config, compare)
    .filter((release) => compare(release.version, lastSeen) > 0)
    .reverse();
}

/**
 * The newest version named in the file, used as the marker to store once the dialog is dismissed.
 *
 * Taken from news.json rather than from package.json: the marker has to mean "you have seen
 * everything this file holds", and a build whose version is ahead of the newest written release
 * would otherwise silently swallow that release when it is added later.
 *
 * @param {any} config The parsed news.json.
 * @param {(a: string, b: string) => number} [compare] Version ordering; upstream's by default.
 * @returns {string|null}
 */
export function newestVersion(config, compare = compareVersions) {
  return allReleases(config, compare)[0]?.version ?? null;
}

/**
 * Every Fredy DK release, newest first. See `allReleases`.
 *
 * @param {any} config The parsed news.dk.json.
 * @returns {NewsRelease[]}
 */
export function allDkReleases(config) {
  return allReleases(config, compareDkVersions);
}

/**
 * The Fredy DK releases someone has not been told about yet, oldest first. A missing marker means
 * a new account and yields nothing, exactly as `selectUnseenReleases` does.
 *
 * @param {any} config The parsed news.dk.json.
 * @param {string|null|undefined} lastSeen The newest DK version this user has been shown.
 * @returns {NewsRelease[]}
 */
export function selectUnseenDkReleases(config, lastSeen) {
  return selectUnseenReleases(config, lastSeen, compareDkVersions);
}

/**
 * The newest Fredy DK version named in the file.
 *
 * @param {any} config The parsed news.dk.json.
 * @returns {string|null}
 */
export function newestDkVersion(config) {
  return newestVersion(config, compareDkVersions);
}

/**
 * The version to show in the footer: the newest DK version when it belongs to the running upstream
 * version, otherwise the upstream version alone.
 *
 * After a sync bumps package.json, news.dk.json may still name the previous upstream core until the
 * next DK release is cut; showing `29.2.1-dk.1` on a 29.3.0 build would be wrong, so it is not.
 *
 * @param {string|null|undefined} localVersion The running upstream version, from package.json.
 * @param {any} dkConfig The parsed news.dk.json.
 * @returns {string|null|undefined}
 */
export function footerVersion(localVersion, dkConfig) {
  const dk = newestDkVersion(dkConfig);
  if (!localVersion || !dk) {
    return localVersion;
  }
  return compareVersions(dk, localVersion) === 0 ? dk : localVersion;
}
