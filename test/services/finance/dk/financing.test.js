/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import {
  balanceAtYear,
  bidragPctFor,
  calculateDanishFinancing,
  ejendomsvaerdiskat,
  fundingStack,
  grundskyld,
  interestDeduction,
  maxDanishPrice,
  nominalDebt,
  normalizeDanishParams,
  roundUpTo,
  runningCosts,
  simulateLoan,
  tinglysningPant,
  tinglysningSkoede,
} from '../../../../lib/services/finance/dk/financing.js';

describe('roundUpTo', () => {
  it('rounds up to the step and keeps exact multiples', () => {
    expect(roundUpTo(17703, 100)).toBe(17800);
    expect(roundUpTo(18000, 100)).toBe(18000);
    // 600000 * 0.006 is 3600.0000000000005 in floating point; it must not jump to 3700.
    expect(roundUpTo(600000 * 0.006, 100)).toBe(3600);
  });
});

describe('tinglysningSkoede', () => {
  it('is 1,850 kr plus 0.6 % of the price', () => {
    // 3,000,000 * 0.006 = 18,000 (already a multiple of 100); 1,850 + 18,000 = 19,850.
    expect(tinglysningSkoede(3000000)).toEqual({ fixed: 1850, variable: 18000, total: 19850, basis: 3000000 });
  });

  it('rounds the variable part UP to the nearest 100 kr', () => {
    // 2,950,500 * 0.006 = 17,703 -> 17,800; 1,850 + 17,800 = 19,650.
    expect(tinglysningSkoede(2950500).total).toBe(19650);
    // 2,950,000 * 0.006 = 17,700 exactly, so no rounding: 19,550.
    expect(tinglysningSkoede(2950000).total).toBe(19550);
  });

  it('uses the public valuation when it is higher than the price', () => {
    // Price 2,000,000 but valuation 2,500,000: 2,500,000 * 0.006 = 15,000; 1,850 + 15,000 = 16,850.
    expect(tinglysningSkoede(2000000, 2500000)).toMatchObject({ variable: 15000, total: 16850, basis: 2500000 });
    // A valuation below the price changes nothing: 2,000,000 * 0.006 = 12,000.
    expect(tinglysningSkoede(2000000, 1500000)).toMatchObject({ variable: 12000, basis: 2000000 });
  });

  it('is zero without a price', () => {
    expect(tinglysningSkoede(0, 3000000).total).toBe(0);
  });
});

describe('tinglysningPant', () => {
  it('is 1,825 kr plus 1.25 % of the secured amount', () => {
    // 2,400,000 * 0.0125 = 30,000; 1,825 + 30,000 = 31,825.
    expect(tinglysningPant(2400000)).toBe(31825);
  });

  it('is zero when nothing is borrowed', () => {
    expect(tinglysningPant(0)).toBe(0);
    expect(tinglysningPant(-5)).toBe(0);
  });
});

describe('bidragPctFor', () => {
  it('reads the band the loan-to-value falls in', () => {
    expect(bidragPctFor(20)).toBe(0.5);
    expect(bidragPctFor(40)).toBe(0.5);
    expect(bidragPctFor(40.5)).toBe(0.7);
    expect(bidragPctFor(60)).toBe(0.7);
    expect(bidragPctFor(80)).toBe(1.0);
  });

  it('uses the last band above the table and accepts edited bands', () => {
    expect(bidragPctFor(95)).toBe(1.0);
    expect(bidragPctFor(50, [{ upToLtvPct: 100, bidragPct: 0.9 }])).toBe(0.9);
  });
});

describe('nominalDebt', () => {
  it('is cash over the kurs', () => {
    // Raised at kurs 97, 970,000 kr of cash needs 970,000 / 0.97 = 1,000,000 kr nominal.
    expect(nominalDebt(970000, 97)).toBeCloseTo(1000000, 6);
    expect(nominalDebt(970000)).toBe(970000);
  });
});

