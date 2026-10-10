/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { num, toFraction } from '../constants.js';
import {
  DEFAULT_BANK_INTEREST_ONLY_YEARS,
  DEFAULT_BANK_RATE,
  DEFAULT_BANK_TERM_YEARS,
  DEFAULT_ADVISOR_FEE,
  DEFAULT_BIDRAG_BANDS,
  DEFAULT_DOWN_PAYMENT_PCT,
  DEFAULT_INTEREST_DEDUCTION_HIGH_PCT,
  DEFAULT_INTEREST_DEDUCTION_PCT,
  DEFAULT_KURS,
  DEFAULT_LENDER_FEES,
  DEFAULT_OWNER_CHANGE_INSURANCE,
  DEFAULT_REALKREDIT_INTEREST_ONLY_YEARS,
  DEFAULT_REALKREDIT_PCT,
  DEFAULT_REALKREDIT_RATE,
  DEFAULT_REALKREDIT_TERM_YEARS,
  EJENDOMSVAERDISKAT_HIGH_PCT,
  EJENDOMSVAERDISKAT_PCT,
  EJENDOMSVAERDISKAT_PROGRESSION_LIMIT,
  INTEREST_DEDUCTION_THRESHOLD,
  MAX_INTEREST_ONLY_YEARS,
  TAX_BASE_FACTOR,
  TINGLYSNING_PANT_FIXED,
  TINGLYSNING_PANT_PCT,
  TINGLYSNING_ROUNDING,
  TINGLYSNING_SKOEDE_FIXED,
  TINGLYSNING_SKOEDE_PCT,
} from './constants.js';

/*
 * The Danish purchase model (plan: docs/plans/dk-buying.md, section 5).
 *
 * Everything here is pure: numbers in, numbers out, no I/O and no dates. Amounts are kroner and
 * percentages are percent, as in the German model.
 *
 * Simplifications, stated once because they shape every figure:
 *   - Both loans are monthly annuities. Real realkredit pays quarterly, and a fixed-rate loan's
 *     balance depends on bond prices; neither is modelled.
 *   - The bidragssats is a margin on the remaining debt, so it is folded into the loan's rate for
 *     the annuity. Rente and bidrag are both treated as deductible interest.
 *   - The interest deduction is computed on the first year's interest and applied to every month's
 *     "net" figure; later years' interest is lower, so the net figure rises a little over time.
 */

/**
 * Round a value UP to a multiple of a step, tolerating the float noise a percentage leaves behind
 * (600000 * 0.006 is 3600.0000000000005, which a plain ceil would push to the next hundred).
 *
 * @param {number} value
 * @param {number} step
 * @returns {number}
 */
export function roundUpTo(value, step) {
  if (!(step > 0)) {
    return value;
  }
  const steps = Math.round((value / step) * 1e6) / 1e6;
  return Math.ceil(steps) * step;
}

/**
 * Tinglysning of the skøde (deed): a fixed amount plus a percentage of the purchase price, or of
 * the latest public valuation when that is higher, with the variable part rounded up to the nearest
 * 100 kr.
 *
 * @param {number} purchasePrice
 * @param {number|null} [publicValuation] The latest public valuation; ignored when missing.
 * @returns {{fixed: number, variable: number, total: number, basis: number}} `basis` is the amount
 *   the percentage was taken of.
 */
export function tinglysningSkoede(purchasePrice, publicValuation = null) {
  const price = Math.max(0, num(purchasePrice));
  if (price <= 0) {
    return { fixed: 0, variable: 0, total: 0, basis: 0 };
  }
  const basis = Math.max(price, Math.max(0, num(publicValuation)));
  const variable = roundUpTo(basis * toFraction(TINGLYSNING_SKOEDE_PCT), TINGLYSNING_ROUNDING);
  return { fixed: TINGLYSNING_SKOEDE_FIXED, variable, total: TINGLYSNING_SKOEDE_FIXED + variable, basis };
}

