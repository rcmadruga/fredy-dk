/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import * as dk from '../../../../lib/services/finance/dk/constants.js';

const source = fs.readFileSync(new URL('../../../../lib/services/finance/dk/constants.js', import.meta.url), 'utf8');

describe('Danish finance constants', () => {
  it('carries the verified statutory figures', () => {
    expect(dk.TINGLYSNING_SKOEDE_FIXED).toBe(1850);
    expect(dk.TINGLYSNING_SKOEDE_PCT).toBe(0.6);
    expect(dk.TINGLYSNING_ROUNDING).toBe(100);
    expect(dk.TINGLYSNING_PANT_FIXED).toBe(1825);
    expect(dk.TINGLYSNING_PANT_PCT).toBe(1.25);
    expect(dk.EJENDOMSVAERDISKAT_PCT).toBe(0.51);
    expect(dk.EJENDOMSVAERDISKAT_HIGH_PCT).toBe(1.4);
    expect(dk.TAX_BASE_FACTOR).toBe(0.8);
    expect(dk.EJENDOMSVAERDISKAT_PROGRESSION_LIMIT).toBe(9007000);
  });

  it('keeps the bidrag bands ordered and ending at the realkredit cap', () => {
    const limits = dk.DEFAULT_BIDRAG_BANDS.map((band) => band.upToLtvPct);
    expect(limits).toEqual([...limits].sort((a, b) => a - b));
    expect(limits.at(-1)).toBe(dk.DEFAULT_REALKREDIT_PCT);
  });

  it('dates every verified constant and names a source for it', () => {
    const verified = source.split('/**').filter((block) => block.includes('Verified 2026-10-10'));
    expect(verified.length).toBe(9);
    for (const block of verified) {
      expect(block).toMatch(/https:\/\/|same .*(source|page)|as above/i);
    }
  });
});