describe('simulateLoan', () => {
  it('matches the textbook annuity', () => {
    // 1,000,000 kr at 4 % rente + 1 % bidrag = 5 % for 30 years. r = 0.05 / 12 = 0.0041667, n = 360:
    // payment = P r / (1 - (1 + r)^-n) = 4166.67 / (1 - 0.22385) = 5,368.22 a month (the well known
    // figure for a 5 % thirty-year loan).
    const loan = simulateLoan({ principal: 1000000, annualRate: 4, bidragPct: 1, termYears: 30 });
    expect(loan.firstMonthPayment).toBeCloseTo(5368.22, 1);
    expect(loan.paymentAfterInterestOnly).toBeCloseTo(5368.22, 1);
    // Month 1 interest: 1,000,000 * 0.05 / 12 = 4,166.67, so 1,201.55 is repaid.
    expect(loan.years[0].interest + loan.years[0].bidrag).toBeGreaterThan(48000);
    // Cleared at the end, and 360 payments of 5,368.22 = 1,932,558 in all.
    expect(loan.years.at(-1).balance).toBe(0);
    expect(loan.totalPaid).toBeCloseTo(1932558, -1);
    expect(loan.totalInterest).toBeCloseTo(932558, -1);
  });

  it('splits the year into rente and bidrag', () => {
    // 1,000,000 at 4 % + 1 %: the first month's rente is 3,333.33 and bidrag 833.33.
    const loan = simulateLoan({ principal: 1000000, annualRate: 4, bidragPct: 1, termYears: 30 });
    const bidragShare = loan.years[0].bidrag / (loan.years[0].interest + loan.years[0].bidrag);
    expect(bidragShare).toBeCloseTo(0.2, 6);
  });

  it('pays only interest during the interest-only years, then the annuity', () => {
    // 120,000 kr at 6 % for 10 years with 2 interest-only: month 1 = 120,000 * 0.06 / 12 = 600.
    const loan = simulateLoan({ principal: 120000, annualRate: 6, termYears: 10, interestOnlyYears: 2 });
    expect(loan.firstMonthPayment).toBeCloseTo(600, 6);
    expect(loan.balanceAfterInterestOnly).toBe(120000);
    expect(balanceAtYear(loan, 2)).toBeCloseTo(120000, 6);
    // Then 8 years = 96 months at r = 0.005: 1.005^96 = 1.6141, so payment = 600 / (1 - 1/1.6141)
    // = 600 / 0.38049 = 1,576.97.
    expect(loan.paymentAfterInterestOnly).toBeCloseTo(1576.97, 1);
    expect(loan.years.at(-1).balance).toBe(0);
  });

  it('divides evenly at a zero rate', () => {
    // 120,000 over 10 years at 0 %: 120,000 / 120 = 1,000 a month, 60,000 left after 5 years.
    const loan = simulateLoan({ principal: 120000, annualRate: 0, termYears: 10 });
    expect(loan.firstMonthPayment).toBe(1000);
    expect(balanceAtYear(loan, 5)).toBeCloseTo(60000, 6);
    expect(loan.totalInterest).toBe(0);
  });

  it('clamps interest-only years to ten and to the term, and tolerates nothing to borrow', () => {
    expect(
      simulateLoan({ principal: 1e6, annualRate: 4, termYears: 30, interestOnlyYears: 25 }).interestOnlyYears,
    ).toBe(10);
    expect(simulateLoan({ principal: 1e6, annualRate: 4, termYears: 5, interestOnlyYears: 8 }).interestOnlyYears).toBe(
      5,
    );
    const none = simulateLoan({ principal: 0, annualRate: 4, termYears: 30 });
    expect(none.firstMonthPayment).toBe(0);
    expect(none.years).toEqual([]);
  });
});

describe('balanceAtYear', () => {
  it('reads the schedule, with year 0 the principal and anything past the term zero', () => {
    const loan = simulateLoan({ principal: 120000, annualRate: 0, termYears: 10 });
    expect(balanceAtYear(loan, 0)).toBe(120000);
    expect(balanceAtYear(loan, 10)).toBe(0);
    expect(balanceAtYear(loan, 40)).toBe(0);
    expect(balanceAtYear(null, 3)).toBe(0);
  });
});

