/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../../ui/src/services/i18n/i18n.jsx';
import SchoolPanel from '../../ui/src/components/map/SchoolPanel.jsx';
import { DEFAULT_SCHOOL_FILTERS, sanitizeSchoolFilters } from '../../ui/src/components/map/schoolFilters.js';

// Semi UI cannot be loaded under Node (its icon package pulls in a stylesheet), and what is being
// tested is the panel's own structure and rules rather than Semi's markup, so the handful of Semi
// components it uses are reduced to the plain elements that carry the same state.
vi.mock('@douyinfe/semi-ui-19', async () => {
  const { createElement: h } = await import('react');
  return {
    Button: ({ children }) => h('button', null, children),
    Checkbox: ({ checked, children }) =>
      h('label', null, h('input', { type: 'checkbox', checked, readOnly: true }), children),
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

const schools = [
  { id: '1', category: 'folkeskole', gradeAverage: 7.2 },
  { id: '2', category: 'friskole', gradeAverage: 9.4 },
  { id: '3', category: 'special', gradeAverage: null },
];

/** Renders the panel the way the map does, inside the app's translations. */
function render(props = {}, language = 'en') {
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      { language },
      createElement(SchoolPanel, {
        status: 'ready',
        enabled: true,
        onEnabledChange: () => {},
        filters: sanitizeSchoolFilters(DEFAULT_SCHOOL_FILTERS),
        onFiltersChange: () => {},
        schools,
        shownCount: 3,
        onReset: () => {},
        ...props,
      }),
    ),
  );
}

describe('SchoolPanel', () => {
  it('shows the count, the special switch, every kind of school and the score range when the layer is on', () => {
    const html = render();

    expect(html).toContain('Showing 3 of 3 schools');
    expect(html).toContain('Special schools');
    for (const kind of ['Folkeskole (municipal)', 'Free / private school', 'Efterskole (boarding)', 'Other']) {
      expect(html).toContain(kind);
    }
    expect(html).toContain('Grade average (9th grade)');
    expect(html).toContain('Include schools without a grade average');
  });

  it('draws each kind with the colour its markers have, so it doubles as the legend', () => {
    const html = render();

    for (const color of ['#7c3aed', '#0072b2', '#e69f00', '#009e73', '#6b7280']) {
      expect(html).toContain(color);
    }
  });

  it('spans the slider over the grades actually loaded', () => {
    const html = render();

    // 7.2 and 9.4 round outward to 7 and 10.
    expect(html).toMatch(/school-panel__sliderLabels[^>]*><span>7<\/span><span>10<\/span>/);
  });

  it('is only its switch while the layer is off', () => {
    const html = render({ enabled: false });

    expect(html).toContain('Schools');
    expect(html).not.toContain('Showing');
    expect(html).not.toContain('Grade average');
  });

  it.each(['loading', 'no-key', 'error'])('disables the switch and shows nothing else while %s', (status) => {
    const html = render({ status, enabled: true });

    expect(html).toMatch(/disabled/);
    expect(html).not.toContain('Showing');
  });

  it('offers a reset only once a filter differs from showing everything', () => {
    expect(render()).not.toContain('Reset');
    expect(render({ filters: sanitizeSchoolFilters({ showSpecial: false }), shownCount: 2 })).toContain('Reset');
    expect(render({ filters: sanitizeSchoolFilters({ scoreMin: 8 }), shownCount: 1 })).toContain('Reset');
  });

  it('reads in German too', () => {
    const html = render({}, 'de');

    expect(html).toContain('3 von 3 Schulen werden angezeigt');
    expect(html).toContain('Förderschulen');
    expect(html).toContain('Notendurchschnitt (9. Klasse)');
  });
});
