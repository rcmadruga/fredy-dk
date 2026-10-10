/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The shapes every metric module speaks. Types only: this file exports nothing at run time, and
 * exists so the group modules and the engine point at one definition.
 *
 * @typedef {'money'|'schools'|'work'|'home'|'area'|'deal'} GroupId
 */

/**
 * @typedef {Object} Target The two values a metric is scored between.
 * @property {number} ideal The value that scores 100 (and everything past it).
 * @property {number} worst The value that scores 0 (and everything past it). `ideal < worst` means
 *   lower is better, `ideal > worst` means higher is better.
 */

/**
 * What the engine knows about one listing besides the listing itself. Built by `context.js` for a
 * batch of listings; a metric reads only the keys it documents and treats an absent key as "this
 * data is not available", which makes the metric missing rather than wrong. Tests pass plain objects.
 *
 * @typedef {Object} ScoreContext
 * @property {Object|null} [financeProfile] The caller's finance profile, for `money.affordable`.
 * @property {boolean} [danish] The listing's provider prices in kroner, so a purchase uses the Danish finance model.
 * @property {{maxPrice: (number|null), minSize: (number|null)}} [job] What the job's `spec_filter` asks.
 * @property {{low: number, high: number}|null} [pricePerSqm] The 25th and 90th percentile of the
 *   price per m² across the job's active listings, the default targets of `money.value`.
 * @property {number} [currentYear] The year building ages are counted to; defaults to this year.
 * @property {string|null} [commuteLabel] The travel-time address `work.commute` measures to.
 * @property {'transit'|'car'|'bike'|'walk'|null} [commuteMode] How that address is travelled to.
 * @property {string|null} [kommuneCode] The Danish kommune the listing lies in, for the kommune-level metrics.
 * @property {import('../schoolsData.js').SchoolsData|null} [schools] The school layer, for the Schools group.
 * @property {number|null} [kommuneJobs] Open job posts in the listing's kommune.
 * @property {number|null} [nearestSupermarketMeters] Straight-line distance to the nearest supermarket
 *   in the DK supermarket layer, the fallback of `area.grocery`.
 * @property {(isoDate: string) => (number|null)} [appreciationSince] The area's price growth factor
 *   since a date (1.1 for +10 %), for `deal.vsLastSale`. Absent until the valuation trend source exists.
 */

/**
 * @typedef {Object} MetricDescriptor
 * @property {string} id Unique within its group; the config key is `<group>.<id>`.
 * @property {GroupId} group
 * @property {string} labelKey i18n key of the metric's name, resolved by the UI.
 * @property {string} unit Display unit: `min`, `km`, `m`, `m2`, `pct`, `krPerM2`, `ratio`, `days`, `count`,
 *   `grade`, `bool`, `mbit`, `years`, `eurPerM2`.
 * @property {'lower'|'higher'} direction Which way is better. Informational: the targets decide.
 * @property {boolean} [buyOnly] Skipped entirely for a rental, not even counted as missing.
 * @property {number} [defaultWeight] Weight inside the group when the job sets none. Default 1.
 * @property {'kommune'|'estimate'|null} [qualifier] Shown next to the value so nobody reads a
 *   kommune-wide figure as street-level data or a heuristic as a fact.
 * @property {(listing: Object, ctx: ScoreContext) => (number|null)} raw The measured value, or
 *   `null` when it cannot be had.
 * @property {(ctx: ScoreContext) => (Target|null)} defaults The targets used when the job sets none.
 *   `null` means there is no sensible default, so the metric is missing until the user sets targets.
 */

export {};
