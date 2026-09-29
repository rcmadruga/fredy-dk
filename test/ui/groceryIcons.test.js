/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  chainIdOfLogoPath,
  glyphColorOn,
  glyphFor,
  hasLogo,
  logoUrlOf,
  withExplicitSize,
} from '../../ui/src/components/map/groceryIcons.js';
import { GROCERY_CHAINS } from '../../ui/src/components/map/groceryFilters.js';

const LOGO_DIR = path.resolve('ui/src/assets/map-logos');

describe('the logo files', () => {
  const files = fs.readdirSync(LOGO_DIR).filter((file) => /\.(svg|png)$/.test(file));

  it('are each named after a chain the map knows', () => {
    const known = GROCERY_CHAINS.map((chain) => chain.id);
    for (const file of files) {
      expect(known, `${file} does not belong to any chain`).toContain(chainIdOfLogoPath(file));
    }
  });

  it('are found for every chain that has one, and only for those', () => {
    for (const chain of GROCERY_CHAINS) {
      const onDisk = files.some((file) => chainIdOfLogoPath(file) === chain.id);
      expect(hasLogo(chain.id), chain.id).toBe(onDisk);
      expect(logoUrlOf(chain.id) != null, chain.id).toBe(onDisk);
    }
  });

  it('are all credited in the README', () => {
    const readme = fs.readFileSync(path.join(LOGO_DIR, 'README.md'), 'utf8');
    for (const file of files) expect(readme, `${file} is not credited`).toContain(`\`${file}\``);
  });

  it('do not include the German Netto, which is a different company', () => {
    // A guard against putting Netto Marken-Discount's logo on Danish stores again.
    if (hasLogo('netto')) {
      const svg = fs.readFileSync(path.join(LOGO_DIR, 'netto.svg'), 'utf8');
      expect(svg).not.toMatch(/Marken-Discount/i);
    }
  });
});

describe('chainIdOfLogoPath', () => {
  it('takes the chain from the file name', () => {
    expect(chainIdOfLogoPath('../../assets/map-logos/rema.svg')).toBe('rema');
    expect(chainIdOfLogoPath('meny.png')).toBe('meny');
  });
});

describe('withExplicitSize', () => {
  it('gives a viewBox-only SVG the size of its viewBox', () => {
    const sized = withExplicitSize('<svg xmlns="x" viewBox="0 0 115 90"><path d="M0 0"/></svg>');
    expect(sized).toContain('width="115"');
    expect(sized).toContain('height="90"');
  });

  it('replaces sizes that were in some other unit', () => {
    const sized = withExplicitSize('<svg width="134px" height="50px" viewBox="0 0 134 50"></svg>');
    expect(sized).toBe('<svg width="134" height="50" viewBox="0 0 134 50"></svg>');
  });

  it('leaves a document it cannot read alone', () => {
    expect(withExplicitSize('<svg></svg>')).toBe('<svg></svg>');
    expect(withExplicitSize('not svg')).toBe('not svg');
  });
});

describe('the fallback badge', () => {
  it('has a glyph for every chain: a cart, and a storefront for the independents', () => {
    for (const chain of GROCERY_CHAINS) expect(glyphFor(chain.id).length, chain.id).toBeGreaterThan(20);
    expect(glyphFor('other')).not.toBe(glyphFor('netto'));
  });

  it('puts dark on light colours and white on dark ones', () => {
    expect(glyphColorOn('#f0c800')).toBe('#1f2937');
    expect(glyphColorOn('#264653')).toBe('#ffffff');
  });
});
