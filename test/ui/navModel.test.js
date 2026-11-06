/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  NAV_TREE,
  navTreeFor,
  routeKeysOf,
  resolveActiveKey,
  startsSection,
  destinationFor,
  foldsAfterNavigation,
  NAV_RAIL_BREAKPOINT,
} from '../../ui/src/components/navigation/navModel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const english = JSON.parse(fs.readFileSync(path.join(here, '../../ui/src/locales/en.json'), 'utf-8'));

/**
 * Every label in a tree, groups included.
 * @param {import('../../ui/src/components/navigation/navModel.js').NavNode[]} nodes
 * @returns {string[]}
 */
function labelKeysOf(nodes) {
  return nodes.flatMap((node) => [node.labelKey, ...labelKeysOf(node.children ?? [])]);
}

describe('navModel', () => {
  it('hides administration from users without the admin bit', () => {
    expect(routeKeysOf(navTreeFor(false))).not.toContain('/admin');
    expect(routeKeysOf(navTreeFor(true))).toContain('/admin');
  });

  it('offers seven destinations to an admin and six to everyone else', () => {
    // The searches straight under the overview: they are what everything below them is found by.
    expect(routeKeysOf(navTreeFor(true))).toEqual([
      '/dashboard',
      '/jobs',
      '/listings',
      '/map',
      '/finance',
      '/settings',
      '/admin',
    ]);
    expect(routeKeysOf(navTreeFor(false))).toHaveLength(6);
  });

  it('keeps every destination at the top level, one click away', () => {
    for (const node of NAV_TREE) {
      expect(node.key.startsWith('/')).toBe(true);
      expect(node.children).toBeUndefined();
    }
  });

  it('translates every label it shows', () => {
    for (const key of labelKeysOf(NAV_TREE)) {
      expect(Object.keys(english)).toContain(key);
    }
  });

  it.each([
    ['/dashboard', '/dashboard'],
    ['/jobs', '/jobs'],
    // A nested route still marks the entry it belongs to, rather than leaving the sidebar blank
    // while the user is on it.
    ['/jobs/new', '/jobs'],
    ['/jobs/edit/abc-123', '/jobs'],
    ['/listings', '/listings'],
    ['/listings/listing/42', '/listings'],
    ['/map', '/map'],
    ['/finance', '/finance'],
    ['/settings', '/settings'],
    ['/admin', '/admin'],
    ['/admin/settings', '/admin'],
    ['/admin/users/edit/7', '/admin'],
    ['/admin/maintenance', '/admin'],
  ])('marks %s as %s', (pathname, expected) => {
    expect(resolveActiveKey(navTreeFor(true), pathname)).toBe(expected);
  });

  it('leaves the sidebar unselected on a path that belongs to no entry', () => {
    const active = resolveActiveKey(navTreeFor(true), '/403');
    expect(routeKeysOf(navTreeFor(true))).not.toContain(active);
  });

  it('does not light up administration for a user who cannot see it', () => {
    const tree = navTreeFor(false);
    expect(routeKeysOf(tree)).not.toContain(resolveActiveKey(tree, '/admin/settings'));
  });

  it('files every top-level entry under a section, and lets children inherit their parent', () => {
    for (const node of NAV_TREE) {
      expect(['work', 'personal', 'instance']).toContain(node.section);
      for (const child of node.children ?? []) {
        expect(child.section).toBeUndefined();
      }
    }
  });

  it('never puts a rule above the first entry, because there is nothing to divide it from', () => {
    expect(startsSection(navTreeFor(true), 0)).toBe(false);
    expect(startsSection(navTreeFor(false), 0)).toBe(false);
  });

  // The rule is a consequence of the sections rather than a position in the markup, which is what
  // keeps it in the right place for a user who cannot see administration at all.
  it('breaks above settings for a user without the admin bit', () => {
    const tree = navTreeFor(false);
    const breaks = tree.map((_node, index) => index).filter((index) => startsSection(tree, index));

    expect(breaks).toHaveLength(1);
    expect(tree[breaks[0]].key).toBe('/settings');
  });

  it('breaks above both settings and administration for an admin', () => {
    // Two, not one: they used to share a section, which is why the sidebar could not say that one
    // of them is yours alone and the other one is everybody's.
    const tree = navTreeFor(true);
    const breaks = tree.map((_node, index) => index).filter((index) => startsSection(tree, index));

    expect(breaks).toHaveLength(2);
    expect(breaks.map((index) => tree[index].key)).toEqual(['/settings', '/admin']);
  });

  it('prefers the longest match, so a listing does not resolve to a shorter sibling', () => {
    // '/listings' is a prefix of nothing else in the tree today, but the sort is what keeps that
    // true when a '/listings/something' entry is added back.
    const tree = [
      { key: '/listings', labelKey: 'a' },
      { key: '/listings/saved', labelKey: 'b' },
    ];
    expect(resolveActiveKey(tree, '/listings/saved')).toBe('/listings/saved');
    expect(resolveActiveKey(tree, '/listings/listing/1')).toBe('/listings');
  });
});

