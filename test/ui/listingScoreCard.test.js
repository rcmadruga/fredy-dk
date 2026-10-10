/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Semi UI and its icons cannot be loaded under Node, chart.js needs a canvas, and the currency hook
// reads the store. What is tested is the card's own structure, and what it hands the chart.
vi.mock('@douyinfe/semi-ui-19', () => ({ Tooltip: ({ children }) => children }));
vi.mock('@douyinfe/semi-icons', async () => {
  const { createElement: h } = await import('react');
  const icon = (name) => () => h('i', { 'data-icon': name });
  return {
    IconChevronDown: icon('down'),
    IconChevronRight: icon('right'),
    IconHelpCircle: icon('help'),
  };
});
vi.mock('react-chartjs-2', async () => {
  const { createElement: h } = await import('react');
  return {
    Radar: (props) => {
      globalThis.__radar = props;
      return h('canvas');
    },
  };
});
vi.mock('../../ui/src/hooks/useCurrencyOf.js', () => ({ useCurrencyOf: () => () => 'EUR' }));
vi.mock('chart.js', () => ({
  Chart: { register: () => {} },
  ArcElement: {},
  BarElement: {},
  CategoryScale: {},
  Filler: {},
  Legend: {},
  LineElement: {},
  LinearScale: {},
  PointElement: {},
  RadialLinearScale: {},
  Title: {},
  Tooltip: {},
}));

import { I18nProvider } from '../../ui/src/services/i18n/i18n.jsx';
import ListingScoreCard from '../../ui/src/views/listings/components/ListingScoreCard.jsx';
import { scoreListing } from '../../lib/services/score/score.js';

const metricsFor = (listing, config = null, ctx = {}) => scoreListing(listing, config, ctx);

function render(listing, language = 'en') {
  globalThis.__radar = undefined;
  return renderToStaticMarkup(createElement(I18nProvider, { language }, createElement(ListingScoreCard, { listing })));
}

describe('ListingScoreCard', () => {
  it('renders nothing for a listing without a score', () => {
    expect(render({ id: 'a', score: null })).toBe('');
    expect(render({ id: 'a' })).toBe('');
  });

  it('draws a hexagon for a purchase', () => {
    const html = render({ id: 'a', provider: 'x', score: metricsFor({ dealType: 'buy', price: 1, size: 1 }) });
    expect(globalThis.__radar.data.labels).toEqual(['Money', 'Schools', 'Work', 'Home', 'Area', 'Deal']);
    expect(globalThis.__radar.data.datasets[0].data).toHaveLength(6);
    expect(html).toContain('6 spokes');
  });

  it('draws a pentagon for a rental, the same corners without Deal', () => {
    render({ id: 'a', score: metricsFor({ dealType: 'rent' }) });
    expect(globalThis.__radar.data.labels).toEqual(['Money', 'Schools', 'Work', 'Home', 'Area']);
  });

  it('keeps the shape when a group is switched off, and marks the spoke', () => {
    render({ id: 'a', score: metricsFor({ dealType: 'rent' }, { groups: { schools: 0 } }) });
    const dataset = globalThis.__radar.data.datasets[0];
    expect(dataset.data).toHaveLength(5);
    expect(dataset.data[1]).toBe(0);
    expect(dataset.pointStyle[1]).toBe('crossRot');
  });

  it('draws a group with no data as a hollow marker', () => {
    render({ id: 'a', score: metricsFor({ dealType: 'rent' }) });
    const dataset = globalThis.__radar.data.datasets[0];
    expect(dataset.pointStyle).toEqual(Array(5).fill('rectRot'));
  });

  it('takes its colours from the theme getters, not from literals', () => {
    render({ id: 'a', score: metricsFor({ dealType: 'rent' }) });
    const dataset = globalThis.__radar.data.datasets[0];
    expect(dataset.borderColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(globalThis.__radar.options.scales.r.grid.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('shows the total and a row per group, collapsed', () => {
    const html = render({
      id: 'a',
      score: metricsFor({ dealType: 'rent', price: 800, size: 60 }, null, { job: { maxPrice: 1000 } }),
    });
    expect(html).toContain('out of 100');
    expect(html.match(/listing-score__group-head/g)).toHaveLength(5);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('listing-score__metrics');
  });

  it('writes the words in the language asked for', () => {
    render({ id: 'a', score: metricsFor({ dealType: 'rent' }) }, 'de');
    expect(globalThis.__radar.data.labels).toEqual(['Geld', 'Schulen', 'Arbeit', 'Wohnung', 'Umgebung']);
  });

  it('labels the chart for assistive technology', () => {
    const html = render({ id: 'a', score: metricsFor({ dealType: 'rent' }) });
    expect(html).toContain('role="img"');
    expect(html).toContain('Radar chart with 5 spokes');
  });
});
