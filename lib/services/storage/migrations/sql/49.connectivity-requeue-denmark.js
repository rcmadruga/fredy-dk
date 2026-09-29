/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Puts the listings whose connectivity lookup came back without an answer back in the sweep's queue.
 *
 * Denmark gained a coverage source in this release. Until now the sweep had nobody to ask about a
 * Danish listing, and stamped it with `connectivity = NULL` and the time - which the queue reads as
 * done for `connectivityMaxAgeDays`, 180 by default. Every Danish listing already stored would go on
 * showing "no coverage data yet" for half a year, and because none of them reaches the source, the
 * import of the address file that starts on the first lookup would not begin either.
 *
 * Same fix as migration 45 was for Austria and Spain: clearing the stamp is all it takes. A listing
 * elsewhere whose lookup found nothing is asked once more and stamped again.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function up(db) {
  db.exec(`UPDATE listings SET connectivity_at = NULL WHERE connectivity IS NULL AND connectivity_at IS NOT NULL`);
}
