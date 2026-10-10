/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Adds `rental_terms` to `listings`: the deposit, prepaid rent, lease length, availability and the
 * like that a rental advert states next to the rent, as JSON (see `services/rental/rentalTerms.js`).
 *
 * One JSON column instead of one per figure: they are read together on the listing's detail card and
 * never filtered on, and every portal states a different subset, so a column each would be mostly
 * empty and a new portal's extra field would be a new migration. `NULL` is "the portal did not say",
 * which is every row that exists today.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function up(db) {
  const columns = db.prepare(`PRAGMA table_info(listings)`).all();
  if (!columns.some((column) => column.name === 'rental_terms')) {
    db.exec(`ALTER TABLE listings ADD COLUMN rental_terms TEXT`);
  }
}
