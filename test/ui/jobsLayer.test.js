/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../../ui/src/services/i18n/i18n.jsx';
import JobsPanel from '../../ui/src/components/map/JobsPanel.jsx';
import {
  applyJobsAreaLayer,
  applyJobsPointLayer,
  jobsToGeoJson,
  removeJobsAreaLayer,
  removeJobsPointLayer,
  JOB_COUNT_STEPS,
  JOBS_AREA_SOURCE_ID,
  JOBS_FILL_LAYER_ID,
  JOBS_OUTLINE_LAYER_ID,
  JOBS_POINT_LAYER_ID,
  JOBS_POINT_SOURCE_ID,
} from '../../ui/src/components/map/regionalDataLayers.js';
import { buildJobPostingPopupHtml, buildJobsAreaPopupHtml } from '../../ui/src/components/map/regionalPopups.js';
import en from '../../ui/src/locales/en.json';

// Semi UI cannot be loaded under Node (see groceryPanel.test.js); the few components the panel uses
// are reduced to plain elements that carry the same state.
vi.mock('@douyinfe/semi-ui-19', async () => {
  const { createElement: h } = await import('react');
  return {
    Spin: () => h('span', { 'data-spin': true }),
    Switch: ({ checked, ...rest }) =>
      h('input', { type: 'checkbox', role: 'switch', checked, readOnly: true, 'aria-label': rest['aria-label'] }),
    Typography: { Text: ({ children }) => h('span', null, children) },
  };
});

/** A map reduced to the source and layer methods the jobs layers use. */
function makeMap() {
  const sources = {};
  const layers = [];
  return {
    sources,
    layers,
    getSource: (id) => sources[id],
    addSource: (id, spec) => {
      sources[id] = { spec, setData: vi.fn((data) => (spec.data = data)) };
      sources[id].spec = spec;
    },
    getLayer: (id) => layers.find((l) => l.id === id),
    addLayer: (layer) => layers.push(layer),
    removeLayer: (id) =>
      layers.splice(
        layers.findIndex((l) => l.id === id),
        1,
      ),
    removeSource: (id) => delete sources[id],
  };
}

const posting = (extra = {}) => ({
  id: 'a@0269',
  title: 'Ernæringsassistent',
  employer: 'Plejehjemmet',
  url: 'https://www.jobindex.dk/vis-job/a',
  lastDate: '2026-10-26',
  tier: 'exact',
  kommuneCode: '0269',
  kommuneName: 'Solrød',
  lat: 55.52,
  lng: 12.2,
  approximate: false,
  alsoIn: [],
  ...extra,
});
const areaData = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', id: '0269', geometry: {}, properties: { count: 1 } }],
};

describe('the jobs-by-kommune layer', () => {
  it('adds a fill that is empty for a kommune with no adverts, and an outline', () => {
    const map = makeMap();

    applyJobsAreaLayer(map, areaData);

    expect(map.sources[JOBS_AREA_SOURCE_ID]).toBeDefined();
    const fill = map.getLayer(JOBS_FILL_LAYER_ID);
    expect(fill.type).toBe('fill');
    // step on the count: transparent below 1, then one colour per step.
    expect(fill.paint['fill-color'].slice(0, 3)).toEqual(['step', ['get', 'count'], 'rgba(0, 0, 0, 0)']);
    expect(fill.paint['fill-color'].slice(3)).toEqual(JOB_COUNT_STEPS.flatMap((s) => [s.min, s.color]));
    expect(map.getLayer(JOBS_OUTLINE_LAYER_ID)).toBeDefined();
  });

  it('is idempotent: a second apply updates the data instead of adding another layer', () => {
    const map = makeMap();

    applyJobsAreaLayer(map, areaData);
    applyJobsAreaLayer(map, areaData);

    expect(map.layers).toHaveLength(2);
    expect(map.sources[JOBS_AREA_SOURCE_ID].setData).toHaveBeenCalledTimes(1);
  });

  it('is removed by null, by an empty collection, and by remove', () => {
    for (const data of [null, { type: 'FeatureCollection', features: [] }]) {
      const map = makeMap();
      applyJobsAreaLayer(map, areaData);
      applyJobsAreaLayer(map, data);
      expect(map.layers).toHaveLength(0);
      expect(map.sources[JOBS_AREA_SOURCE_ID]).toBeUndefined();
    }
    const map = makeMap();
    applyJobsAreaLayer(map, areaData);
    removeJobsAreaLayer(map);
    removeJobsAreaLayer(map); // already gone: must not throw
    expect(map.layers).toHaveLength(0);
  });

  it('has steps that rise and start at one advert', () => {
    expect(JOB_COUNT_STEPS[0].min).toBe(1);
    const mins = JOB_COUNT_STEPS.map((s) => s.min);
    expect(mins).toEqual([...mins].sort((a, b) => a - b));
  });
});

