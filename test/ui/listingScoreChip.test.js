/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The tooltip's content is not rendered until hover, so the mock renders it inline to make it testable.
vi.mock('@douyinfe/semi-ui-19', async () => {
  const { createElement: h } = await import('react');
  return { Tooltip: ({ children, content }) => h('div', null, children, h('aside', null, content)) };
});

import { I18nProvider } from '../../ui/src/services/i18n/i18n.jsx';
import ListingScoreChip from '../../ui/src/components/listings/ListingScoreChip.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));

const compact = (total, groups = []) => ({ total, dealType: 'rent', groups });
const group = (id, score, extra = {}) => ({ id, score, weight: 1, off: false, missing: false, ...extra });

const render = (score, language = 'en') =>
  renderToStaticMarkup(createElement(I18nProvider, { language }, createElement(ListingScoreChip, { score })));

describe('ListingScoreChip', () => {
  it('shows the total, rounded', () => {
    expect(render(compact(78.4, [group('money', 80)]))).toContain('>78</span>');
  });

  it.each([
    [100, 'good'],
    [70, 'good'],
    [69, 'fair'],
    [40, 'fair'],
    [39, 'poor'],
    [0, 'poor'],
  ])('bands %s as %s', (total, band) => {
    expect(render(compact(total))).toContain(`listingScoreChip--${band}`);
  });

  it('lists the score of each group on hover', () => {
    const html = render(
      compact(60, [group('money', 82.2), group('schools', null, { off: true }), group('area', 50, { missing: true })]),
    );
    expect(html).toContain('Money');
    expect(html).toContain('<span>82</span>');
    expect(html).toContain('Schools');
    expect(html).toContain('<span>Off</span>');
    expect(html).toContain('<span>unknown</span>');
  });

  it('is named for assistive technology', () => {
    expect(render(compact(78))).toContain('aria-label="Score 78 of 100"');
    expect(render(compact(78), 'de')).toContain('aria-label="Score 78 von 100"');
  });

  it('renders nothing without a score, or with every group off', () => {
    expect(render(null)).toBe('');
    expect(render(undefined)).toBe('');
    expect(render(compact(null, [group('money', null, { off: true })]))).toBe('');
  });

  it('is wired into both the table and the grid of the overview', () => {
    for (const file of ['components/table/ListingsTable.jsx', 'components/grid/listings/ListingsGrid.jsx']) {
      const source = fs.readFileSync(path.join(here, '../../ui/src', file), 'utf-8');
      expect(source, file).toContain('<ListingScoreChip score={item.score} />');
    }
  });
});
