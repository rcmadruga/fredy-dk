/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '../../ui/src/views/listings/components');
const jsx = fs.readFileSync(path.join(dir, 'ListingSaleCard.jsx'), 'utf-8');
const less = fs.readFileSync(path.join(dir, 'ListingSaleCard.less'), 'utf-8');

/**
 * The layout itself is checked in a browser (the table clipped its last column at 1400 px, where the card
 * sits in a rail of about 400 px). These guard the two pieces it hangs on: the table answers to the width of
 * its own box rather than the window's, and every cell that loses its column header when stacked names itself.
 */
describe('the earlier-sales table layout', () => {
  it('stacks by the width of its own box, not the window', () => {
    expect(less).toMatch(/&__table-wrap\s*{[^}]*container-type:\s*inline-size/);
    expect(less).toMatch(/@container \(max-width: \d+rem\)/);
  });

  it('labels the price per m² and change cells, which have no header once stacked', () => {
    expect(jsx).toContain("data-label={t('listing.detail.saleSalesPerM2')}");
    expect(jsx).toContain("data-label={t('listing.detail.saleSalesChange')}");
    expect(less).toContain('attr(data-label)');
  });

  it('keeps the column headers in the document for assistive technology', () => {
    expect(less).not.toMatch(/thead\s*{[^}]*display:\s*none/);
  });
});