describe('the job dots', () => {
  it('turns postings into points at [lng, lat], carrying what the popup shows', () => {
    const { features } = jobsToGeoJson([posting({ alsoIn: ['Esbjerg', 'Varde'], approximate: true })]);

    expect(features[0].geometry).toEqual({ type: 'Point', coordinates: [12.2, 55.52] });
    expect(features[0].properties).toMatchObject({
      title: 'Ernæringsassistent',
      employer: 'Plejehjemmet',
      kommuneName: 'Solrød',
      approximate: true,
      alsoIn: 'Esbjerg, Varde',
    });
  });

  it('draws a solid dot for a workplace and a ring for a centre, in one layer', () => {
    const map = makeMap();

    applyJobsPointLayer(map, [posting(), posting({ id: 'b@0269', approximate: true })]);

    const layer = map.getLayer(JOBS_POINT_LAYER_ID);
    expect(layer.type).toBe('circle');
    expect(layer.paint['circle-color'][0]).toBe('case');
    expect(layer.paint['circle-color'][1]).toEqual(['get', 'approximate']);
    expect(map.sources[JOBS_POINT_SOURCE_ID].spec.data.features).toHaveLength(2);
  });

  it('updates in place and removes cleanly', () => {
    const map = makeMap();
    applyJobsPointLayer(map, [posting()]);
    applyJobsPointLayer(map, [posting(), posting({ id: 'c@0101' })]);
    expect(map.layers).toHaveLength(1);
    expect(map.sources[JOBS_POINT_SOURCE_ID].setData).toHaveBeenCalledTimes(1);

    applyJobsPointLayer(map, []);
    expect(map.layers).toHaveLength(0);
    removeJobsPointLayer(map);
  });
});

// Echoes the key and its values, so an assertion can say which line carries what.
const t = (key, values) => (values ? `${key}(${Object.values(values).join(',')})` : key);