describe('destinationFor', () => {
  it('carries the filters from the overview to the map, and back', () => {
    const there = destinationFor({ pathname: '/listings', search: '?q=hus&page=2&job=j1&movein=2027-01-01..' }, '/map');
    expect(there).toBe('/map?job=j1&movein=2027-01-01..');

    const back = destinationFor({ pathname: '/map', search: '?job=j1&popup=l9&style=SATELLITE' }, '/listings');
    expect(back).toBe('/listings?job=j1');
  });

  it('goes to the bare path when nothing is filtered', () => {
    expect(destinationFor({ pathname: '/listings', search: '' }, '/map')).toBe('/map');
  });

  it('leaves every other move alone, whatever is in the address', () => {
    const here = { pathname: '/listings', search: '?job=j1' };

    expect(destinationFor(here, '/dashboard')).toBe('/dashboard');
    expect(destinationFor(here, '/finance')).toBe('/finance');
    expect(destinationFor({ pathname: '/jobs', search: '?job=j1' }, '/map')).toBe('/map');
  });

  it('does not rewrite the address of the page the user is already on', () => {
    expect(destinationFor({ pathname: '/map', search: '?job=j1' }, '/map')).toBe('/map');
  });
});

describe('foldsAfterNavigation', () => {
  it('folds the sidebar after a navigation on a phone or a narrow tablet', () => {
    expect(foldsAfterNavigation(390)).toBe(true);
    expect(foldsAfterNavigation(768)).toBe(true);
    expect(foldsAfterNavigation(NAV_RAIL_BREAKPOINT)).toBe(true);
  });

  it('leaves it as the user set it on a wide screen', () => {
    expect(foldsAfterNavigation(NAV_RAIL_BREAKPOINT + 1)).toBe(false);
    expect(foldsAfterNavigation(1400)).toBe(false);
  });

  it('does nothing for a width it cannot read', () => {
    expect(foldsAfterNavigation(undefined)).toBe(false);
    expect(foldsAfterNavigation(NaN)).toBe(false);
  });
});

describe('Navigation folds the sidebar after going somewhere', () => {
  const source = fs.readFileSync(path.join(here, '../../ui/src/components/navigation/Navigation.jsx'), 'utf-8');

  it('uses the one rule rather than a number of its own', () => {
    expect(source).toContain('foldsAfterNavigation');
    expect(source).not.toMatch(/width\s*<=\s*850/);
  });

  it('folds on a click, and again whenever the route changes', () => {
    // The click handler covers the page already open; the effect covers the back button and links.
    expect(source).toMatch(/const go = \(key\) => \{[\s\S]*foldsAfterNavigation\(width\)[\s\S]*setCollapsed\(true\)/);
    expect(source).toMatch(/\[width, location\.pathname\]/);
  });
});
