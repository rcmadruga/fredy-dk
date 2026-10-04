/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';

import {
  NEUTRAL,
  FILTER_KEYS,
  isActiveFilter,
  countActiveFilters,
  showValueOf,
  showPatch,
  clearFilter,
  clearAllFilters,
  describeActiveFilters,
  filterConfiguredProviders,
  toListingsQuery,
  MOBILE_OPERATOR_KEY,
  MOVE_IN_DATED_KEY,
  FILTER_URL_STATE,
  SHARED_FILTER_PARAMS,
  parseMoveInWindow,
  formatMoveInWindow,
  carryFilters,
} from '../../ui/src/services/listings/listingFilters.js';

/** The URL state as the page opens it. @returns {Object} */
const defaults = () => ({
  page: 1,
  sort: 'created_at',
  dir: 'desc',
  q: null,
  ...NEUTRAL,
  // The page opens filtered to active listings, which is the one default that is a real filter.
  active: true,
});

/** A `t` that returns the key, so assertions read as the key rather than as English. */
const t = (key, vars) => (vars == null ? key : `${key}:${JSON.stringify(vars)}`);

describe('listingFilters', () => {
  describe('connectivity', () => {
    it('counts a speed floor and a fibre requirement as two filters', () => {
      const values = { ...defaults(), active: null, down: 1000, fiber: true };

      expect(countActiveFilters(values)).toBe(2);
    });

    it('counts a mobile technology and its operator as one filter', () => {
      // The operator cannot filter anything on its own - the query needs a technology to turn the
      // pair into a bit - so counting it separately would report two filters where the user set
      // one, and the chip row would show a chip nobody can remove on its own.
      const values = { ...defaults(), active: null, mtech: '5g', [MOBILE_OPERATOR_KEY]: 'dt' };

      expect(countActiveFilters(values)).toBe(1);
      expect(FILTER_KEYS).not.toContain(MOBILE_OPERATOR_KEY);
    });

    it('takes the operator along when the technology is cleared', () => {
      const patch = clearFilter('mtech');

      expect(patch.mtech).toBeNull();
      expect(patch[MOBILE_OPERATOR_KEY]).toBeNull();
    });

    it('clears every connectivity filter along with the rest', () => {
      const cleared = clearAllFilters();

      expect(cleared.down).toBeNull();
      expect(cleared.fiber).toBeNull();
      expect(cleared.mtech).toBeNull();
      expect(cleared[MOBILE_OPERATOR_KEY]).toBeNull();
    });

    it('names a speed floor with the number in it', () => {
      const chips = describeActiveFilters({ ...defaults(), active: null, down: 100 }, { t });

      expect(chips).toEqual([{ key: 'down', label: 'listings.filterDownstreamOption:{"mbit":100}' }]);
    });

    it('names a mobile filter without an operator by the technology alone', () => {
      const chips = describeActiveFilters({ ...defaults(), active: null, mtech: '5g' }, { t });

      expect(chips).toEqual([{ key: 'mtech', label: 'connectivity.tech.5g' }]);
    });

    it('names a mobile filter with an operator by both', () => {
      const chips = describeActiveFilters(
        { ...defaults(), active: null, mtech: '5g', [MOBILE_OPERATOR_KEY]: 'dt' },
        { t },
      );

      expect(chips).toEqual([
        {
          key: 'mtech',
          label:
            'listings.filterMobileWithOperator:{"technology":"connectivity.tech.5g","operator":"connectivity.operator.dt"}',
        },
      ]);
    });
  });

  describe('counting', () => {
    it('counts the opening view as filtered, because it is', () => {
      expect(countActiveFilters(defaults())).toBe(1);
      expect(isActiveFilter('active', defaults())).toBe(true);
    });

    it('counts nothing once everything is cleared', () => {
      const cleared = clearAllFilters();
      expect(cleared.active).toBe(null);
      expect(countActiveFilters({ ...defaults(), ...cleared })).toBe(0);
    });

    it('counts each filter once', () => {
      const values = { ...defaults(), provider: 'immoscout', status: 'applied', watch: true };
      expect(countActiveFilters(values)).toBe(4);
    });

    it('does not count activity twice while the hidden view is on', () => {
      // `hidden` forces `active` to null, so the pair is one control and reads as one filter.
      const values = { ...defaults(), ...showPatch('hidden') };
      expect(countActiveFilters(values)).toBe(1);
      expect(isActiveFilter('active', values)).toBe(false);
    });
  });

  describe('the activity control', () => {
    it.each([
      ['all', { hidden: false, active: null }],
      ['true', { hidden: false, active: true }],
      ['false', { hidden: false, active: false }],
      ['hidden', { hidden: true, active: null }],
    ])('round-trips %s', (value, expected) => {
      const patch = showPatch(value);
      expect(patch).toMatchObject(expected);
      expect(showValueOf({ ...defaults(), ...patch })).toBe(value);
    });

    it('always resets the page, so a filtered view cannot open on a page that no longer exists', () => {
      for (const value of ['all', 'true', 'false', 'hidden']) {
        expect(showPatch(value).page).toBe(1);
      }
    });
  });

  describe('clearing', () => {
    it.each(FILTER_KEYS)('clears %s without disturbing the others', (key) => {
      const values = {
        ...defaults(),
        watch: true,
        job: 'job-1',
        provider: 'immoscout',
        status: 'applied',
        afford: 'stretch',
        commute: 'transit:30',
      };
      const next = { ...values, ...clearFilter(key) };

      expect(isActiveFilter(key, next)).toBe(false);
      for (const other of FILTER_KEYS) {
        // Activity and the hidden view are the one pair that clear together, by design.
        if (other === key || (key === 'active' && other === 'hidden') || (key === 'hidden' && other === 'active')) {
          continue;
        }
        expect(next[other]).toBe(values[other]);
      }
    });

    it('leaves the search box, the sort and the page size alone', () => {
      const patch = clearAllFilters();
      expect(patch.q).toBeUndefined();
      expect(patch.sort).toBeUndefined();
      expect(patch.dir).toBeUndefined();
    });

    it('sends the user back to the first page', () => {
      expect(clearAllFilters().page).toBe(1);
      expect(clearFilter('provider').page).toBe(1);
    });
  });

  describe('describing', () => {
    it('says nothing when nothing is on', () => {
      expect(describeActiveFilters({ ...defaults(), ...clearAllFilters() }, { t })).toEqual([]);
    });

    it('names the job and the provider rather than showing their ids', () => {
      const chips = describeActiveFilters(
        { ...defaults(), ...clearAllFilters(), job: 'job-1', provider: 'is24' },
        {
          t,
          jobs: [{ id: 'job-1', name: 'Cologne 3-room' }],
          providers: [{ id: 'is24', name: 'ImmoScout24' }],
        },
      );
      // Source last, in the reading order FILTER_KEYS declares.
      expect(chips).toEqual([
        { key: 'provider', label: 'ImmoScout24' },
        { key: 'job', label: 'Cologne 3-room' },
      ]);
    });

    it('lists chips in the declared reading order, not in the order the keys were set', () => {
      const values = { ...defaults(), job: 'j', provider: 'p', watch: true, status: 'applied' };
      expect(describeActiveFilters(values, { t }).map((chip) => chip.key)).toEqual([
        'active',
        'watch',
        'status',
        'provider',
        'job',
      ]);
    });

    it('falls back to the id when the job is gone', () => {
      const [chip] = describeActiveFilters({ ...defaults(), ...clearAllFilters(), job: 'deleted' }, { t, jobs: [] });
      expect(chip.label).toBe('deleted');
    });

    it('tells active and inactive apart', () => {
      expect(describeActiveFilters({ ...defaults(), active: true }, { t })[0].label).toBe('listings.filterActive');
      expect(describeActiveFilters({ ...defaults(), active: false }, { t })[0].label).toBe('listings.filterInactive');
    });

    it('tells watched and unwatched apart', () => {
      const base = { ...defaults(), ...clearAllFilters() };
      expect(describeActiveFilters({ ...base, watch: true }, { t })[0].label).toBe('listings.filterWatched');
      expect(describeActiveFilters({ ...base, watch: false }, { t })[0].label).toBe('listings.filterUnwatched');
    });

    it('spells out the commute rather than repeating its encoding', () => {
      const base = { ...defaults(), ...clearAllFilters() };
      const [chip] = describeActiveFilters({ ...base, commute: 'transit:30' }, { t });
      expect(chip.label).toContain('listings.filterCommuteOption');
      expect(chip.label).toContain('30');
      expect(chip.label).not.toBe('transit:30');
    });

    it('shows the hidden view as one chip, not two', () => {
      const values = { ...defaults(), ...showPatch('hidden') };
      expect(describeActiveFilters(values, { t })).toEqual([{ key: 'hidden', label: 'listings.filterHidden' }]);
    });

    it('produces one chip per counted filter', () => {
      const values = { ...defaults(), provider: 'is24', status: 'applied', watch: true };
      expect(describeActiveFilters(values, { t })).toHaveLength(countActiveFilters(values));
    });
  });

  describe('the query it sends', () => {
    it('sends the default view as active listings only', () => {
      const { freeTextFilter, filter } = toListingsQuery(defaults());

      expect(freeTextFilter).toBeNull();
      expect(filter.activityFilter).toBe(true);
      expect(filter.hiddenOnly).toBeUndefined();
    });

    it('drops the activity filter in the hidden view, where it would match nothing', () => {
      const { filter } = toListingsQuery({ ...defaults(), hidden: true });

      expect(filter.hiddenOnly).toBe(true);
      expect(filter.activityFilter).toBeNull();
    });

    it('splits the commute value into a mode and a ceiling', () => {
      const { filter } = toListingsQuery({ ...defaults(), commute: 'transit:30' });

      expect(filter.travelTimeMode).toBe('transit');
      expect(filter.travelTimeMaxMinutes).toBe(30);
    });

    it('sends no travel time at all without a commute filter', () => {
      const { filter } = toListingsQuery(defaults());

      expect(filter).not.toHaveProperty('travelTimeMode');
      expect(filter).not.toHaveProperty('travelTimeMaxMinutes');
    });

    it('leaves the mobile operator out unless a technology asks for it', () => {
      const withoutTech = toListingsQuery({ ...defaults(), [MOBILE_OPERATOR_KEY]: 'dt' });
      expect(withoutTech.filter.connectivityMobileOperator).toBeNull();

      const withTech = toListingsQuery({ ...defaults(), mtech: '5g', [MOBILE_OPERATOR_KEY]: 'dt' });
      expect(withTech.filter.connectivityMobileOperator).toBe('dt');
    });

    it('carries every filter the chips can name', () => {
      const values = {
        ...defaults(),
        q: 'Altbau',
        watch: true,
        job: 'job-1',
        provider: 'immoscout',
        status: 'applied',
        afford: 'affordable',
        down: 1000,
        fiber: true,
      };

      const { freeTextFilter, filter } = toListingsQuery(values);

      expect(freeTextFilter).toBe('Altbau');
      expect(filter).toMatchObject({
        watchListFilter: true,
        jobNameFilter: 'job-1',
        providerFilter: 'immoscout',
        statusFilter: 'applied',
        affordabilityFilter: 'affordable',
        connectivityMinDown: 1000,
        connectivityFiber: true,
      });
    });

    it('asks for everything once the filters are cleared', () => {
      const cleared = { ...defaults(), q: 'Altbau', provider: 'immoscout', ...clearAllFilters() };
      const { filter } = toListingsQuery(cleared);

      expect(filter.providerFilter).toBeNull();
      expect(filter.activityFilter).toBeNull();
      expect(filter.hiddenOnly).toBeUndefined();
    });
  });

  describe('configured providers', () => {
    const allProviders = [
      { id: 'immoscout', name: 'ImmoScout24' },
      { id: 'immowelt', name: 'Immowelt' },
      { id: 'kleinanzeigen', name: 'Kleinanzeigen' },
      { id: 'wgGesucht', name: 'WG-Gesucht' },
    ];

    it('restricts providers to those present in configured jobs', () => {
      const jobs = [
        { id: 'j1', name: 'Job 1', provider: [{ id: 'immoscout' }] },
        { id: 'j2', name: 'Job 2', provider: [{ id: 'immowelt' }] },
      ];
      const result = filterConfiguredProviders(allProviders, jobs);
      expect(result).toEqual([
        { id: 'immoscout', name: 'ImmoScout24' },
        { id: 'immowelt', name: 'Immowelt' },
      ]);
    });

    it('narrows to the selected job when a job filter is active', () => {
      const jobs = [
        { id: 'j1', name: 'Job 1', provider: [{ id: 'immoscout' }] },
        { id: 'j2', name: 'Job 2', provider: [{ id: 'immowelt' }] },
      ];
      const result = filterConfiguredProviders(allProviders, jobs, 'j1');
      expect(result).toEqual([{ id: 'immoscout', name: 'ImmoScout24' }]);
    });

    it('preserves an active provider filter even if unconfigured in the current job', () => {
      const jobs = [{ id: 'j1', name: 'Job 1', provider: [{ id: 'immoscout' }] }];
      const result = filterConfiguredProviders(allProviders, jobs, 'j1', 'kleinanzeigen');
      expect(result).toEqual([
        { id: 'immoscout', name: 'ImmoScout24' },
        { id: 'kleinanzeigen', name: 'Kleinanzeigen' },
      ]);
    });

    it('narrows to providers for which results are present when availableProviders is provided', () => {
      const jobs = [
        { id: 'j1', name: 'Job 1', provider: [{ id: 'immoscout' }, { id: 'immowelt' }, { id: 'kleinanzeigen' }] },
      ];
      // Results only exist for immoscout
      const result = filterConfiguredProviders(allProviders, jobs, null, null, ['immoscout']);
      expect(result).toEqual([{ id: 'immoscout', name: 'ImmoScout24' }]);
    });

    it('preserves an active provider filter even if no results currently match it', () => {
      const jobs = [{ id: 'j1', name: 'Job 1', provider: [{ id: 'immoscout' }] }];
      const result = filterConfiguredProviders(allProviders, jobs, null, 'immowelt', ['immoscout']);
      expect(result).toEqual([
        { id: 'immoscout', name: 'ImmoScout24' },
        { id: 'immowelt', name: 'Immowelt' },
      ]);
    });

    it('falls back to all providers when no jobs exist', () => {
      expect(filterConfiguredProviders(allProviders, [])).toEqual(allProviders);
      expect(filterConfiguredProviders(allProviders, null)).toEqual(allProviders);
    });

    it('falls back to all providers when jobs have no configured providers', () => {
      const jobs = [{ id: 'j1', name: 'Job 1', provider: [] }];
      expect(filterConfiguredProviders(allProviders, jobs)).toEqual(allProviders);
    });

    it('handles empty or missing providers list safely', () => {
      expect(filterConfiguredProviders([], [{ id: 'j1' }])).toEqual([]);
      expect(filterConfiguredProviders(null, [{ id: 'j1' }])).toEqual([]);
    });
  });
});