/**
 * Tinglysning of one pantebrev (mortgage deed): a fixed amount plus a percentage of the secured
 * amount. Each loan has its own deed, so call this once per loan.
 *
 * @param {number} securedAmount The nominal amount the deed secures.
 * @returns {number} 0 when nothing is borrowed.
 */
export function tinglysningPant(securedAmount) {
  const amount = Math.max(0, num(securedAmount));
  return amount <= 0 ? 0 : TINGLYSNING_PANT_FIXED + amount * toFraction(TINGLYSNING_PANT_PCT);
}

/**
 * The bidragssats for a loan-to-value ratio.
 *
 * @param {number} ltvPct The realkreditlån as a percentage of the price.
 * @param {ReadonlyArray<{upToLtvPct: number, bidragPct: number}>} [bands] Ascending by `upToLtvPct`.
 * @returns {number} Percent per year. Above the last band, the last band's value.
 */
export function bidragPctFor(ltvPct, bands = DEFAULT_BIDRAG_BANDS) {
  const usable = (Array.isArray(bands) && bands.length > 0 ? bands : DEFAULT_BIDRAG_BANDS)
    .map((band) => ({ upTo: num(band?.upToLtvPct), bidrag: Math.max(0, num(band?.bidragPct)) }))
    .sort((a, b) => a.upTo - b.upTo);
  const ltv = Math.round(num(ltvPct) * 1e6) / 1e6;
  const hit = usable.find((band) => ltv <= band.upTo);
  return (hit ?? usable[usable.length - 1]).bidrag;
}

/**
 * The nominal debt a realkreditlån needs to pay out a given amount of cash at a given kurs.
 * Raised at kurs 97, a loan of 970,000 kr cash needs 1,000,000 kr nominal.
 *
 * @param {number} cash
 * @param {number} [kurs=100] Bond price; 100 means no discount.
 * @returns {number}
 */
export function nominalDebt(cash, kurs = DEFAULT_KURS) {
  const rate = num(kurs, DEFAULT_KURS);
  return Math.max(0, num(cash)) / ((rate > 0 ? rate : DEFAULT_KURS) / 100);
}

/**
 * Monthly annuity payment.
 *
 * @param {number} principal
 * @param {number} monthlyRate As a fraction (0.004 is 0.4 % a month).
 * @param {number} months
 * @returns {number}
 */
function annuityPayment(principal, monthlyRate, months) {
  if (principal <= 0 || months <= 0) {
    return 0;
  }
  if (monthlyRate <= 0) {
    return principal / months;
  }
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}

/**
 * @typedef {Object} LoanYear
 * @property {number} year 1-based.
 * @property {number} interest Rente paid this year.
 * @property {number} bidrag Bidrag paid this year.
 * @property {number} principal Repaid this year.
 * @property {number} payment Total paid this year.
 * @property {number} balance Debt left at the end of the year.
 */

/**
 * @typedef {Object} LoanSchedule
 * @property {number} principal Nominal debt.
 * @property {number} annualRate Rente, percent.
 * @property {number} bidragPct Bidragssats, percent.
 * @property {number} termYears
 * @property {number} interestOnlyYears Years actually applied (clamped to the term and to ten).
 * @property {number} firstMonthPayment The payment in month 1: interest-only while those years last.
 * @property {number} paymentAfterInterestOnly The level payment once repayment starts. Equal to
 *   `firstMonthPayment` when there are no interest-only years.
 * @property {number} firstYearInterest Rente plus bidrag over year 1.
 * @property {number} balanceAfterInterestOnly Debt when the interest-only years end (the principal).
 * @property {number} totalInterest Rente plus bidrag over the whole term.
 * @property {number} totalPaid
 * @property {LoanYear[]} years One entry per year of the term.
 */

/**
 * Simulate one loan month by month and report it per year.
 *
 * During the interest-only years the payment is the interest on the whole principal; after them
 * it is the level annuity that clears the debt by the end of the term. The bidrag rides on the
 * remaining debt, so it is folded into the rate (see the note at the top of this file).
 *
 * @param {Object} loan
 * @param {number} loan.principal Nominal debt.
 * @param {number} loan.annualRate Rente, percent.
 * @param {number} [loan.bidragPct=0] Bidragssats, percent.
 * @param {number} loan.termYears
 * @param {number} [loan.interestOnlyYears=0] Clamped to 0..10 and to the term.
 * @returns {LoanSchedule}
 */
