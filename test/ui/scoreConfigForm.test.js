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

// Semi UI cannot be loaded under Node. What is tested is the form's own structure and what it asks the
// parent to store, so the few Semi controls are reduced to plain elements carrying the same state.
vi.mock('@douyinfe/semi-ui-19', async () => {
  const { createElement: h } = await import('react');
  const Select = ({ children, value }) => h('select', { value, readOnly: true }, children);
  Select.Option = ({ children, value }) => h('option', { value }, children);
  return {
    Button: ({ children, onClick, ...rest }) =>
      h('button', { onClick, 'aria-expanded': rest['aria-expanded'] }, children),
    InputNumber: (props) =>
      h('input', {
        type: 'number',
        'aria-label': props['aria-label'],
        placeholder: props.placeholder,
        value: props.value,
        readOnly: true,
        'data-invalid': props.validateStatus === 'error' ? 'true' : undefined,
      }),
    Select,
    Slider: ({ value }) => h('input', { type: 'range', value, readOnly: true, 'data-slider': 'true' }),
  };
});
vi.mock('../../ui/src/services/state/store', () => ({
  useSelector: (selector) =>
    selector({
      userSettings: {
        settings: {
          home_addresses: [
            { label: 'Work', mode: 'transit' },
            { label: 'Groceries', mode: 'walk', kind: 'category', category: 'supermarket' },
          ],
        },
      },
    }),
}));

import { I18nProvider } from '../../ui/src/services/i18n/i18n.jsx';
import ScoreConfig from '../../ui/src/views/jobs/mutation/components/ScoreConfig.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));

const render = (props, language = 'en') =>
  renderToStaticMarkup(
    createElement(I18nProvider, { language }, createElement(ScoreConfig, { onChange: () => {}, ...props })),
  );

describe('ScoreConfig', () => {
  it('offers a slider per group of a rental, five of them', () => {
    const html = render({ value: null, dealType: 'rent' });
    expect(html.match(/data-slider/g)).toHaveLength(5);
    expect(html).not.toContain('>Deal<');
  });

  it('adds the Deal slider for a purchase, six in all', () => {
    const html = render({ value: null, dealType: 'buy' });
    expect(html.match(/data-slider/g)).toHaveLength(6);
    expect(html).toContain('>Deal<');
  });

  it('offers the five for a job whose deal type is not chosen yet', () => {
    expect(render({ value: null, dealType: null }).match(/data-slider/g)).toHaveLength(5);
  });

  it('shows the weights it was given, and a group at 0 as off', () => {
    const html = render({ value: { groups: { money: 2, schools: 0 } }, dealType: 'rent' });
    expect(html).toContain('×2');
    expect(html).toContain('scoreConfig__weight--off');
    expect(html).toContain('>Off<');
  });

  it('lists the saved addresses for the commute, but not a kind of place', () => {
    const html = render({ value: { commute: { label: 'Work' } }, dealType: 'rent' });
    expect(html).toMatch(/<option value="Work"[^>]*>Work<\/option>/);
    expect(html).not.toContain('>Groceries<');
    expect(html).toContain('The address with a commute limit');
  });

  it('keeps the per-metric inputs behind "Advanced"', () => {
    const html = render({ value: null, dealType: 'rent' });
    expect(html).toContain('Advanced: weights and targets per metric');
    expect(html).not.toContain('scoreConfig__fieldset');
  });

  it('is written in the language asked for', () => {
    const html = render({ value: null, dealType: 'rent' }, 'de');
    expect(html).toContain('Wo ist die Arbeit?');
    expect(html).toContain('>Geld<');
  });

  it('is wired into the job form, which saves what it holds', () => {
    const form = fs.readFileSync(path.join(here, '../../ui/src/views/jobs/mutation/JobMutation.jsx'), 'utf-8');
    expect(form).toContain('<ScoreConfig value={scoreConfig} onChange={setScoreConfig} dealType={dealType} />');
    expect(form).toMatch(/commuteFilter,\s+scoreConfig,\s+dealType,/);
  });
});
