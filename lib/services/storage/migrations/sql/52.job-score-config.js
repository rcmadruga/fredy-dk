/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * How a job scores its listings: the weight of each group and metric, the user's own ideal and
 * worst values per metric, and which saved address is "work".
 *
 * On the job, like `commute_filter`, because it is a search criterion: two searches can reasonably
 * disagree about what matters. A nullable JSON column, and NULL means "all defaults", which is what
 * every job in every existing installation is, so nothing about an existing search changes.
 *
 * Shape, every part optional (see `services/score/config.js`):
 *
 * ```json
 * {
 *   "groups":  { "money": 1, "schools": 1, "work": 1, "home": 1, "area": 1, "deal": 1 },
 *   "metrics": { "home.parking": 0, "work.jobs": 0.5 },
 *   "targets": { "work.commute": { "ideal": 20, "worst": 60 } },
 *   "commute": { "label": "Work" }
 * }
 * ```
 *
 * A weight of 0 switches a group or metric off. The score itself is never stored: it moves with the
 * targets, the weights, the job's percentiles and the finance profile, and is computed on read.
 *
 * The number is 52 because `feat/dk-buying` takes 51. The runner tracks migrations by file name, so
 * the gap is harmless until that branch merges.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function up(db) {
  const columns = db
    .prepare(`PRAGMA table_info(jobs)`)
    .all()
    .map((column) => column.name);
  if (!columns.includes('score_config')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN score_config TEXT`);
  }
}