export function simulateLoan({ principal, annualRate, bidragPct = 0, termYears, interestOnlyYears = 0 }) {
  const debt = Math.max(0, num(principal));
  const rente = Math.max(0, num(annualRate));
  const bidrag = Math.max(0, num(bidragPct));
  const term = Math.max(0, Math.floor(num(termYears)));
  const interestOnly = Math.min(Math.max(0, Math.floor(num(interestOnlyYears))), MAX_INTEREST_ONLY_YEARS, term);

  const empty = {
    principal: debt,
    annualRate: rente,
    bidragPct: bidrag,
    termYears: term,
    interestOnlyYears: interestOnly,
    firstMonthPayment: 0,
    paymentAfterInterestOnly: 0,
    firstYearInterest: 0,
    balanceAfterInterestOnly: debt,
    totalInterest: 0,
    totalPaid: 0,
    years: [],
  };
  if (debt <= 0 || term <= 0) {
    return empty;
  }

  const monthlyRente = toFraction(rente) / 12;
  const monthlyBidrag = toFraction(bidrag) / 12;
  const monthlyTotal = monthlyRente + monthlyBidrag;
  const interestOnlyMonths = interestOnly * 12;
  const repayMonths = term * 12 - interestOnlyMonths;
  const level = repayMonths > 0 ? annuityPayment(debt, monthlyTotal, repayMonths) : debt * monthlyTotal;

  const years = [];
  let balance = debt;
  let totalInterest = 0;
  let totalPaid = 0;
  let firstMonthPayment = 0;
  for (let year = 1; year <= term; year++) {
    const row = { year, interest: 0, bidrag: 0, principal: 0, payment: 0, balance: 0 };
    for (let m = 0; m < 12; m++) {
      const monthIndex = (year - 1) * 12 + m;
      const renteM = balance * monthlyRente;
      const bidragM = balance * monthlyBidrag;
      const inInterestOnly = monthIndex < interestOnlyMonths;
      const payment = inInterestOnly ? renteM + bidragM : level;
      // The last month of a clearing loan absorbs the rounding of the level payment.
      const repaid = inInterestOnly ? 0 : Math.min(balance, payment - renteM - bidragM);
      balance = Math.max(0, balance - repaid);
      if (monthIndex === 0) {
        firstMonthPayment = payment;
      }
      row.interest += renteM;
      row.bidrag += bidragM;
      row.principal += repaid;
      row.payment += renteM + bidragM + repaid;
    }
    // Float dust from the last repayment is not a debt.
    row.balance = balance < 1e-6 ? 0 : balance;
    balance = row.balance;
    totalInterest += row.interest + row.bidrag;
    totalPaid += row.payment;
    years.push(row);
  }

  return {
    ...empty,
    firstMonthPayment,
    paymentAfterInterestOnly: level,
    firstYearInterest: years[0].interest + years[0].bidrag,
    totalInterest,
    totalPaid,
    years,
  };
}

/**
 * The debt left on a loan at the end of a given year.
 *
 * @param {LoanSchedule|null} schedule
 * @param {number} year 0 is the day of purchase; past the term the loan is gone.
 * @returns {number}
 */
export function balanceAtYear(schedule, year) {
  if (schedule == null || schedule.principal <= 0) {
    return 0;
  }
  const y = Math.max(0, Math.floor(num(year)));
  if (y === 0) {
    return schedule.principal;
  }
  if (y > schedule.years.length) {
    return schedule.years.length > 0 ? schedule.years[schedule.years.length - 1].balance : 0;
  }
  return schedule.years[y - 1].balance;
}