describe('the move-in window', () => {
  it('reads a closed window and an open end on either side', () => {
    expect(parseMoveInWindow('2027-01-01..2027-03-31')).toEqual({ from: '2027-01-01', to: '2027-03-31' });
    expect(parseMoveInWindow('2027-01-01..')).toEqual({ from: '2027-01-01', to: null });
    expect(parseMoveInWindow('..2027-03-31')).toEqual({ from: null, to: '2027-03-31' });
  });

  it('is null for anything that holds no usable date, so a mangled bookmark filters nothing', () => {
    for (const bad of [
      '..',
      '',
      'x',
      '2027-02-30..',
      '2027-01-01',
      '2027-01-01..2027-02-01..2027-03-01',
      null,
      undefined,
      5,
    ]) {
      expect(parseMoveInWindow(bad), String(bad)).toBeNull();
    }
  });

  it('keeps the good end when the other is not a date', () => {
    expect(parseMoveInWindow('2027-01-01..soon')).toEqual({ from: '2027-01-01', to: null });
  });

  it('writes what it reads', () => {
    expect(formatMoveInWindow({ from: '2027-01-01', to: '2027-03-31' })).toBe('2027-01-01..2027-03-31');
    expect(formatMoveInWindow({ from: '2027-01-01' })).toBe('2027-01-01..');
    expect(formatMoveInWindow({ to: '2027-03-31' })).toBe('..2027-03-31');
    expect(formatMoveInWindow({ from: '', to: null })).toBeNull();
    expect(formatMoveInWindow({ from: 'junk' })).toBeNull();
    expect(formatMoveInWindow()).toBeNull();
  });

  it('counts as one filter only when the window parses', () => {
    expect(isActiveFilter('movein', { ...defaults(), movein: '2027-01-01..' })).toBe(true);
    expect(isActiveFilter('movein', { ...defaults(), movein: 'garbage' })).toBe(false);
    expect(isActiveFilter('movein', defaults())).toBe(false);
    expect(FILTER_KEYS).toContain('movein');
    expect(FILTER_KEYS).not.toContain(MOVE_IN_DATED_KEY);
  });

  it('is not counted twice for the dated-only flag', () => {
    expect(countActiveFilters({ ...defaults(), movein: '2027-01-01..', mdated: true })).toBe(
      countActiveFilters({ ...defaults(), movein: '2027-01-01..' }),
    );
  });

  it('is cleared together with its flag, and by "clear all"', () => {
    expect(clearFilter('movein')).toEqual({ movein: null, mdated: null, page: 1 });
    expect(clearAllFilters()).toMatchObject({ movein: null, mdated: null });
  });

  describe('what the server is asked', () => {
    it('sends the dates, and the flag only when it is set', () => {
      const withFlag = toListingsQuery({ ...defaults(), movein: '2027-01-01..2027-03-31', mdated: true }).filter;
      const without = toListingsQuery({ ...defaults(), movein: '2027-01-01..2027-03-31' }).filter;

      expect(withFlag).toMatchObject({ moveInFrom: '2027-01-01', moveInTo: '2027-03-31', moveInDatedOnly: true });
      expect(without).toMatchObject({ moveInFrom: '2027-01-01', moveInTo: '2027-03-31' });
      expect(without).not.toHaveProperty('moveInDatedOnly');
    });

    it('sends nothing for an open end, and nothing at all for a flag without a window', () => {
      const openEnd = toListingsQuery({ ...defaults(), movein: '2027-01-01..' }).filter;
      expect(openEnd).toHaveProperty('moveInFrom', '2027-01-01');
      expect(openEnd).not.toHaveProperty('moveInTo');

      const flagOnly = toListingsQuery({ ...defaults(), mdated: true }).filter;
      expect(flagOnly).not.toHaveProperty('moveInDatedOnly');
      expect(flagOnly).not.toHaveProperty('moveInFrom');
    });
  });

  describe('as a chip', () => {
    const t = (key, vars) => `${key}(${Object.values(vars ?? {}).join(',')})`;
    const chip = (movein) =>
      describeActiveFilters({ ...defaults(), movein }, { t, locale: 'en' }).find((c) => c.key === 'movein');

    it('says both ends, or the one there is, with the dates in the locale', () => {
      expect(chip('2027-01-01..2027-03-31').label).toBe('listings.filterMoveInChipRange(Jan 1, 2027,Mar 31, 2027)');
      expect(chip('2027-01-01..').label).toBe('listings.filterMoveInChipFrom(Jan 1, 2027)');
      expect(chip('..2027-03-31').label).toBe('listings.filterMoveInChipTo(Mar 31, 2027)');
    });

    it('is absent when the window filters nothing', () => {
      expect(chip('garbage')).toBeUndefined();
      expect(chip(null)).toBeUndefined();
    });
  });
});

