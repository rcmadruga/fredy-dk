/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Adds `sale_terms` to `listings`: what a for-sale advert states beside the asking price - the
 * owner's monthly costs, earlier sales, time on the market, the building - as JSON (see
 * `services/sale/saleTerms.js`).
 *
 * One JSON column instead of one per figure, for the same reason as `rental_terms` (migration 50):
 * the figures are read together on the listing's detail card, the shape is the portal's, and a new
 * portal's extra field must not be a new migration. `NULL` is "the portal did not say", which is
 * every row that exists today.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function up(db) {
  const columns = db.prepare(`PRAGMA table_info(listings)`).all();
  if (!columns.some((column) => column.name === 'sale_terms')) {
    db.exec(`ALTER TABLE listings ADD COLUMN sale_terms TEXT`);
  }
}