/**
 * Ejendomsværdiskat for one year.
 *
 * The tax base is 80 % of the public valuation. The first part of it up to the progression limit
 * pays 0.51 %, anything above 1.4 %.
 *
 * @param {number|null} publicValuation
 * @param {Object} [options]
 * @param {number} [options.progressionLimit] Kr of tax base; defaults to the 2026 limit.
 * @returns {{taxBase: number, annual: number, monthly: number}|null} `null` without a valuation.
 */
export function ejendomsvaerdiskat(publicValuation, { progressionLimit = EJENDOMSVAERDISKAT_PROGRESSION_LIMIT } = {}) {
  const valuation = publicValuation == null ? NaN : num(publicValuation, NaN);
  if (!Number.isFinite(valuation) || valuation <= 0) {
    return null;
  }
  const taxBase = valuation * TAX_BASE_FACTOR;
  const limit = Math.max(0, num(progressionLimit, EJENDOMSVAERDISKAT_PROGRESSION_LIMIT));
  const annual =
    Math.min(taxBase, limit) * toFraction(EJENDOMSVAERDISKAT_PCT) +
    Math.max(0, taxBase - limit) * toFraction(EJENDOMSVAERDISKAT_HIGH_PCT);
  return { taxBase, annual, monthly: annual / 12 };
}

/**
 * Grundskyld for one year: the kommune's promille of 80 % of the land value.
 *
 * Boligsiden gives the promille but not the land value, so this is `null` far more often than not.
 * It is never guessed: a made-up land value would print as a real figure.
 *
 * @param {number|null} landValue The land part of the public valuation.
 * @param {number|null} promille The kommune's grundskyld promille (25 means 25 per mille).
 * @returns {{taxBase: number, annual: number, monthly: number}|null} `null` when either is unknown.
 */
export function grundskyld(landValue, promille) {
  const land = landValue == null ? NaN : num(landValue, NaN);
  const rate = promille == null ? NaN : num(promille, NaN);
  if (!Number.isFinite(land) || land <= 0 || !Number.isFinite(rate) || rate < 0) {
    return null;
  }
  const taxBase = land * TAX_BASE_FACTOR;
  const annual = (taxBase * rate) / 1000;
  return { taxBase, annual, monthly: annual / 12 };
}

/**
 * The value of the rentefradrag for one year.
 *
 * Each person gets the higher rate on the first `threshold` kr of interest and the lower rate above
 * it. For a couple the threshold doubles; the interest is assumed to be split evenly.
 *
 * @param {number} annualInterest Rente plus bidrag, both loans, in kr per year.
 * @param {Object} [options]
 * @param {number} [options.persons=1]
 * @param {number} [options.pct] Percent up to the threshold.
 * @param {number} [options.highPct] Percent above it (named for the amount, not the rate: it is the lower one).
 * @param {number} [options.threshold] Kr of interest per person per year.
 * @returns {number} Kr per year that comes back in tax.
 */
export function interestDeduction(
  annualInterest,
  {
    persons = 1,
    pct = DEFAULT_INTEREST_DEDUCTION_PCT,
    highPct = DEFAULT_INTEREST_DEDUCTION_HIGH_PCT,
    threshold = INTEREST_DEDUCTION_THRESHOLD,
  } = {},
) {
  const interest = Math.max(0, num(annualInterest));
  const people = Math.max(1, Math.floor(num(persons, 1)));
  const cap = Math.max(0, num(threshold, INTEREST_DEDUCTION_THRESHOLD)) * people;
  const low = Math.min(interest, cap);
  const high = interest - low;
  return low * toFraction(pct) + high * toFraction(highPct);
}

/**
 * Fill the editable inputs of the Danish model with their defaults.
 *
 * What a profile stores under `financing.dk` is only what the user changed; anything missing or not
 * a finite number comes back as the default here, so a half-filled block is never a half-computed one.
 *
 * @param {Object} [raw] A `DanishFinancingParams`-shaped object, possibly partial.
 * @returns {import('../../../types/finance.js').DanishFinancingParams}
 */
