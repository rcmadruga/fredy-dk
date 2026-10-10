/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Editable defaults for the Danish purchase model (plan: docs/plans/dk-buying.md, section 5).
 *
 * Two kinds of constant live here and the comment beside each one says which:
 *   - "Verified": a statutory figure, checked against the source named beside it on the date given.
 *   - "Default": a market-typical starting value that no authority publishes. It prefills a field
 *     the user can change, so a stale one degrades to a wrong default and never to a wrong result
 *     the user cannot fix.
 *
 * Percent values are percent (0.6 means 0.6 %), matching what the user types, like the German
 * constants. Amounts are kroner.
 */

/** The currency whose listings are priced with this model. */
export const DK_CURRENCY = 'DKK';

// ── Verified: tinglysning (registration fees) ───────────────────────────────────────────────────

/**
 * Tinglysning of the skøde (deed): fixed part, in kr.
 *
 * Verified 2026-10-10 against https://www.nemadvokat.dk/nem-viden/bolighandel/tinglysningsafgift
 * and https://tax.dk/skat/tinglysningsafgift.htm (both: 1,850 kr, 2026).
 */
export const TINGLYSNING_SKOEDE_FIXED = 1850;

/**
 * Tinglysning of the skøde: variable part, in percent of the purchase price, or of the latest
 * public valuation when that is higher. The variable part is rounded UP to the nearest 100 kr
 * ({@link TINGLYSNING_ROUNDING}).
 *
 * Verified 2026-10-10, same two sources as {@link TINGLYSNING_SKOEDE_FIXED}.
 */
export const TINGLYSNING_SKOEDE_PCT = 0.6;

/**
 * Tinglysning of a pantebrev (mortgage deed): fixed part, in kr. Due once per deed, so a
 * realkreditlån and a banklån each pay it.
 *
 * Verified 2026-10-10 against
 * https://skat.dk/erhverv/afgifter-paa-varer-og-ydelser-punktafgifter/nyhedsbrev-afgifter/tinglysningsafgift-ny-afgiftssats-pr-1-januar-2026
 * (1,825 kr from 1 January 2026).
 */
export const TINGLYSNING_PANT_FIXED = 1825;

/**
 * Tinglysning of a pantebrev: variable part, in percent of the secured amount.
 *
 * Verified 2026-10-10, same skat.dk page as {@link TINGLYSNING_PANT_FIXED}: 1.25 % from
 * 1 January 2026, down from 1.45 %.
 */
export const TINGLYSNING_PANT_PCT = 1.25;

/**
 * The variable part of a skøde registration is rounded up to a multiple of this many kr.
 *
 * Verified 2026-10-10, nemadvokat.dk and tax.dk as above.
 */
export const TINGLYSNING_ROUNDING = 100;

// ── Verified: property taxes ────────────────────────────────────────────────────────────────────

/**
 * Ejendomsværdiskat: rate on the tax base up to the progression limit, in percent.
 *
 * Verified 2026-10-10 against
 * https://www.vurderingsportalen.dk/ejerbolig/boligskat/forstaa-din-boligskat/ejendomsvaerdiskat
 */
export const EJENDOMSVAERDISKAT_PCT = 0.51;

/**
 * Ejendomsværdiskat: rate on the part of the tax base above the progression limit, in percent.
 *
 * Verified 2026-10-10, vurderingsportalen.dk as above.
 */
export const EJENDOMSVAERDISKAT_HIGH_PCT = 1.4;

/**
 * Share of the public property valuation that is the tax base (grundlag) for ejendomsværdiskat
 * and grundskyld.
 *
 * Verified 2026-10-10, vurderingsportalen.dk as above (tax base = valuation x 0.8).
 */
export const TAX_BASE_FACTOR = 0.8;

/**
 * Progression limit (progressionsgrænse) for 2026, in kr of tax base. 2025 was 9,200,000, which is
 * the figure the plan's first draft carried; the 2026 limit is the lower one.
 *
 * Verified 2026-10-10 against
 * https://www.lovguiden.dk/det-offentlige/skatteministeriet/2025-08-28-satser-og-beloebsgraenser-for-ejendomsskat-i-2025-og-2026
 * and vurderingsportalen.dk as above. This changes every year: update it when the new rates are out.
 */
