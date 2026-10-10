/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { normalizeGetListing } from '../../lib/mcp/mcpNormalizer.js';

const textOf = (result) => result.content.map((part) => part.text).join('\n');

const listing = (saleTerms) => ({
  id: 'dk1',
  title: 'Villa i Odense',
  price: 2000000,
  dealType: 'buy',
  provider: 'boligsiden',
  sale_terms: saleTerms,
});

describe('get_listing for a for-sale listing', () => {
  it('prints the sale terms in kroner', () => {
    const md = textOf(
      normalizeGetListing(
        listing({
          ownerCostMonthly: 3900,
          pricePerM2: 26322,
          publicValuation: 2700000,
          downPayment: 325000,
          grossPaymentMonthly: 35406,
          netPaymentMonthly: 28476,
          sales: [
            { date: '2015-06-01', amount: 1700000, type: 'normal', area: 120 },
            { date: '2001-03-15', amount: 900000, type: 'family', area: 120 },
          ],
          daysOnMarket: { current: 20, total: 406 },
          priceChangePct: -4.09,
          previousRealtors: ['home Odense - Skibhus'],
        }),
      ),
    );

    expect(md).toContain("- **Ejerudgift (owner's monthly costs):** 3.900 kr");
    expect(md).toContain('- **Price per m²:** 26.322 kr');
    expect(md).toContain('- **Public valuation:** 2.700.000 kr');
    expect(md).toContain('35.406 kr before tax relief, 28.476 kr after');
    expect(md).toContain('2015-06-01 1.700.000 kr; 2001-03-15 900.000 kr (family, not a market price)');
    expect(md).toContain('20 with the current realtor, 406 in total');
    expect(md).toContain('- **Price change since first listed:** -4.09 %');
    expect(md).toContain('- **Previous realtors:** home Odense - Skibhus');
  });

  it('leaves out what the advert did not state', () => {
    const md = textOf(normalizeGetListing(listing({ ownerCostMonthly: 3900 })));

    expect(md).toContain('Ejerudgift');
    expect(md).not.toContain('Price per m²');
    expect(md).not.toContain('Earlier sales');
    expect(md).not.toContain('Days on market');
  });

  it('prints nothing of the kind for a listing with no sale terms', () => {
    const md = textOf(normalizeGetListing(listing(null)));

    expect(md).not.toContain('Ejerudgift');
    expect(md).not.toContain('Earlier sales');
  });
});
