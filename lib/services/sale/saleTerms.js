/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { normalizeIsoDate } from '../rental/rentalTerms.js';

/**
 * What a Danish for-sale advert states beside the asking price, in one shape.
 *
 * A Danish purchase is judged on more than the price: the owner's monthly running costs
 * (`ejerudgift`), what the same home sold for before, how long it has been for sale and with whom,
 * and what the building is. A provider reads its own fields and hands the raw figures to
 * {@link buildSaleTerms}, which is the one place that decides what a usable value is.
 *
 * Every field is nullable and a missing one means "the advert did not say", never zero: a home with
 * no stated ejerudgift is not a home with free upkeep. Numbers stay numbers; nothing here goes into
 * a listing's hash.
 */

/**
 * @typedef {Object} SaleSale One earlier sale of the address.
 * @property {string} date `YYYY-MM-DD`.
 * @property {number} amount The price paid, in kroner.
 * @property {string} type `normal` for a free sale on the open market. Anything else (family, auction,
 *   other) is not a market price and must be labelled, never compared as one. A sale whose type is not
 *   stated is `other`.
 * @property {number|null} area The living area it was sold with, where the register has it.
 */

/**
 * @typedef {Object} SaleOpenHouse The next open house.
 * @property {string} date An ISO timestamp.
 * @property {string|null} signUpUrl Where to register, where registration is needed.
 */

/**
 * @typedef {Object} SaleTerms What is stored for a for-sale listing, as JSON in `listings.sale_terms`.
 * @property {number|null} ownerCostMonthly Ejerudgift: the owner's monthly running costs.
 * @property {number|null} downPayment The udbetaling the realtor quotes.
 * @property {number|null} grossPaymentMonthly The realtor's example payment, before interest deduction.
 * @property {number|null} netPaymentMonthly The realtor's example payment, after interest deduction.
 * @property {number|null} pricePerM2 Kroner per square metre, as the portal states it.
 * @property {number|null} publicValuation The latest public valuation (offentlig ejendomsvurdering).
 * @property {SaleSale[]} sales Earlier sales, newest first. Empty when there are none on record.
 * @property {{current: number|null, total: number|null}} daysOnMarket Days with this realtor, and in
 *   total. A large gap between the two means the home was relisted.
 * @property {string[]} previousRealtors The realtors that had the home before the current one.
 * @property {number|null} priceChangePct Change since first listed, in percent (negative: reduced).
 * @property {string|null} energyLabel
 * @property {number|null} lotArea Plot size, m².
 * @property {number|null} basementArea m².
 * @property {number|null} bathrooms
 * @property {number|null} yearBuilt
 * @property {number|null} yearRenovated
 * @property {string|null} heating
 * @property {number|null} landTaxPerMille The kommune's grundskyld, promille.
 * @property {number|null} municipalTaxPct The kommune's tax percentage, for the interest-deduction value.
 * @property {string|null} propertyType `villa`, `terraced house`, `condo` and the like.
 * @property {string|null} floorPlanUrl A link to the floor plan.
 * @property {SaleOpenHouse|null} nextOpenHouse
 */

/**
 * @typedef {Partial<Record<keyof SaleTerms, unknown>>} SaleTermsInput What a provider read off an
 *   advert, field for field the shape of {@link SaleTerms}. Anything not usable is dropped rather than
 *   rejected.
 */

/** The most earlier sales kept: a register can list a dozen, and only the recent ones inform a price. */
const MAX_SALES = 30;
const MAX_REALTORS = 10;

/** The fields that are not a plain scalar, and so are judged separately when deciding if anything is stated. */
const COMPOUND = ['sales', 'daysOnMarket', 'previousRealtors', 'nextOpenHouse'];

/**
 * @param {unknown} value
 * @param {{min?: number, integer?: boolean}} [options]
 * @returns {number|null} A finite number within the bounds, else `null`. Text is read as a plain
 *   number, because the portals this is fed from answer with JSON numbers.
 */
function num(value, { min = 0, integer = false } = {}) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) return null;
  return integer && !Number.isInteger(n) ? null : n;
}

