/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { activePersons, classify, computeBudget, debtFreeAges, netIncomeOf, recommendRate } from '../affordability.js';
import { normalizeProfile } from '../profile.js';
import { DK_CURRENCY } from './constants.js';
import { calculateDanishFinancing, maxDanishPrice } from './financing.js';

/**
 * Whether the profile is a Danish purchase profile: the buying tab was switched to Denmark.
 *
 * @param {Object|null|undefined} profile
 * @returns {boolean}
 */
export function isDanishMarket(profile) {
  return profile?.financing?.market === 'dk';
}

/**
 * Whether the household has entered enough for a Danish purchase to be judged.
 *
 * The German gate also asks for equity, a Bundesland and a rate scenario, none of which a Danish
 * purchase uses. What it needs is an income, the living costs and a buying profile at all.
 *
 * @param {Object|null|undefined} profile The raw stored profile.
 * @returns {boolean}
 */
export function isDanishProfileComplete(profile) {
  if (profile == null || typeof profile !== 'object') {
    return false;
  }
  if (netIncomeOf(profile) <= 0) {
    return false;
  }
  if (profile.livingCosts == null || !Number.isFinite(Number(profile.livingCosts))) {
    return false;
  }
  return profile.financing != null && typeof profile.financing === 'object';
}

/**
 * The inputs of the Danish model for a profile and, optionally, one advert.
 *
 * The user's choices (rates, terms, fees, cash on hand) come from the profile. Facts about the home
 * come from the advert when there is one, and win over anything typed into the calculator page,
 * because the page's fields are only there for a home that has no advert.
 *
 * @param {import('../../../types/finance.js').FinanceProfile} profile A normalized profile.
 * @param {Object} [context]
 * @param {import('../../sale/saleTerms.js').SaleTerms|null} [context.saleTerms] The advert's sale terms.
 * @returns {Object}
 */
export function danishParamsFor(profile, { saleTerms = null } = {}) {
  const own = profile.financing?.dk ?? {};
  const advert = (value, fallback) => (value != null ? value : fallback);
  return {
    ...own,
    purchasePrice: profile.financing?.purchasePrice,
    cashAvailable: profile.financing?.equity,
    publicValuation: advert(saleTerms?.publicValuation, own.publicValuation),
    ownerCostMonthly: advert(saleTerms?.ownerCostMonthly, own.ownerCostMonthly),
    landTaxPerMille: advert(saleTerms?.landTaxPerMille, own.landTaxPerMille),
    persons: Math.max(1, activePersons(profile).length),
  };
}

/**
 * Everything the UI, the listing card and the MCP tool need for a Danish purchase.
 *
 * The same household budget and the same 35 % rule as the German model, with the monthly housing
 * cost being the loans after rentefradrag plus the ejerudgift. Without a known ejerudgift the
 * verdict is held against the loans alone, which `dk.totalMonthly.ownerCostKnown` says.
 *
 * @param {import('../../../types/finance.js').FinanceProfile} rawProfile
 * @param {Object} [context]
 * @param {import('../../sale/saleTerms.js').SaleTerms|null} [context.saleTerms]
 * @returns {Object}
 */
export function computeDanishResult(rawProfile, context = {}) {
  const profile = normalizeProfile(rawProfile);
  const budget = computeBudget(profile);
  const params = danishParamsFor(profile, context);
  const dk = calculateDanishFinancing(params);

  const housing = dk.totalMonthly.net;
  const recommendation = recommendRate(budget, {});
  const ceiling = Math.max(0, Math.min(budget.headroom, budget.disposable));

  return {
    model: 'dk',
    currency: DK_CURRENCY,
    profile,
    budget,
    dk,
    rateAboveCeiling: housing > recommendation.recommendedRate,
    recommendation: {
      ...recommendation,
      maxAffordablePrice: maxDanishPrice(ceiling, params),
    },
    verdict: classify(housing, budget),
    rateShareOfNetIncome: budget.netIncome > 0 ? (housing + budget.existingDebtRate) / budget.netIncome : null,
    debtFreeAges: debtFreeAges(profile, dk.payoffMonths),
  };
}