describe('ejendomsvaerdiskat', () => {
  it('charges 0.51 % of 80 % of the valuation below the limit', () => {
    // Valuation 3,000,000 -> base 2,400,000 -> 2,400,000 * 0.0051 = 12,240 a year = 1,020 a month.
    expect(ejendomsvaerdiskat(3000000)).toEqual({ taxBase: 2400000, annual: 12240, monthly: 1020 });
  });

  it('charges 1.4 % on the part of the base above the 2026 limit', () => {
    // Valuation 12,000,000 -> base 9,600,000. Below 9,007,000: 9,007,000 * 0.0051 = 45,935.70.
    // Above: (9,600,000 - 9,007,000) = 593,000 * 0.014 = 8,302. Together 54,237.70.
    expect(ejendomsvaerdiskat(12000000).annual).toBeCloseTo(54237.7, 6);
  });

  it('is null without a valuation rather than zero', () => {
    expect(ejendomsvaerdiskat(null)).toBeNull();
    expect(ejendomsvaerdiskat(0)).toBeNull();
  });
});

describe('grundskyld', () => {
  it('is the promille of 80 % of the land value', () => {
    // Land 1,000,000 -> base 800,000; 25 per mille -> 800,000 * 25 / 1000 = 20,000 a year.
    expect(grundskyld(1000000, 25)).toEqual({ taxBase: 800000, annual: 20000, monthly: 20000 / 12 });
  });

  it('is unknown, not guessed, when the land value is not known', () => {
    expect(grundskyld(null, 25)).toBeNull();
    expect(grundskyld(1000000, null)).toBeNull();
  });
});

describe('interestDeduction', () => {
  it('values the first 50,000 kr at 33 % and the rest at 25 %', () => {
    // 80,000 kr, one person: 50,000 * 0.33 = 16,500 plus 30,000 * 0.25 = 7,500 -> 24,000.
    expect(interestDeduction(80000)).toBeCloseTo(24000, 6);
    // Below the threshold only the higher rate applies: 40,000 * 0.33 = 13,200.
    expect(interestDeduction(40000)).toBeCloseTo(13200, 6);
  });

  it('doubles the threshold for a couple and honours edited rates', () => {
    // Two people share 100,000 at the higher rate: 80,000 * 0.33 = 26,400.
    expect(interestDeduction(80000, { persons: 2 })).toBeCloseTo(26400, 6);
    expect(interestDeduction(60000, { pct: 30, highPct: 20, threshold: 50000 })).toBeCloseTo(15000 + 2000, 6);
  });
});

describe('fundingStack', () => {
  const p = normalizeDanishParams({ purchasePrice: 2000000 });

  it('is 5 % cash, 80 % realkredit and the rest bank', () => {
    // 2,000,000: udbetaling 100,000; realkredit 1,600,000; bank 2,000,000 - 100,000 - 1,600,000 = 300,000.
    expect(fundingStack(2000000, p)).toMatchObject({
      downPayment: 100000,
      realkreditCash: 1600000,
      realkreditNominal: 1600000,
      bankLoan: 300000,
      ltvPct: 80,
      bidragPct: 1.0,
    });
  });

  it('raises the nominal debt at a kurs below 100 and bases the bidrag band on it', () => {
    // At kurs 97 the 1,600,000 kr of cash needs 1,600,000 / 0.97 = 1,649,484.54 nominal (82.5 % of the price).
    const stack = fundingStack(2000000, normalizeDanishParams({ realkredit: { kurs: 97 } }));
    expect(stack.realkreditNominal).toBeCloseTo(1649484.54, 1);
    expect(stack.bankLoan).toBe(300000);
  });

  it('never lets the realkredit exceed what udbetaling leaves', () => {
    const stack = fundingStack(1000000, normalizeDanishParams({ downPaymentPct: 30 }));
    // 80 % would be 800,000 but only 700,000 is left after the 300,000 down payment.
    expect(stack.realkreditCash).toBe(700000);
    expect(stack.bankLoan).toBe(0);
  });
});