export const EJENDOMSVAERDISKAT_PROGRESSION_LIMIT = 9007000;

// ── Default: the funding stack (plan section 5) ─────────────────────────────────────────────────

/** Default: udbetaling, in percent of the price. Five percent is the legal minimum cash payment. */
export const DEFAULT_DOWN_PAYMENT_PCT = 5;

/** Default: largest realkreditlån, in percent of the price. The legal cap for a helårsbolig. */
export const DEFAULT_REALKREDIT_PCT = 80;

/** Default: realkreditlån interest rate, percent per year. A typical fixed-rate coupon; edit it. */
export const DEFAULT_REALKREDIT_RATE = 4.0;

/** Default: realkreditlån term, in years. */
export const DEFAULT_REALKREDIT_TERM_YEARS = 30;

/** Default: interest-only years on the realkreditlån. Zero; lenders allow up to 10. */
export const DEFAULT_REALKREDIT_INTEREST_ONLY_YEARS = 0;

/** Largest number of interest-only years the model accepts. Lenders allow up to 10. */
export const MAX_INTEREST_ONLY_YEARS = 10;

/** Default: banklån (boliglån) interest rate, percent per year. Higher than realkredit; edit it. */
export const DEFAULT_BANK_RATE = 6.0;

/** Default: banklån term, in years. Banks usually give 20 to 30. */
export const DEFAULT_BANK_TERM_YEARS = 20;

/** Default: interest-only years on the banklån. */
export const DEFAULT_BANK_INTEREST_ONLY_YEARS = 0;

/**
 * Default: kurs (bond price) of the realkreditlån. 100 means no discount: the nominal debt equals
 * the cash it pays out. At 97 the nominal debt is cash / 0.97. Not a market feed.
 */
export const DEFAULT_KURS = 100;

/**
 * Default: bidragssats (the lender's ongoing margin, percent of the remaining debt per year), one
 * per loan-to-value band. Real lenders publish their own tables and change them; these are rounded
 * middle-of-the-road values to be edited, not any lender's offer. Bands are on the realkreditlån as
 * a share of the price: up to 40 %, over 40 up to 60 %, over 60 up to 80 %.
 *
 * @type {ReadonlyArray<{upToLtvPct: number, bidragPct: number}>}
 */
export const DEFAULT_BIDRAG_BANDS = Object.freeze([
  Object.freeze({ upToLtvPct: 40, bidragPct: 0.5 }),
  Object.freeze({ upToLtvPct: 60, bidragPct: 0.7 }),
  Object.freeze({ upToLtvPct: 80, bidragPct: 1.0 }),
]);

// ── Default: one-off costs a lender or adviser sets ─────────────────────────────────────────────

/** Default: lånesagsgebyr, kurtage and similar lender fees in kr. Lender-specific, so zero. */
export const DEFAULT_LENDER_FEES = 0;

/** Default: buyer's advisor (køberrådgiver) in kr. Optional in Denmark, so zero. */
export const DEFAULT_ADVISOR_FEE = 0;

/** Default: the buyer's half of the ejerskifteforsikring premium in kr. Seller usually offers half. */
export const DEFAULT_OWNER_CHANGE_INSURANCE = 0;

// ── Default: interest deduction (rentefradrag) ──────────────────────────────────────────────────

/**
 * Default: deduction rate on interest up to {@link INTEREST_DEDUCTION_THRESHOLD}, in percent. About
 * the municipal tax rate plus the health contribution; it tracks the kommuneskat, which the listing
 * carries as `municipalTaxPct`. Edit it.
 */
export const DEFAULT_INTEREST_DEDUCTION_PCT = 33;

/** Default: deduction rate on interest above the threshold, in percent. About 25 %. Edit it. */
export const DEFAULT_INTEREST_DEDUCTION_HIGH_PCT = 25;

/** Default: yearly interest per person up to which the higher deduction rate applies, in kr. */
export const INTEREST_DEDUCTION_THRESHOLD = 50000;
