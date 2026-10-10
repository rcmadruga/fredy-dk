/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { buildRentalFacts } from '../../ui/src/views/listings/listingFacts.js';
import { formatPrice } from '../../ui/src/services/price/priceService.js';
import en from '../../ui/src/locales/en.json';

// Echoes the key and its values, so an assertion can say which line carries what without depending
// on wording.
const t = (key, params) => (params ? `${key}(${Object.values(params).join(',')})` : key);
const NOW = new Date('2026-10-04T10:00:00Z');
const ctx = (extra = {}) => ({ t, locale: 'en', currency: 'DKK', now: NOW, ...extra });
const money = (n) => formatPrice(n, 'en', null, 'DKK');

const rental = (over = {}, terms = {}) => ({
  dealType: 'rent',
  price: 5900,
  charges: 450,
  charges_included: 0,
  rental_terms: { deposit: 17700, prepaidRent: 5900, leasePeriodMonths: 0, availableFrom: '2027-01-15', ...terms },
  ...over,
});
const row = (facts, id) => facts.rows.find((r) => r.id === id);

describe('buildRentalFacts', () => {
  it('is null for a sale and for a rental that states nothing of this', () => {
    expect(buildRentalFacts({ ...rental(), dealType: 'buy' }, ctx())).toBeNull();
    expect(buildRentalFacts({ dealType: 'rent', price: 5900, rental_terms: null }, ctx())).toBeNull();
    expect(buildRentalFacts(null, ctx())).toBeNull();
  });

  describe('when the home is free', () => {
    it('says "now" for a date that has passed or is today', () => {
      for (const availableFrom of ['2026-09-01', '2026-10-04']) {
        const { availability } = buildRentalFacts(rental({}, { availableFrom }), ctx());

        expect(availability.state, availableFrom).toBe('now');
        expect(availability.relative).toBe('listing.detail.rentalAvailableNow');
      }
    });

    it('says how many days when it is within two months', () => {
      const { availability } = buildRentalFacts(rental({}, { availableFrom: '2026-11-03' }), ctx());

      expect(availability).toMatchObject({ state: 'soon', relative: 'listing.detail.rentalAvailableInDays(30)' });
    });

    it('says roughly how many months when it is further off, and gives the date in the locale', () => {
      const { availability } = buildRentalFacts(rental({}, { availableFrom: '2027-01-15' }), ctx());

      expect(availability.state).toBe('later');
      expect(availability.relative).toBe('listing.detail.rentalAvailableInMonths(3)');
      expect(availability.date).toBe('January 15, 2027');
      expect(
        buildRentalFacts(rental({}, { availableFrom: '2027-01-15' }), ctx({ locale: 'da' })).availability.date,
      ).toBe('15. januar 2027');
    });

    it('is not moved by the time zone of whoever reads it', () => {
      const late = new Date('2026-10-04T23:30:00Z');

      expect(buildRentalFacts(rental({}, { availableFrom: '2026-10-05' }), ctx({ now: late })).availability.state).toBe(
        'soon',
      );
    });

    it('is absent, with the rest still shown, when the advert gives no date', () => {
      const facts = buildRentalFacts(rental({}, { availableFrom: undefined }), ctx());

      expect(facts.availability).toBeNull();
      expect(facts.rows.length).toBeGreaterThan(0);
    });
  });

  describe('the monthly cost', () => {
    it('adds the extra costs a rent is quoted without, and says what they are', () => {
      const facts = buildRentalFacts(rental(), ctx());

      expect(row(facts, 'extraCosts').value).toBe(money(450));
      expect(row(facts, 'totalMonthly').value).toBe(money(6350));
    });

    it('shows no total when the rent already includes the costs, or its basis is unknown', () => {
      for (const over of [{ charges_included: 1 }, { charges_included: null }]) {
        const facts = buildRentalFacts(rental(over), ctx());

        expect(row(facts, 'extraCosts'), JSON.stringify(over)).toBeUndefined();
        expect(row(facts, 'totalMonthly'), JSON.stringify(over)).toBeUndefined();
      }
    });
  });

  describe('the cash needed on the day', () => {
    it('is the first month with its extra costs, plus the deposit, plus the prepaid rent', () => {
      // 5,900 + 450 first month, 17,700 deposit, 5,900 prepaid.
      expect(buildRentalFacts(rental(), ctx()).moveIn).toMatchObject({
        stated: false,
        text: money(6350 + 17700 + 5900),
      });
    });

    it('leaves the extra costs out of the first month when the rent already includes them', () => {
      const facts = buildRentalFacts(rental({ charges_included: 1 }), ctx());

      expect(facts.moveIn.text).toBe(money(5900 + 17700 + 5900));
    });

    it('says it is our own calculation and a floor', () => {
      expect(buildRentalFacts(rental(), ctx()).moveIn.helpText).toBe('listing.detail.rentalMoveInHelp');
      expect(en['listing.detail.rentalMoveInHelp']).toMatch(/At least/);
      expect(en['listing.detail.rentalMoveInHelp']).not.toMatch(/includes the first month/);
    });

    it('works from a deposit alone, and is not shown when neither figure nor a total is stated', () => {
      expect(buildRentalFacts(rental({}, { prepaidRent: undefined }), ctx()).moveIn.text).toBe(money(6350 + 17700));
      expect(buildRentalFacts(rental({}, { deposit: undefined, prepaidRent: undefined }), ctx()).moveIn).toBeNull();
    });

    it('treats a stated deposit of zero as a deposit of zero', () => {
      const facts = buildRentalFacts(rental({}, { deposit: 0, prepaidRent: undefined }), ctx());

      expect(row(facts, 'deposit').value).toBe(money(0));
      expect(facts.moveIn.text).toBe(money(6350));
    });

    describe('when the advert states the total itself', () => {
      it('shows the stated figure, as from the advert', () => {
        const { moveIn } = buildRentalFacts(rental({}, { moveInTotal: 29950 }), ctx());

        expect(moveIn).toEqual({ stated: true, text: money(29950), helpText: 'listing.detail.rentalMoveInStatedHelp' });
      });

      it('trusts it even when it is far from what we would calculate, and shows nothing beside it', () => {
        // Our own calculation would be 29,950; the advert says 41,300 (it may include fees we cannot see).
        const { moveIn } = buildRentalFacts(rental({}, { moveInTotal: 41300 }), ctx());

        expect(moveIn.text).toBe(money(41300));
        expect(moveIn).not.toHaveProperty('estimateNote');
      });

      it('is shown even when there is nothing to calculate from', () => {
        const facts = buildRentalFacts({ dealType: 'rent', price: 5900, rental_terms: { moveInTotal: 29950 } }, ctx());

        expect(facts.moveIn).toMatchObject({ stated: true, text: money(29950) });
      });
    });

    it('marks a figure we worked out as our own calculation, and never as stated', () => {
      const { moveIn } = buildRentalFacts(rental(), ctx());

      expect(moveIn.stated).toBe(false);
      expect(en['listing.detail.rentalMoveIn']).toMatch(/our calculation/i);
      expect(en['listing.detail.rentalMoveInStated']).toMatch(/from the ad/i);
      expect(en['listing.detail.rentalMoveInHelp']).toMatch(/not stated in the advert/i);
    });
  });

  describe('the legal ceilings (deposit 3 months, prepaid 3 months, together 6)', () => {
    it('is quiet for what the law allows', () => {
      expect(buildRentalFacts(rental({}, { deposit: 17700, prepaidRent: 17700 }), ctx()).warnings).toEqual([]);
    });

    it('warns about a deposit above three months', () => {
      const { warnings } = buildRentalFacts(rental({}, { deposit: 17701, prepaidRent: undefined }), ctx());

      expect(warnings).toEqual(['listing.detail.rentalDepositOverCap']);
    });

    it('warns about prepaid rent above three months, and about the two together above six', () => {
      const { warnings } = buildRentalFacts(rental({}, { deposit: 17700, prepaidRent: 17701 }), ctx());

      expect(warnings).toEqual(['listing.detail.rentalPrepaidOverCap', 'listing.detail.rentalCombinedOverCap']);
    });

    it('says nothing when the rent includes running costs, since the law counts the rent alone', () => {
      const { warnings } = buildRentalFacts(rental({ charges_included: 1 }, { deposit: 99999 }), ctx());

      expect(warnings).toEqual([]);
    });
  });

  describe('the lease and the owner', () => {
    it('tells an open-ended lease from a limited one', () => {
      expect(row(buildRentalFacts(rental(), ctx()), 'lease').value).toBe('listing.detail.rentalLeaseOpen');
      expect(row(buildRentalFacts(rental({}, { leasePeriodMonths: 12 }), ctx()), 'lease').value).toBe(
        'listing.detail.rentalLeaseMonths(12)',
      );
      expect(row(buildRentalFacts(rental({}, { leasePeriodMonths: undefined }), ctx()), 'lease')).toBeUndefined();
    });

    it('flags a housing association home, even when that is all that is known', () => {
      const facts = buildRentalFacts({ dealType: 'rent', price: 4000, rental_terms: { socialHousing: true } }, ctx());

      expect(facts.socialHousing).toBe(true);
    });
  });

  it("formats in the listing's own currency", () => {
    const dkk = row(buildRentalFacts(rental(), ctx()), 'deposit').value;
    const eur = row(buildRentalFacts(rental(), ctx({ currency: 'EUR' })), 'deposit').value;

    expect(dkk).not.toBe(eur);
  });
});

describe('the strings the rental card asks for', () => {
  it('exist in English', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('listing.detail.rental'));

    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const key of [
      'rentalTitle',
      'rentalAvailableFrom',
      'rentalAvailableNow',
      'rentalAvailableInDays',
      'rentalAvailableInMonths',
      'rentalAvailableUnknown',
      'rentalExtraCosts',
      'rentalTotalMonthly',
      'rentalDeposit',
      'rentalPrepaid',
      'rentalMoveIn',
      'rentalMoveInStated',
      'rentalMoveInStatedHelp',
      'rentalLease',
      'rentalLeaseOpen',
      'rentalLeaseMonths',
      'rentalSocialHousing',
      'rentalDepositOverCap',
      'rentalPrepaidOverCap',
      'rentalCombinedOverCap',
    ]) {
      expect(en[`listing.detail.${key}`], key).toBeTruthy();
    }
  });
});