describe('runningCosts', () => {
  it('takes the ejerudgift of the advert as it stands and does not add the taxes again', () => {
    const costs = runningCosts(normalizeDanishParams({ ownerCostMonthly: 3500, publicValuation: 3000000 }));
    expect(costs).toMatchObject({ ownerCostMonthly: 3500, source: 'advert', ejendomsvaerdiskatMonthly: null });
  });

  it('estimates the taxes from the valuation when the advert gives no ejerudgift', () => {
    // Ejendomsvaerdiskat on 3,000,000 is 1,020 a month; grundskyld on land 1,000,000 at 25 per mille is
    // 20,000 / 12 = 1,666.67 a month.
    const costs = runningCosts(
      normalizeDanishParams({ publicValuation: 3000000, landValue: 1000000, landTaxPerMille: 25 }),
    );
    expect(costs.source).toBe('estimate');
    expect(costs.ownerCostMonthly).toBeCloseTo(1020 + 20000 / 12, 6);
    // It still leaves out the ejerforening's fee on a flat, so it is never called complete.
    expect(costs.estimateComplete).toBe(false);
  });

  it('shows grundskyld as unknown when the land value is not known', () => {
    const costs = runningCosts(normalizeDanishParams({ publicValuation: 3000000, landTaxPerMille: 25 }));
    expect(costs.grundskyldMonthly).toBeNull();
    expect(costs.ejendomsvaerdiskatMonthly).toBe(1020);
    expect(costs.ownerCostMonthly).toBe(1020);
  });

  it('is unknown with neither an ejerudgift nor a valuation', () => {
    expect(runningCosts(normalizeDanishParams({}))).toMatchObject({ ownerCostMonthly: null, source: 'unknown' });
  });
});