/** @param {unknown} value @param {number} max @returns {string|null} Trimmed text, or `null` when blank. */
function text(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

/** @param {unknown} value @returns {string|null} An http(s) URL, else `null`. */
function url(value) {
  const candidate = text(value, 2048);
  if (candidate == null) return null;
  try {
    const { protocol } = new URL(candidate);
    return protocol === 'https:' || protocol === 'http:' ? candidate : null;
  } catch {
    return null;
  }
}

/** @param {unknown} value @returns {number|null} A plausible calendar year. */
function year(value) {
  const n = num(value, { min: 1000, integer: true });
  return n != null && n <= 2200 ? n : null;
}

/** @param {unknown} list @returns {SaleSale[]} The usable earlier sales, newest first. */
function sales(list) {
  if (!Array.isArray(list)) return [];
  /** @type {SaleSale[]} */
  const out = [];
  for (const entry of list) {
    if (entry == null || typeof entry !== 'object') continue;
    const date = normalizeIsoDate(entry.date)?.slice(0, 10);
    const amount = num(entry.amount, { min: 1 });
    if (date == null || amount == null) continue;
    out.push({
      date,
      amount,
      // Not stating the type is not stating "normal": it must not pass for a market price.
      type: text(entry.type, 30)?.toLowerCase() ?? 'other',
      area: num(entry.area, { min: 1 }),
    });
  }
  // ISO dates sort as text. Same-day sales (an auction logged several times) keep their order.
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, MAX_SALES);
}

/** @param {unknown} value @returns {SaleOpenHouse|null} */
function openHouse(value) {
  if (value == null || typeof value !== 'object') return null;
  const date = text(value.date, 40);
  if (date == null || Number.isNaN(Date.parse(date))) return null;
  return { date, signUpUrl: url(value.signUpUrl) };
}

/**
 * Turns what a portal states into the stored shape.
 *
 * @param {SaleTermsInput} [input]
 * @returns {{sale?: SaleTerms}} `sale` is absent when the advert states none of it, so that a
 *   provider can spread the result into its listing and a listing without terms carries nothing.
 */
export function buildSaleTerms(input = {}) {
  const source = input ?? {};
  const days = source.daysOnMarket != null && typeof source.daysOnMarket === 'object' ? source.daysOnMarket : {};

  /** @type {SaleTerms} */
  const sale = {
    ownerCostMonthly: num(source.ownerCostMonthly),
    downPayment: num(source.downPayment),
    grossPaymentMonthly: num(source.grossPaymentMonthly),
    netPaymentMonthly: num(source.netPaymentMonthly),
    pricePerM2: num(source.pricePerM2),
    publicValuation: num(source.publicValuation, { min: 1 }),
    sales: sales(source.sales),
    daysOnMarket: {
      current: num(days.current, { integer: true }),
      total: num(days.total, { integer: true }),
    },
    previousRealtors: Array.isArray(source.previousRealtors)
      ? source.previousRealtors
          .map((name) => text(name, 80))
          .filter((name) => name != null)
          .slice(0, MAX_REALTORS)
      : [],
    // A reduction is negative, which is the point of the field.
    priceChangePct: num(source.priceChangePct, { min: -100 }),
    energyLabel: text(source.energyLabel, 10)?.toUpperCase() ?? null,
    lotArea: num(source.lotArea),
    basementArea: num(source.basementArea),
    bathrooms: num(source.bathrooms, { integer: true }),
    yearBuilt: year(source.yearBuilt),
    yearRenovated: year(source.yearRenovated),
    heating: text(source.heating, 80),
    landTaxPerMille: num(source.landTaxPerMille),
    municipalTaxPct: num(source.municipalTaxPct),
    propertyType: text(source.propertyType, 40),
    floorPlanUrl: url(source.floorPlanUrl),
    nextOpenHouse: openHouse(source.nextOpenHouse),
  };

  const stated =
    sale.sales.length > 0 ||
    sale.previousRealtors.length > 0 ||
    sale.nextOpenHouse != null ||
    sale.daysOnMarket.current != null ||
    sale.daysOnMarket.total != null ||
    Object.entries(sale).some(([key, value]) => value != null && !COMPOUND.includes(key));
  return stated ? { sale } : {};
}

/**
 * Reads the stored JSON back, defensively: a hand-edited or older row must not break a listing.
 *
 * @param {string|object|null|undefined} stored
 * @returns {SaleTerms|null}
 */
export function parseSaleTerms(stored) {
  if (stored == null) return null;
  let value = stored;
  if (typeof stored === 'string') {
    try {
      value = JSON.parse(stored);
    } catch {
      return null;
    }
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return buildSaleTerms(value).sale ?? null;
}
