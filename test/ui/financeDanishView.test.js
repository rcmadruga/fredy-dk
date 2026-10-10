/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { financeDirtyState } from '../../ui/src/services/finance/financeDirty.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');

const page = read('ui/src/views/finance/FinanceCalculator.jsx');
const danish = read('ui/src/views/finance/components/DanishBuying.jsx');
const card = read('ui/src/views/listings/components/ListingFinanceCard.jsx');
const detail = read('ui/src/views/listings/ListingDetail.jsx');

describe('the buying tab has a Danish variant', () => {
  it('switches model with a stored choice, German by default', () => {
    expect(page).toMatch(/draft\.financing\?\.market === 'dk' \? 'dk' : 'de'/);
    expect(page).toMatch(/patchFinancing\(\{ market: event\.target\.value \}\)/);
    expect(page).toMatch(/<DanishBuying/);
  });

  it('keeps a stale Danish answer away from the German panels', () => {
    // A switch back to Germany shows the last (Danish) answer for a moment, which has no `financing`.
    expect(page).toMatch(/const deResult = result\?\.model === 'dk' \? null : result/);
    expect(page).toMatch(/<ResultSummary result=\{deResult\}/);
    expect(page).toMatch(/<MilestoneTimeline result=\{deResult\}/);
  });

  it('opens on Denmark when it arrives from a home priced in kroner', () => {
    expect(page).toMatch(/searchParams\.get\('market'\) === 'dk'/);
    expect(card).toMatch(/market=dk/);
    expect(detail).toMatch(/&market=dk/);
  });

  it('holds no Danish arithmetic: it shows what the server calculated', () => {
    expect(danish).not.toMatch(/from '(\.\.\/)+.*lib\//);
    expect(danish).not.toMatch(/finance\/dk\//);
    expect(danish).toMatch(/result\?\.model === 'dk'/);
  });

  it('shows the money in kroner', () => {
    expect(danish).toMatch(/'DKK'/);
    expect(danish).not.toMatch(/formatEuro/);
  });
});

describe('the Danish inputs are saved with the buying tab', () => {
  const baseline = { financing: { purchasePrice: 0, market: 'de', scenarios: [] } };

  it('counts a changed Danish input as an unsaved change to the buying tab only', () => {
    const edited = { financing: { ...baseline.financing, market: 'dk', dk: { bank: { rate: 5 } } } };
    expect(financeDirtyState(edited, baseline)).toMatchObject({ buy: true, rent: false, household: false });
  });

  it('is clean again once the input is put back', () => {
    const touched = { financing: { ...baseline.financing, dk: {} } };
    expect(financeDirtyState(touched, baseline).buy).toBe(false);
  });
});
