/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { WORK_METRICS, commuteMinutes, resolveCommuteLabel } from '../../../lib/services/score/metrics/work.js';
import { scoreListing } from '../../../lib/services/score/score.js';

const byId = (id) => WORK_METRICS.find((metric) => metric.id === id);

const entry = (label, minutes, extra = {}) => ({
  label,
  mode: 'transit',
  estimate: true,
  transit: { minutes, transfers: 1 },
  ...extra,
});

describe('resolveCommuteLabel', () => {
  it('prefers the label in the score config', () => {
    const filter = { limits: { Work: 35 } };
    expect(resolveCommuteLabel({ commute: { label: 'Office' } }, filter)).toBe('Office');
  });

  it('defaults to the single label in the commute filter', () => {
    expect(resolveCommuteLabel(null, { action: 'notify', limits: { Work: 35 } })).toBe('Work');
    expect(resolveCommuteLabel({}, { limits: { Work: 35 } })).toBe('Work');
  });

  it('does not guess between several labels', () => {
    expect(resolveCommuteLabel(null, { limits: { Work: 35, School: 20 } })).toBeNull();
  });

  it('is null with neither', () => {
    expect(resolveCommuteLabel(null, null)).toBeNull();
    expect(resolveCommuteLabel(undefined, { limits: {} })).toBeNull();
  });

  it('ignores a blank or non-string configured label', () => {
    expect(resolveCommuteLabel({ commute: { label: '  ' } }, { limits: { Work: 35 } })).toBe('Work');
    expect(resolveCommuteLabel({ commute: { label: 7 } }, null)).toBeNull();
  });
});

describe('commuteMinutes', () => {
  it('reads the minutes of the named address', () => {
    const listing = { travelTimes: [entry('School', 10), entry('Work', 35)] };
    expect(commuteMinutes(listing, { commuteLabel: 'Work' })).toBe(35);
  });

  it('is missing without a label, travel times or that address', () => {
    expect(commuteMinutes({ travelTimes: [entry('Work', 35)] }, {})).toBeNull();
    expect(commuteMinutes({}, { commuteLabel: 'Work' })).toBeNull();
    expect(commuteMinutes({ travelTimes: [entry('School', 10)] }, { commuteLabel: 'Work' })).toBeNull();
    expect(commuteMinutes({ travelTimes: [] }, { commuteLabel: 'Work' })).toBeNull();
  });

  it('judges in the mode of the address, from the context', () => {
    const listing = { travelTimes: [entry('Work', 50, { car: { minutes: 20 } })] };
    expect(commuteMinutes(listing, { commuteLabel: 'Work', commuteMode: 'car' })).toBe(20);
    expect(commuteMinutes(listing, { commuteLabel: 'Work', commuteMode: 'transit' })).toBe(50);
  });

  it('falls back to the mode stored on the row, then to transit', () => {
    const car = { travelTimes: [entry('Work', 50, { mode: 'car', car: { minutes: 20 } })] };
    expect(commuteMinutes(car, { commuteLabel: 'Work' })).toBe(20);
    const unlabelled = { travelTimes: [entry('Work', 50, { mode: null })] };
    expect(commuteMinutes(unlabelled, { commuteLabel: 'Work' })).toBe(50);
  });

  it('is missing when the mode it is judged in has no answer', () => {
    const listing = { travelTimes: [entry('Work', 50)] };
    expect(commuteMinutes(listing, { commuteLabel: 'Work', commuteMode: 'walk' })).toBeNull();
  });

  it('prefers an exact journey to an estimate for the same label', () => {
    const listing = { travelTimes: [entry('Work', 40, { estimate: true }), entry('Work', 31, { estimate: false })] };
    expect(commuteMinutes(listing, { commuteLabel: 'Work' })).toBe(31);
  });

  it('scores 20 minutes as 100 and 60 as 0', () => {
    const score = (minutes) =>
      scoreListing({ dealType: 'rent', travelTimes: [entry('Work', minutes)] }, null, { commuteLabel: 'Work' }, [
        byId('commute'),
      ]).groups[2].score;
    expect(score(20)).toBe(100);
    expect(score(40)).toBe(50);
    expect(score(60)).toBe(0);
  });
});

describe('work.jobs', () => {
  const jobs = byId('jobs');

  it('is the number of open posts in the kommune', () => {
    expect(jobs.raw({}, { kommuneJobs: 12 })).toBe(12);
    expect(jobs.raw({}, { kommuneJobs: 0 })).toBe(0);
  });

  it('is missing without a count', () => {
    expect(jobs.raw({}, {})).toBeNull();
    expect(jobs.raw({}, { kommuneJobs: null })).toBeNull();
  });

  it('is a kommune average at half weight by default', () => {
    expect(jobs.qualifier).toBe('kommune');
    expect(jobs.defaultWeight).toBe(0.5);
  });

  it('scores 20 posts as 100 and none as 0', () => {
    const score = (n) => scoreListing({ dealType: 'rent' }, null, { kommuneJobs: n }, [jobs]).groups[2].score;
    expect(score(20)).toBe(100);
    expect(score(10)).toBe(50);
    expect(score(0)).toBe(0);
  });

  it('counts for less than the commute inside the group', () => {
    const listing = { dealType: 'rent', travelTimes: [entry('Work', 20)] };
    const ctx = { commuteLabel: 'Work', kommuneJobs: 0 };
    const group = scoreListing(listing, null, ctx, [byId('commute'), jobs]).groups[2];
    // (100 x 1 + 0 x 0.5) / 1.5
    expect(group.score).toBe(66.7);
  });
});

describe('work.options', () => {
  it('is a placeholder until the transit sweeper exists', () => {
    const options = byId('options');
    expect(options.raw({}, { kommuneJobs: 3 })).toBeNull();
    const result = scoreListing({ dealType: 'rent' }, null, {}, [options]);
    expect(result.groups[2].metrics[0]).toMatchObject({ missing: true, score: 50, ideal: 6, worst: 0 });
  });
});

describe('the Work group', () => {
  it('registers commute, jobs and options', () => {
    expect(WORK_METRICS.map((metric) => metric.id)).toEqual(['commute', 'jobs', 'options']);
    expect(WORK_METRICS.every((metric) => metric.group === 'work')).toBe(true);
  });
});
