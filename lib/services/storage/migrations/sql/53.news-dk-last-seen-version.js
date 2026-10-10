/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { nanoid } from 'nanoid';

/**
 * The marker that sorts before every Fredy DK release.
 *
 * Unlike migration 29, which drew a line under the news people had already read, this one wants the
 * opposite: Fredy DK's news did not exist before, so every user who is already here should be told
 * about the first release once. `0.0.0-dk.0` is older than any `<version>-dk.<n>` with n >= 1.
 * @type {string}
 */
const NEWS_DK_BASELINE_VERSION = '0.0.0-dk.0';

/**
 * Give every existing user a "last seen" marker for the Fredy DK part of What's new.
 *
 * Users created afterwards have no row, and the frontend reads that absence as "new here, show
 * nothing and quietly record the current DK version", the same rule the upstream marker follows.
 * A user who already has this marker keeps it.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function up(db) {
  const users = db.prepare(`SELECT id FROM users`).all();
  const exists = db.prepare(
    `SELECT 1 FROM settings WHERE name = 'news_dk_last_seen_version' AND user_id = @userId LIMIT 1`,
  );
  const insert = db.prepare(
    `INSERT INTO settings (id, create_date, name, value, user_id)
     VALUES (@id, @create_date, 'news_dk_last_seen_version', @value, @userId)`,
  );

  for (const { id: userId } of users) {
    if (exists.get({ userId })) continue;
    insert.run({
      id: nanoid(),
      create_date: Date.now(),
      value: JSON.stringify(NEWS_DK_BASELINE_VERSION),
      userId,
    });
  }
}
