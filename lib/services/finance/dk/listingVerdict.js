/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { num } from '../constants.js';
import { monthsToYears } from '../amortization.js';
import { computeDanishResult, isDanishProfileComplete } from './result.js';

/**
 * Run one advert through the Danish model: the profile with the advert's price in place of the
 * calculator's, and the advert's own sale terms (ejerudgift, public valuation, land tax) winning
 * over anything typed on the page.
 *
 * This is the one place a listing becomes a Danish result, so the verdict chip, the affordability
 * filter and the sweep behind `/api/finance/affordability` cannot disagree about a single home.
 *
 * @param {{price?: number|null, sale_terms?: import('../../sale/saleTerms.js').SaleTerms|null}} listing
 * @param {import('../../../types/finance.js').FinanceProfile} rawProfile The profile as stored.
 * @returns {Object|null} `computeDanishResult`'s answer, or `null` when the profile is too thin for
 *   the Danish model or the advert has no usable price.
 */
export function danishResultForListing(listing, rawProfile) {
  const price = num(listing?.price, NaN);
  if (!Number.isFinite(price) || price <= 0 || !isDanishProfileComplete(rawProfile)) {
    return null;
  }
  return computeDanishResult(
    { ...rawProfile, financing: { ...rawProfile.financing, purchasePrice: price } },
    { saleTerms: listing.sale_terms ?? null },
  );
}

/**
 * The affordability verdict of a home priced in kroner.
 *
 * @param {{price?: number|null, sale_terms?: Object|null}} listing
 * @param {import('../../../types/finance.js').FinanceProfile} rawProfile
 * @returns {'affordable'|'stretch'|'unaffordable'|null} `null` when nothing can be judged.
 */
export function danishVerdictForListing(listing, rawProfile) {
  return danishResultForListing(listing, rawProfile)?.verdict ?? null;
}

/**
 * A Danish listing in the shape the affordability sweep returns for a German one (`scoreListing`),
 * so the panel and the scatter plot read both without knowing which model produced them. Amounts
 * are kroner and `currency` says so.
 *
 * @param {{id?: string, title?: string, address?: string, price?: number|null, sale_terms?: Object|null}} listing
 * @param {import('../../../types/finance.js').FinanceProfile} rawProfile
 * @returns {Object|null} `null` when nothing can be judged.
 */
export function scoreDanishListing(listing, rawProfile) {
  const result = danishResultForListing(listing, rawProfile);
  if (result == null) {
    return null;
  }
  const { dk } = result;
  return {
    id: listing.id ?? null,
    title: listing.title ?? null,
    address: listing.address ?? null,
    currency: result.currency,
    price: dk.purchasePrice,
    loanAmount: dk.funding.totalNominal,
    closingCosts: dk.oneOff.total,
    monthlyPayment: dk.totalMonthly.net,
    payoffMonths: dk.payoffMonths,
    payoffYears: monthsToYears(dk.payoffMonths),
    totalInterest: dk.debt.totalInterest,
    restschuld: dk.debt.atYearsBalance,
    neverPaysOff: false,
    rateShareOfNetIncome: result.rateShareOfNetIncome,
    verdict: result.verdict,
  };
}