describe('the jobs popups', () => {
  it('says how many adverts a kommune has', () => {
    const html = buildJobsAreaPopupHtml({ name: 'Solrød', count: 3 }, t);

    expect(html).toContain('<h4>Solrød</h4>');
    expect(html).toContain('map.jobsAreaPopupCount(3)');
  });

  it('shows an advert with its employer, deadline and a link back to Jobindex', () => {
    const html = buildJobPostingPopupHtml(
      {
        title: 'Ernæringsassistent',
        employer: 'Plejehjemmet',
        url: 'https://www.jobindex.dk/vis-job/a',
        lastDate: '2026-10-26',
        kommuneName: 'Solrød',
        approximate: false,
        alsoIn: '',
      },
      t,
    );

    expect(html).toContain('<h4>Ernæringsassistent</h4>');
    expect(html).toContain('Plejehjemmet');
    expect(html).toContain('map.jobsPopupDeadline(2026-10-26)');
    expect(html).toContain('href="https://www.jobindex.dk/vis-job/a"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('map.jobsPopupApproximate');
  });

  it('says when the position is only a centre, and when the advert is in other towns too', () => {
    // MapLibre hands booleans back as booleans, but a serialised property can be the string.
    for (const approximate of [true, 'true']) {
      const html = buildJobPostingPopupHtml({ title: 'x', kommuneName: 'Varde', approximate, alsoIn: 'Esbjerg' }, t);

      expect(html).toContain('map.jobsPopupApproximate');
      expect(html).toContain('map.jobsPopupAlsoIn(Esbjerg)');
    }
  });

  it('escapes what came from a scraped page, and refuses a link that is not Jobindex', () => {
    const html = buildJobPostingPopupHtml(
      {
        title: '<img src=x onerror=alert(1)>',
        employer: '"><script>alert(2)</script>',
        url: 'https://evil.example/phish',
        kommuneName: 'Solrød',
      },
      t,
    );

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('<a ');
    expect(buildJobPostingPopupHtml({ title: 'x', url: 'javascript:alert(1)' }, t)).not.toContain('<a ');
  });
});

const render = (props = {}) =>
  renderToStaticMarkup(
    createElement(
      I18nProvider,
      { language: 'en' },
      createElement(JobsPanel, {
        status: 'ready',
        areaEnabled: true,
        onAreaEnabledChange: () => {},
        pointsEnabled: false,
        onPointsEnabledChange: () => {},
        total: 93,
        kommuneCount: 38,
        fetchedAt: Date.UTC(2026, 9, 4),
        ...props,
      }),
    ),
  );

describe('JobsPanel', () => {
  it('has the two switches', () => {
    const html = render({ areaEnabled: false });

    expect(html).toContain('Jobs by kommune');
    expect(html).toContain('Job adverts');
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html).not.toContain('adverts in');
  });

  it('shows the summary, the date and the shading legend when the shading is on', () => {
    const html = render();

    expect(html).toContain('93 adverts in 38 kommuner');
    expect(html).toContain('as of');
    expect(html).toContain('Adverts per kommune');
    expect(html).toContain('10+');
    expect(html).not.toContain('Workplace address');
  });

  it('labels the steps as ranges, closing the last one', () => {
    const html = render();

    for (const label of ['>1<', '>2<', '>3-4<', '>5-9<', '>10+<']) expect(html).toContain(label);
  });

  it('explains the solid dot and the ring when the dots are on', () => {
    const html = render({ areaEnabled: false, pointsEnabled: true });

    expect(html).toContain('Workplace address');
    expect(html).toContain('Town or postcode centre');
    expect(html).not.toContain('Adverts per kommune');
  });

  it('credits Jobindex with a link', () => {
    expect(render()).toContain('href="https://www.jobindex.dk/"');
  });

  it('says it is loading, and says so after a failure', () => {
    expect(render({ status: 'loading' })).toContain('first load can take a minute');
    const failed = render({ status: 'error' });
    expect(failed).toContain('could not be loaded');
    expect(failed).not.toContain('adverts in');
  });

  it('shows nothing about the data while both switches are off', () => {
    const html = render({ areaEnabled: false, pointsEnabled: false, status: 'loading' });

    expect(html).not.toContain('first load');
  });

  it('copes with no date', () => {
    expect(render({ fetchedAt: null })).not.toContain('as of');
  });
});

describe('the English strings', () => {
  it('has every key the panel and popups ask for', () => {
    const keys = [
      'map.groupJobs',
      'map.filterJobsArea',
      'map.filterJobsPoints',
      'map.jobsLoading',
      'map.jobsError',
      'map.jobsSummary',
      'map.jobsAsOf',
      'map.jobsLegendArea',
      'map.jobsLegendPoints',
      'map.jobsLegendExact',
      'map.jobsLegendApproximate',
      'map.jobsCredit',
      'map.jobsAreaPopupCount',
      'map.jobsPopupAlsoIn',
      'map.jobsPopupApproximate',
      'map.jobsPopupDeadline',
      'map.jobsPopupOpen',
    ];
    expect(keys.filter((k) => typeof en[k] !== 'string')).toEqual([]);
  });
});
