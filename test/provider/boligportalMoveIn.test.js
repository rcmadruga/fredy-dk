/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// The advert page is what a browser would fetch; here it is handed back as text.
const fetchSearchHtml = vi.fn();
vi.mock('../../lib/services/boligportal/boligportalSearch.js', () => ({
  fetchSearchHtml: (...args) => fetchSearchHtml(...args),
  STORE_SELECTOR: 'script#store',
}));

const provider = await import('../../lib/provider/boligportal.js');

/**
 * Many Danish adverts state the total they ask for at move-in ("Indflytningspris: ..."). The provider
 * reads it from the text, and from the full text again when the detail page is fetched.
 */
describe('#boligportal the stated move-in total', () => {
  const ad = (description) => ({
    id: 5671615,
    url: '/lejligheder/hiller%C3%B8d/23m2-1-vaer-id-5671615',
    title: '1 værelses lejlighed',
    city: 'Hillerød',
    street_name: 'Bakkegade',
    street_number: '23',
    postal_code: '3400',
    size_m2: 23,
    rooms: 1,
    monthly_rent: 5900,
    monthly_rent_extra_costs: 450,
    prepaid_rent: 5900,
    deposit: 17700,
    description,
  });
  const normalize = (a) => provider.config.normalize(a);

  it('reads it off the description of the search result', () => {
    const listing = normalize(ad('Lys og nyrenoveret.\nIndflytningspris: 29.950 kr.'));

    expect(listing.rental.moveInTotal).toBe(29950);
    expect(listing.rental.deposit).toBe(17700);
  });

  it('has no total when the description gives none, or gives a list of parts', () => {
    for (const description of ['Lys og nyrenoveret.', 'Depositum 17.700 kr. og forudbetalt leje 5.900 kr.', null]) {
      expect(normalize(ad(description)).rental, String(description)).not.toHaveProperty('moveInTotal');
    }
  });

  it('drops a total that cannot be a move-in price for this rent', () => {
    expect(normalize(ad('Indflytningspris: 1.500 kr.')).rental).not.toHaveProperty('moveInTotal');
    expect(normalize(ad('Indflytningspris: 900.000 kr.')).rental).not.toHaveProperty('moveInTotal');
  });

  describe('when the detail page is fetched', () => {
    const page = (description) =>
      `<html><body><script id="store" type="application/json">${JSON.stringify({
        props: { page_props: { ad: { ...ad(description), advertised_date: '2026-09-20T10:00:00Z' } } },
      })}</script></body></html>`;
    const config = () => provider.createConfig({ url: 'https://www.boligportal.dk/lejeboliger/' }, []);
    const listing = () => ({
      id: 'x',
      price: 5900,
      link: 'https://www.boligportal.dk/l/a-id-5671615',
      description: 'short',
      rental: { deposit: 17700, prepaidRent: 5900 },
    });

    beforeEach(() => fetchSearchHtml.mockReset());

    it('finds the total in the full text and keeps the terms it already had', async () => {
      fetchSearchHtml.mockResolvedValue(page('Lang beskrivelse.\nSamlet indflytningspris: 29.950 kr.'));

      const result = await config().fetchDetails(listing(), {});

      expect(result.rental).toEqual({ deposit: 17700, prepaidRent: 5900, moveInTotal: 29950 });
    });

    it('leaves the terms alone when the full text states no total', async () => {
      fetchSearchHtml.mockResolvedValue(page('Lang beskrivelse uden priser.'));

      const result = await config().fetchDetails(listing(), {});

      expect(result.rental).toEqual({ deposit: 17700, prepaidRent: 5900 });
    });

    it('does not accept a total that is not a move-in price for the rent', async () => {
      fetchSearchHtml.mockResolvedValue(page('Indflytningspris: 1.200 kr.'));

      const result = await config().fetchDetails(listing(), {});

      expect(result.rental).not.toHaveProperty('moveInTotal');
    });

    it('can add the total to a listing that had no terms at all', async () => {
      fetchSearchHtml.mockResolvedValue(page('Indflytningspris: 29.950 kr.'));

      const result = await config().fetchDetails({ ...listing(), rental: undefined }, {});

      expect(result.rental).toEqual({ moveInTotal: 29950 });
    });
  });
});