export function normalizeDanishParams(raw = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const realkredit = input.realkredit && typeof input.realkredit === 'object' ? input.realkredit : {};
  const bank = input.bank && typeof input.bank === 'object' ? input.bank : {};
  const nonNegative = (value, fallback) => Math.max(0, num(value, fallback));
  const optional = (value) => {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const kurs = num(realkredit.kurs, DEFAULT_KURS);

  return {
    purchasePrice: nonNegative(input.purchasePrice, 0),
    publicValuation: optional(input.publicValuation),
    cashAvailable: optional(input.cashAvailable),
    downPaymentPct: Math.min(100, nonNegative(input.downPaymentPct, DEFAULT_DOWN_PAYMENT_PCT)),
    realkredit: {
      pct: Math.min(100, nonNegative(realkredit.pct, DEFAULT_REALKREDIT_PCT)),
      rate: nonNegative(realkredit.rate, DEFAULT_REALKREDIT_RATE),
      termYears: nonNegative(realkredit.termYears, DEFAULT_REALKREDIT_TERM_YEARS),
      interestOnlyYears: Math.min(
        MAX_INTEREST_ONLY_YEARS,
        nonNegative(realkredit.interestOnlyYears, DEFAULT_REALKREDIT_INTEREST_ONLY_YEARS),
      ),
      kurs: kurs > 0 ? kurs : DEFAULT_KURS,
      bidragBands:
        Array.isArray(realkredit.bidragBands) && realkredit.bidragBands.length > 0
          ? realkredit.bidragBands.map((band) => ({
              upToLtvPct: nonNegative(band?.upToLtvPct, 0),
              bidragPct: nonNegative(band?.bidragPct, 0),
            }))
          : DEFAULT_BIDRAG_BANDS.map((band) => ({ ...band })),
    },
    bank: {
      rate: nonNegative(bank.rate, DEFAULT_BANK_RATE),
      termYears: nonNegative(bank.termYears, DEFAULT_BANK_TERM_YEARS),
      interestOnlyYears: Math.min(
        MAX_INTEREST_ONLY_YEARS,
        nonNegative(bank.interestOnlyYears, DEFAULT_BANK_INTEREST_ONLY_YEARS),
      ),
    },
    lenderFees: nonNegative(input.lenderFees, DEFAULT_LENDER_FEES),
    advisorFee: nonNegative(input.advisorFee, DEFAULT_ADVISOR_FEE),
    ownerChangeInsurance: nonNegative(input.ownerChangeInsurance, DEFAULT_OWNER_CHANGE_INSURANCE),
    ownerCostMonthly: optional(input.ownerCostMonthly),
    landValue: optional(input.landValue),
    landTaxPerMille: optional(input.landTaxPerMille),
    persons: Math.max(1, Math.floor(num(input.persons, 1))),
    deductionPct: Math.min(100, nonNegative(input.deductionPct, DEFAULT_INTEREST_DEDUCTION_PCT)),
    deductionHighPct: Math.min(100, nonNegative(input.deductionHighPct, DEFAULT_INTEREST_DEDUCTION_HIGH_PCT)),
    atYears: Math.max(0, Math.floor(num(input.atYears, 10))),
  };
}

/**
 * Split a price into the three layers that pay it: udbetaling in cash, a realkreditlån of up to
 * the chosen share of the price, and a bank loan for what is left.
 *
 * @param {number} price
 * @param {Object} p Normalized params (see {@link normalizeDanishParams}).
 * @returns {{downPayment: number, realkreditCash: number, realkreditNominal: number, bankLoan: number,
 *   ltvPct: number, bidragPct: number}} `ltvPct` is the nominal realkreditlån as a share of the price.
 */
export function fundingStack(price, p) {
  const cost = Math.max(0, num(price));
  const downPayment = cost * toFraction(p.downPaymentPct);
  const realkreditCash = Math.min(cost * toFraction(p.realkredit.pct), cost - downPayment);
  const realkreditNominal = nominalDebt(realkreditCash, p.realkredit.kurs);
  const bankLoan = Math.max(0, cost - downPayment - realkreditCash);
  const ltvPct = cost > 0 ? (realkreditNominal / cost) * 100 : 0;
  return {
    downPayment,
    realkreditCash,
    realkreditNominal,
    bankLoan,
    ltvPct,
    bidragPct: bidragPctFor(ltvPct, p.realkredit.bidragBands),
  };
}

/**
 * The running costs of owning the home, per month.
 *
 * The advert's ejerudgift wins when it states one, because it already contains the property taxes
 * and adding them again would count them twice. Without it the two taxes are estimated from the
 * valuation; the estimate is flagged incomplete when grundskyld cannot be worked out, and for a flat
 * it leaves out the ejerforening's fee.
 *
 * @param {Object} p Normalized params.
 * @returns {{ownerCostMonthly: number|null, source: 'advert'|'estimate'|'unknown',
 *   ejendomsvaerdiskatMonthly: number|null, grundskyldMonthly: number|null, estimateComplete: boolean}}
 */
export function runningCosts(p) {
  if (p.ownerCostMonthly != null) {
    return {
      ownerCostMonthly: p.ownerCostMonthly,
      source: 'advert',
      ejendomsvaerdiskatMonthly: null,
      grundskyldMonthly: null,
      estimateComplete: true,
    };
  }
  const evs = ejendomsvaerdiskat(p.publicValuation);
  const grund = grundskyld(p.landValue, p.landTaxPerMille);
  if (evs == null && grund == null) {
    return {
      ownerCostMonthly: null,
      source: 'unknown',
      ejendomsvaerdiskatMonthly: null,
      grundskyldMonthly: null,
      estimateComplete: false,
    };
  }
  return {
    ownerCostMonthly: (evs?.monthly ?? 0) + (grund?.monthly ?? 0),
    source: 'estimate',
    ejendomsvaerdiskatMonthly: evs?.monthly ?? null,
    grundskyldMonthly: grund?.monthly ?? null,
    estimateComplete: false,
  };
}

/**
 * @param {LoanSchedule} schedule
 * @param {number} cash What the loan pays out.
 * @param {number} deductionShare This loan's share of the total first-year deduction, in kr per year.
 * @returns {Object}
 */
function describeLoan(schedule, cash, deductionShare) {
  return {
    cash,
    nominal: schedule.principal,
    annualRate: schedule.annualRate,
    bidragPct: schedule.bidragPct,
    termYears: schedule.termYears,
    interestOnlyYears: schedule.interestOnlyYears,
    grossMonthly: schedule.firstMonthPayment,
    grossMonthlyAfterInterestOnly: schedule.paymentAfterInterestOnly,
    netMonthly: schedule.firstMonthPayment - deductionShare / 12,
    firstYearInterest: schedule.firstYearInterest,
    totalInterest: schedule.totalInterest,
    schedule,
  };
}

/**
 * The whole Danish purchase: funding, one-off costs, monthly costs, and what is owed when.
 *
 * @param {Object} [raw] Inputs, see {@link normalizeDanishParams}; anything missing takes its default.
 * @returns {import('../../../types/finance.js').DanishFinancingResult}
 */
export function calculateDanishFinancing(raw = {}) {
  const p = normalizeDanishParams(raw);
  const price = p.purchasePrice;
  const stack = fundingStack(price, p);

  const realkredit = simulateLoan({
    principal: stack.realkreditNominal,
    annualRate: p.realkredit.rate,
    bidragPct: stack.bidragPct,
    termYears: p.realkredit.termYears,
    interestOnlyYears: p.realkredit.interestOnlyYears,
  });
  const bank = simulateLoan({
    principal: stack.bankLoan,
    annualRate: p.bank.rate,
    bidragPct: 0,
    termYears: p.bank.termYears,
    interestOnlyYears: p.bank.interestOnlyYears,
  });

  const skoede = tinglysningSkoede(price, p.publicValuation);
  const pantRealkredit = tinglysningPant(stack.realkreditNominal);
  const pantBank = tinglysningPant(stack.bankLoan);
  const oneOffTotal = skoede.total + pantRealkredit + pantBank + p.lenderFees + p.advisorFee + p.ownerChangeInsurance;
  const cashNeeded = stack.downPayment + oneOffTotal;

  const firstYearInterest = realkredit.firstYearInterest + bank.firstYearInterest;
  const deductionAnnual = interestDeduction(firstYearInterest, {
    persons: p.persons,
    pct: p.deductionPct,
    highPct: p.deductionHighPct,
  });
  const shareOf = (interest) => (firstYearInterest > 0 ? (deductionAnnual * interest) / firstYearInterest : 0);

  const realkreditOut = describeLoan(realkredit, stack.realkreditCash, shareOf(realkredit.firstYearInterest));
  const bankOut = describeLoan(bank, stack.bankLoan, shareOf(bank.firstYearInterest));

  const running = runningCosts(p);
  const grossPayment = realkredit.firstMonthPayment + bank.firstMonthPayment;
  const netPayment = grossPayment - deductionAnnual / 12;
  const ownerCost = running.ownerCostMonthly;

  const termMonths = Math.max(
    realkredit.principal > 0 ? realkredit.termYears * 12 : 0,
    bank.principal > 0 ? bank.termYears * 12 : 0,
  );

  return {
    currency: 'DKK',
    params: p,
    purchasePrice: price,
    funding: {
      ...stack,
      totalNominal: stack.realkreditNominal + stack.bankLoan,
    },
    oneOff: {
      skoede,
      pantRealkredit,
      pantBank,
      lenderFees: p.lenderFees,
      advisorFee: p.advisorFee,
      ownerChangeInsurance: p.ownerChangeInsurance,
      total: oneOffTotal,
    },
    cashNeeded,
    cashShortfall: p.cashAvailable == null ? null : Math.max(0, cashNeeded - p.cashAvailable),
    loans: { realkredit: realkreditOut, bank: bankOut },
    deduction: { annual: deductionAnnual, monthly: deductionAnnual / 12, firstYearInterest },
    payment: {
      gross: grossPayment,
      net: netPayment,
      grossAfterInterestOnly: realkredit.paymentAfterInterestOnly + bank.paymentAfterInterestOnly,
    },
    running,
    // The housing cost the 35 % rule is held against: what leaves the account each month, with the
    // rentefradrag already back. Without a known ejerudgift this is the loans alone, and
    // `ownerCostKnown` says so.
    totalMonthly: {
      gross: grossPayment + (ownerCost ?? 0),
      net: netPayment + (ownerCost ?? 0),
      ownerCostKnown: ownerCost != null,
    },
    debt: {
      afterInterestOnly:
        balanceAtYear(realkredit, realkredit.interestOnlyYears) + balanceAtYear(bank, bank.interestOnlyYears),
      atYears: p.atYears,
      atYearsBalance: balanceAtYear(realkredit, p.atYears) + balanceAtYear(bank, p.atYears),
      totalInterest: realkredit.totalInterest + bank.totalInterest,
    },
    payoffMonths: termMonths > 0 ? termMonths : null,
  };
}

/**
 * The highest purchase price whose total monthly housing cost (after rentefradrag) stays within a
 * monthly budget. Found by bisection: the cost rises with the price, and its pieces (tiered
 * deduction, bidrag bands) have no closed form together. Everything but the price - including the
 * ejerudgift of this particular home - is held as given.
 *
 * @param {number} monthlyBudget What housing may cost per month, e.g. the 35 % rule's headroom.
 * @param {Object} [raw] Inputs as for {@link calculateDanishFinancing}; `purchasePrice` is ignored.
 * @returns {number} Kr, 0 when even the fixed running costs exceed the budget.
 */
export function maxDanishPrice(monthlyBudget, raw = {}) {
  const budget = num(monthlyBudget);
  if (budget <= 0) {
    return 0;
  }
  const monthlyAt = (price) => calculateDanishFinancing({ ...raw, purchasePrice: price }).totalMonthly.net;
  if (monthlyAt(0) > budget) {
    return 0;
  }
  let low = 0;
  let high = 1000000;
  while (monthlyAt(high) <= budget && high < 1e10) {
    low = high;
    high *= 2;
  }
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (monthlyAt(mid) <= budget) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return Math.floor(low);
}
