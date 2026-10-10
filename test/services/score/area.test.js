/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { AREA_METRICS, walkMinutesToPlace, walkingMinutesFor } from '../../../lib/services/score/metrics/area.js';
import { scoreListing } from '../../../lib/services/score/score.js';

const byId = (id) => AREA_METRICS.find((metric) => metric.id === id);

const place = (category, walkMinutes, extra = {}) => ({
  label: category === 'park' ? 'Parks' : 'Groceries',
  mode: 'walk',
  estimate: true,
  walk: walkMinutes == null ? undefined : { minutes: walkMinutes },
  place: { name: 'Somewhere', lat: 55.6, lng: 12.5, category },
  ...extra,
});

describe('walkMinutesToPlace', () => {
  it('reads the walk of the journey measured for that category', () => {
    const listing = { travelTimes: [place('supermarket', 7), place('park', 12)] };
    expect(walkMinutesToPlace(listing, 'supermarket')).toBe(7);
    expect(walkMinutesToPlace(listing, 'park')).toBe(12);
  });

  it('goes by category, not by label', () => {
    const listing = { travelTimes: [place('supermarket', 7, { label: 'Park' })] };
    expect(walkMinutesToPlace(listing, 'park')).toBeNull();
  });

  it('takes the nearest when two addresses name the same category', () => {
    const listing = { travelTimes: [place('park', 15), place('park', 9)] };
    expect(walkMinutesToPlace(listing, 'park')).toBe(9);
  });

  it('is null for a named address, a missing walk or no journeys', () => {
    expect(walkMinutesToPlace({ travelTimes: [{ label: 'Work', walk: { minutes: 3 } }] }, 'park')).toBeNull();
    expect(walkMinutesToPlace({ travelTimes: [place('park', null)] }, 'park')).toBeNull();
    expect(walkMinutesToPlace({}, 'park')).toBeNull();
  });
});

describe('walkingMinutesFor', () => {
  it('converts metres at 5 km/h with a detour of 30 %', () => {
    expect(walkingMinutesFor(1000)).toBe(16);
    expect(walkingMinutesFor(0)).toBe(0);
  });
});

describe('area.grocery', () => {
  const grocery = byId('grocery');

  it('prefers the routed journey', () => {
    const listing = { travelTimes: [place('supermarket', 6)] };
    expect(grocery.raw(listing, { nearestSupermarketMeters: 3000 })).toBe(6);
  });

  it('falls back to the supermarket layer', () => {
    expect(grocery.raw({}, { nearestSupermarketMeters: 500 })).toBe(8);
  });

  it('is missing with neither', () => {
    expect(grocery.raw({}, {})).toBeNull();
    expect(grocery.raw({ travelTimes: [place('supermarket', null)] }, {})).toBeNull();
  });

  it('scores 5 minutes as 100 and 20 as 0', () => {
    const score = (minutes) =>
      scoreListing({ dealType: 'rent', travelTimes: [place('supermarket', minutes)] }, null, {}, [grocery]).groups[4]
        .score;
    expect(score(5)).toBe(100);
    expect(score(12.5)).toBe(50);
    expect(score(20)).toBe(0);
  });
});

describe('area.park', () => {
  it('reads the park journey and has no fallback', () => {
    const park = byId('park');
    expect(park.raw({ travelTimes: [place('park', 9)] }, { nearestSupermarketMeters: 100 })).toBe(9);
    expect(park.raw({}, { nearestSupermarketMeters: 100 })).toBeNull();
  });
});

describe('the placeholder metrics', () => {
  it.each([
    ['green', 'higher', null, { ideal: 30, worst: 5 }],
    ['quiet', 'higher', null, { ideal: 500, worst: 50 }],
    ['social', 'higher', 'kommune', { ideal: 10, worst: -10 }],
    ['safety', 'lower', 'kommune', { ideal: -25, worst: 25 }],
  ])('%s stays unknown until its source exists', (id, direction, qualifier, target) => {
    const metric = byId(id);
    expect(metric.direction).toBe(direction);
    expect(metric.qualifier ?? null).toBe(qualifier);
    expect(metric.raw({ travelTimes: [place('park', 3)] }, { kommuneCode: '0101' })).toBeNull();
    expect(metric.defaults({})).toEqual(target);
    const result = scoreListing({ dealType: 'rent' }, null, {}, [metric]);
    expect(result.groups[4].metrics[0]).toMatchObject({ missing: true, score: 50 });
  });
});

describe('the Area group', () => {
  it('registers six metrics in the plan order', () => {
    expect(AREA_METRICS.map((metric) => metric.id)).toEqual(['grocery', 'park', 'green', 'quiet', 'social', 'safety']);
    expect(AREA_METRICS.every((metric) => metric.group === 'area')).toBe(true);
  });

  it('pulls a group of mostly unknowns towards the middle', () => {
    const listing = { dealType: 'rent', travelTimes: [place('supermarket', 5), place('park', 5)] };
    const group = scoreListing(listing, null, {}, AREA_METRICS).groups[4];
    // Two perfect metrics and four unknowns at 50.
    expect(group.score).toBe(66.7);
    expect(group.missing).toBe(false);
  });
});
