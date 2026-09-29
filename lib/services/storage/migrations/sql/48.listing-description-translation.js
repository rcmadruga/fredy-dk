/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * An English translation of a listing's description, kept beside the original.
 *
 * Stored rather than translated on every view, so a refresh costs nothing and the text does not
 * change under the reader.
 *
 * - `description_en`: the translation. NULL until one was made, and also NULL where the description
 *   is already English, since there is nothing to show.
 * - `description_lang`: the language the description was detected as (ISO 639-1). Set whenever a
 *   translation was attempted successfully, English included, so an English description is not
 *   sent off again.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function up(db) {
  const columns = db.prepare(`PRAGMA table_info(listings)`).all();
  const missing = (name) => !columns.some((column) => column.name === name);

  if (missing('description_en')) {
    db.exec(`ALTER TABLE listings ADD COLUMN description_en TEXT`);
  }
  if (missing('description_lang')) {
    db.exec(`ALTER TABLE listings ADD COLUMN description_lang TEXT`);
  }
}