describe('one set of filters for the overview and the map', () => {
  it('has a URL entry for every filter, and every entry is a filter', () => {
    // The two views build their URL state from FILTER_URL_STATE, so this is what keeps a filter from
    // existing on one page and not the other: it cannot be added to the list of filters without
    // also being readable from the address bar, nor the reverse.
    expect(Object.keys(FILTER_URL_STATE).sort()).toEqual(Object.keys(NEUTRAL).sort());
  });

  it('opens on active listings only, the one default that is a filter', () => {
    expect(FILTER_URL_STATE.active.defaultValue).toBe(true);
    for (const key of Object.keys(FILTER_URL_STATE)) {
      if (key !== 'active') expect(FILTER_URL_STATE[key].defaultValue, key).toBe(NEUTRAL[key]);
    }
  });

  describe('carrying the filters from one view to the other', () => {
    it('takes the filters and leaves the overview-only and map-only parameters behind', () => {
      const search =
        '?q=hillerød&page=3&sort=price&dir=asc&job=j1&provider=boligportal&commute=transit:30&movein=2027-01-01..&popup=l9&style=SATELLITE&priceMin=100';

      const target = carryFilters(search, '/map');

      expect(target.startsWith('/map?')).toBe(true);
      const carried = new URLSearchParams(target.split('?')[1]);
      expect(Object.fromEntries(carried)).toEqual({
        job: 'j1',
        provider: 'boligportal',
        commute: 'transit:30',
        movein: '2027-01-01..',
      });
    });

    it('is the bare path when there is nothing to carry', () => {
      expect(carryFilters('', '/listings')).toBe('/listings');
      expect(carryFilters('?q=a&page=2&popup=x', '/listings')).toBe('/listings');
    });

    it('carries a filter that is switched off on purpose, such as showing every listing', () => {
      // `active` defaults to true, so "all" is written into the URL as `active=` and has to survive.
      expect(carryFilters('?active=null', '/map')).toContain('active=');
    });

    it('only ever carries parameters that are filters', () => {
      expect(SHARED_FILTER_PARAMS).not.toEqual(expect.arrayContaining(['q', 'page', 'sort', 'dir', 'popup', 'style']));
    });
  });
});
