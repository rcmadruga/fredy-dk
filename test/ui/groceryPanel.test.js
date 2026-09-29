/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../../ui/src/services/i18n/i18n.jsx';
import DenmarkPanel from '../../ui/src/components/map/DenmarkPanel.jsx';
import GroceryPanel from '../../ui/src/components/map/GroceryPanel.jsx';
import { DEFAULT_GROCERY_FILTERS, sanitizeGroceryFilters } from '../../ui/src/components/map/groceryFilters.js';
import { DEFAULT_SCHOOL_FILTERS, sanitizeSchoolFilters } from '../../ui/src/components/map/schoolFilters.js';

// Semi UI cannot be loaded under Node, and what is tested is the panel's own structure, so the few
// components it uses are reduced to plain elements that carry the same state (see schoolPanel.test.js).
vi.mock('@douyinfe/semi-ui-19', async () => {
  const { createElement: h } = await import('react');
  return {
    Button: ({ children }) => h('button', null, children),
    Checkbox: ({ checked, children }) =>
      h('label', null, h('input', { type: 'checkbox', checked, readOnly: true }), children),
    Spin: () => h('span', { 'data-spin': true }),
    Switch: ({ checked, disabled, ...rest }) =>
      h('input', {
        type: 'checkbox',
        role: 'switch',
        checked,
        disabled,
        readOnly: true,
        'aria-label': rest['aria-label'],
      }),
    Tooltip: ({ children }) => children,
    Typography: { Text: ({ children }) => h('span', null, children) },
  };
});

const counts = { netto: 3, rema: 2, foetex: 0, bilka: 0, coop: 1, lidl: 0, aldi: 0, meny: 0, other: 4 };

const render = (props = {}) =>
  renderToStaticMarkup(
    createElement(
      I18nProvider,
      { language: 'en' },
      createElement(GroceryPanel, {
        status: 'ready',
        enabled: true,
        onEnabledChange: () => {},
        filters: sanitizeGroceryFilters(DEFAULT_GROCERY_FILTERS),
        onFiltersChange: () => {},
        counts,
        total: 10,
        shownCount: 10,
        onReset: () => {},
        ...props,
      }),
    ),
  );

describe('GroceryPanel', () => {
  it('offers only the switch while the layer is off', () => {
    const html = render({ enabled: false });
    expect(html).toContain('Supermarkets');
    expect(html).not.toContain('Showing');
  });

  it('lists the chains that have stores, with their counts, and hides the empty ones', () => {
    const html = render();
    expect(html).toContain('Showing 10 of 10 stores');
    expect(html).toContain('Netto (3)');
    expect(html).toContain('Rema 1000 (2)');
    expect(html).not.toContain('Lidl');
  });

  it('says it is loading, on the first switch-on', () => {
    const html = render({ status: 'loading', total: 0, shownCount: 0 });
    expect(html).toContain('first load can take a minute');
    expect(html).not.toContain('Netto (');
  });

  it('says so after a failed fetch, and leaves the switch usable so it can be tried again', () => {
    const html = render({ status: 'error', total: 0, shownCount: 0 });
    expect(html).toContain('could not be loaded');
    expect(html).not.toMatch(/role="switch"[^>]*disabled/);
  });

  it('offers a reset only when a filter is set', () => {
    expect(render()).not.toContain('Reset');
    expect(render({ filters: sanitizeGroceryFilters({ chains: { netto: false } }) })).toContain('Reset');
  });
});

describe('DenmarkPanel', () => {
  it('has the SCHOOLS, KOMMUNE and GROCERIES groups, in that order', () => {
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { language: 'en' },
        createElement(DenmarkPanel, {
          taxLayer: false,
          onTaxLayerChange: () => {},
          status: 'ready',
          enabled: false,
          onEnabledChange: () => {},
          filters: sanitizeSchoolFilters(DEFAULT_SCHOOL_FILTERS),
          onFiltersChange: () => {},
          schools: [],
          shownCount: 0,
          onReset: () => {},
          groceries: {
            status: 'idle',
            enabled: false,
            onEnabledChange: () => {},
            filters: sanitizeGroceryFilters(DEFAULT_GROCERY_FILTERS),
            onFiltersChange: () => {},
            counts,
            total: 0,
            shownCount: 0,
            onReset: () => {},
          },
        }),
      ),
    );
    const at = (heading) => html.indexOf(`>${heading}<`);
    expect(at('Schools')).toBeGreaterThan(-1);
    expect(at('Schools')).toBeLessThan(at('Kommune'));
    expect(at('Kommune')).toBeLessThan(at('Groceries'));
  });
});
