/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import { up } from '../../lib/services/storage/migrations/sql/53.news-dk-last-seen-version.js';
import { compareDkVersions } from '../../ui/src/services/news/newsSelection.js';

/**
 * Existing users get a marker older than every DK release, so they see the first DK news once.
 */
describe('migration 53 - the Fredy DK news marker', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);
      CREATE TABLE settings (id TEXT PRIMARY KEY, create_date INTEGER, name TEXT, value TEXT, user_id TEXT);
    `);
  });

  afterEach(() => db.close());

  const addUser = (id) => db.prepare(`INSERT INTO users (id, username) VALUES (?, ?)`).run(id, id);
  const settingFor = (userId) =>
    db.prepare(`SELECT value FROM settings WHERE name = 'news_dk_last_seen_version' AND user_id = ?`).get(userId)
      ?.value;

  it('gives every existing user the baseline, which sorts before the first DK release', () => {
    addUser('a');
    addUser('b');
    up(db);
    const marker = JSON.parse(settingFor('a'));
    expect(marker).toBe('0.0.0-dk.0');
    expect(JSON.parse(settingFor('b'))).toBe('0.0.0-dk.0');
    expect(compareDkVersions('29.2.1-dk.1', marker)).toBeGreaterThan(0);
  });

  it('keeps a marker somebody already has', () => {
    addUser('a');
    db.prepare(
      `INSERT INTO settings (id, create_date, name, value, user_id) VALUES ('x', 1, 'news_dk_last_seen_version', '"29.2.1-dk.1"', 'a')`,
    ).run();
    up(db);
    expect(JSON.parse(settingFor('a'))).toBe('29.2.1-dk.1');
  });

  it('does not touch the upstream marker and gives a later user nothing', () => {
    addUser('existing');
    up(db);
    addUser('later');
    expect(settingFor('later')).toBeUndefined();
    expect(db.prepare(`SELECT COUNT(1) AS n FROM settings WHERE name = 'news_last_seen_version'`).get().n).toBe(0);
  });
});
