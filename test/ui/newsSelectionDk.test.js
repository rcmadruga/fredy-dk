/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// The Fredy DK part of the news selection. Upstream's own selection is covered by newsSelection.test.js.

import { describe, it, expect } from 'vitest';

import {
  allDkReleases,
  compareDkVersions,
  compareVersions,
  footerVersion,
  newestDkVersion,
  selectUnseenDkReleases,
} from '../../ui/src/services/news/newsSelection.js';
import newsDkConfig from '../../ui/src/assets/news/news.dk.json';

/**
 * @param {string} version
 * @returns {Object}
 */
function release(version) {
  return { version, date: '2026-01-01', entries: [{ title: `Release ${version}`, text: 'Something happened.' }] };
}

describe('comparing Fredy DK versions', () => {
  it.each([
    ['29.2.1-dk.2', '29.2.1-dk.1', 1],
    ['29.2.1-dk.1', '29.2.1-dk.1', 0],
    ['29.2.1-dk.10', '29.2.1-dk.9', 1],
    // The upstream core wins over the counter: a sync restarts the counter at 1.
    ['29.3.0-dk.1', '29.2.1-dk.7', 1],
    ['29.2.1-dk.7', '29.3.0-dk.1', -1],
    ['29.2.1-dk.1', '0.0.0-dk.0', 1],
    ['29.2.1', '29.2.1-dk.1', -1],
  ])('puts %s %s', (left, right, expected) => {
    expect(Math.sign(compareDkVersions(left, right))).toBe(expected);
  });

  it('leaves upstream ordering alone, which ignores the suffix', () => {
    expect(compareVersions('29.2.1-dk.2', '29.2.1-dk.1')).toBe(0);
  });

  it('copes with nonsense', () => {
    expect(compareDkVersions(undefined, null)).toBe(0);
  });
});

describe('choosing which DK news to show', () => {
  const dk = {
    schemaVersion: 1,
    releases: [release('29.2.1-dk.1'), release('29.2.1-dk.2'), release('29.3.0-dk.1')],
  };

  it('shows an existing user, marked 0.0.0-dk.0, every DK release, oldest first', () => {
    expect(selectUnseenDkReleases(dk, '0.0.0-dk.0').map((r) => r.version)).toEqual([
      '29.2.1-dk.1',
      '29.2.1-dk.2',
      '29.3.0-dk.1',
    ]);
  });

  it('shows only what came after the marker', () => {
    expect(selectUnseenDkReleases(dk, '29.2.1-dk.2').map((r) => r.version)).toEqual(['29.3.0-dk.1']);
  });

  it('shows nothing to a user with no marker, or one who is caught up', () => {
    expect(selectUnseenDkReleases(dk, null)).toEqual([]);
    expect(selectUnseenDkReleases(dk, '29.3.0-dk.1')).toEqual([]);
  });

  it('sorts newest first and names the newest', () => {
    expect(allDkReleases(dk)[0].version).toBe('29.3.0-dk.1');
    expect(newestDkVersion(dk)).toBe('29.3.0-dk.1');
    expect(newestDkVersion({ releases: [] })).toBeNull();
  });
});

describe('the shipped DK news file', () => {
  it('is well formed and every version is <upstream>-dk.<n>', () => {
    const releases = allDkReleases(newsDkConfig);
    expect(releases.length).toBe(newsDkConfig.releases.length);
    for (const entry of newsDkConfig.releases) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+-dk\.[1-9]\d*$/);
    }
    expect(new Set(newsDkConfig.releases.map((entry) => entry.version)).size).toBe(newsDkConfig.releases.length);
  });
});

describe('the footer version', () => {
  const dk = { releases: [release('29.2.1-dk.3')] };

  it('shows the DK version when it belongs to the running upstream version', () => {
    expect(footerVersion('29.2.1', dk)).toBe('29.2.1-dk.3');
  });

  it('shows a release that had no news, from releasedVersion', () => {
    expect(footerVersion('29.2.1', { ...dk, releasedVersion: '29.2.1-dk.4' })).toBe('29.2.1-dk.4');
  });

  it('does not let an older releasedVersion hide a newer news entry', () => {
    expect(footerVersion('29.2.1', { ...dk, releasedVersion: '29.2.1-dk.1' })).toBe('29.2.1-dk.3');
  });

  it('falls back to the upstream version after a sync moved it on', () => {
    expect(footerVersion('29.3.0', dk)).toBe('29.3.0');
  });

  it('passes through a missing version or an empty file', () => {
    expect(footerVersion(undefined, dk)).toBeUndefined();
    expect(footerVersion('29.2.1', { releases: [] })).toBe('29.2.1');
  });
});
