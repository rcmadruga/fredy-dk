/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import { currencyUnit } from '../../ui/src/services/price/priceService.js';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '../../ui/src');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf-8');

describe('currencyUnit', () => {
  it('is the euro sign for euros, in every language, and for anything unstated', () => {
    expect(currencyUnit('EUR', 'de-DE')).toBe('€');
    expect(currencyUnit('EUR', 'en-GB')).toBe('€');
    expect(currencyUnit()).toBe('€');
    expect(currencyUnit('nonsense', 'de-DE')).toBe('€');
  });

  it('is kr for kroner, written the way the language writes it', () => {
    expect(currencyUnit('DKK', 'en-GB')).toMatch(/^kr\.?$/);
    expect(currencyUnit('DKK', 'da-DK')).toBe('kr.');
  });
});

describe('the household block and the footer in Denmark mode', () => {
  it('no longer carry a hardcoded euro sign on an amount', () => {
    for (const file of ['views/finance/components/HouseholdHeadline.jsx', 'views/finance/components/ProfileForm.jsx']) {
      expect(read(file), file).not.toContain('suffix="€"');
    }
  });

  it('pick the Danish disclaimer with the Danish buying tab, and the German one otherwise', () => {
    const page = read('views/finance/FinanceCalculator.jsx');
    expect(page).toContain("activeTab === 'buy' && market === 'dk'");
    expect(page).toContain("danishMode ? 'finance.disclaimerDk' : 'finance.disclaimer'");
  });

  it('have the Danish disclaimer in every language, naming no German costs', () => {
    const dir = path.join(root, 'locales');
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json'))) {
      const text = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'))['finance.disclaimerDk'];
      expect(text, file).toEqual(expect.any(String));
      expect(text).not.toMatch(/German|deutsch|alem|allem|tedesc|Alman/i);
    }
  });
});