describe('calculateDanishFinancing', () => {
  // The worked example: a 2,000,000 kr home on the defaults (5 % cash, 80 % realkredit at 4 % + 1 % bidrag
  // over 30 years, the remaining 300,000 kr from the bank at 6 % over 20 years).
  const result = calculateDanishFinancing({ purchasePrice: 2000000 });

  it('sizes the layers', () => {
    expect(result.funding).toMatchObject({ downPayment: 100000, realkreditNominal: 1600000, bankLoan: 300000 });
    expect(result.funding.totalNominal).toBe(1900000);
  });

  it('adds up the one-off costs', () => {
    // Skoede 1,850 + 2,000,000 * 0.006 = 13,850. Pant realkredit 1,825 + 1,600,000 * 0.0125 = 21,825.
    // Pant bank 1,825 + 300,000 * 0.0125 = 5,575. Sum 41,250; with the 100,000 udbetaling, 141,250 cash.
    expect(result.oneOff).toMatchObject({ pantRealkredit: 21825, pantBank: 5575, total: 41250 });
    expect(result.oneOff.skoede.total).toBe(13850);
    expect(result.cashNeeded).toBe(141250);
  });

  it('computes the monthly payment of each loan and of both', () => {
    // Realkredit: 1.6 x 5,368.22 = 8,589.15. Bank: r = 0.005, n = 240, 1.005^240 = 3.3102, so
    // 300,000 * 0.005 / (1 - 1/3.3102) = 1,500 / 0.69790 = 2,149.29. Together 10,738.44.
    expect(result.loans.realkredit.grossMonthly).toBeCloseTo(8589.15, 1);
    expect(result.loans.bank.grossMonthly).toBeCloseTo(2149.29, 1);
    expect(result.payment.gross).toBeCloseTo(10738.44, 1);
  });

  it('nets the rentefradrag off the payment', () => {
    // Year-1 interest is about 79,464 on the realkredit and 17,782 on the bank loan: 97,246 together.
    // One person: 50,000 * 0.33 = 16,500 + 47,246 * 0.25 = 11,811.5 -> 28,311.5 a year = 2,359.29 a month.
    expect(result.deduction.firstYearInterest).toBeCloseTo(97246, -1);
    expect(result.deduction.annual).toBeCloseTo(28311.5, 0);
    expect(result.payment.net).toBeCloseTo(10738.44 - 2359.29, 0);
    // Each loan carries its share of the deduction, so the two net figures add up to the total.
    expect(result.loans.realkredit.netMonthly + result.loans.bank.netMonthly).toBeCloseTo(result.payment.net, 6);
  });

  it('reports the debt left after the interest-only years and at the chosen year', () => {
    // No interest-only years, so the whole 1,900,000 is still owed at "year 0 of repayment".
    expect(result.debt.afterInterestOnly).toBe(1900000);
    // With 5 interest-only years on a 1,000,000 realkredit nothing has been repaid after them.
    const io = calculateDanishFinancing({
      purchasePrice: 1250000,
      downPaymentPct: 20,
      realkredit: { pct: 80, interestOnlyYears: 5 },
      bank: {},
    });
    expect(io.funding.bankLoan).toBe(0);
    expect(io.debt.afterInterestOnly).toBe(1000000);
    // And 1,000,000 * 0.04 + bidrag 0.01 = 5 % -> first month 4,166.67 interest-only.
    expect(io.payment.gross).toBeCloseTo(4166.67, 1);
  });

  it('adds a known ejerudgift to the total and says when it is missing', () => {
    expect(result.totalMonthly.ownerCostKnown).toBe(false);
    const known = calculateDanishFinancing({ purchasePrice: 2000000, ownerCostMonthly: 3000 });
    expect(known.totalMonthly.ownerCostKnown).toBe(true);
    expect(known.totalMonthly.net).toBeCloseTo(known.payment.net + 3000, 6);
  });

  it('reports a cash shortfall only when cash on hand is given', () => {
    expect(result.cashShortfall).toBeNull();
    expect(calculateDanishFinancing({ purchasePrice: 2000000, cashAvailable: 100000 }).cashShortfall).toBe(41250);
    expect(calculateDanishFinancing({ purchasePrice: 2000000, cashAvailable: 500000 }).cashShortfall).toBe(0);
  });

  it('applies the edited deduction threshold for a couple', () => {
    // Two people: the first 100,000 of interest gets 33 %, so all 97,246 does: 32,091.2 a year.
    const couple = calculateDanishFinancing({ purchasePrice: 2000000, persons: 2 });
    expect(couple.deduction.annual).toBeCloseTo(97246 * 0.33, -1);
  });

  it('is all zeros for no price', () => {
    const empty = calculateDanishFinancing({});
    expect(empty.payment.gross).toBe(0);
    expect(empty.cashNeeded).toBe(0);
    expect(empty.payoffMonths).toBeNull();
  });
});

describe('maxDanishPrice', () => {
  it('finds the price that just fits the budget', () => {
    const params = { ownerCostMonthly: 3000 };
    const price = maxDanishPrice(15000, params);
    const at = (p) => calculateDanishFinancing({ ...params, purchasePrice: p }).totalMonthly.net;
    expect(at(price)).toBeLessThanOrEqual(15000);
    expect(at(price + 1000)).toBeGreaterThan(15000);
  });

  it('is zero when the running costs alone are over budget', () => {
    expect(maxDanishPrice(2000, { ownerCostMonthly: 3000 })).toBe(0);
    expect(maxDanishPrice(0)).toBe(0);
  });
});

describe('normalizeDanishParams', () => {
  it('fills defaults and drops nonsense', () => {
    const p = normalizeDanishParams({ downPaymentPct: 'abc', realkredit: { rate: -3, kurs: 0 }, ownerCostMonthly: '' });
    expect(p.downPaymentPct).toBe(5);
    expect(p.realkredit.rate).toBe(0);
    expect(p.realkredit.kurs).toBe(100);
    expect(p.ownerCostMonthly).toBeNull();
    expect(normalizeDanishParams(null).bank.rate).toBe(6);
  });
});
