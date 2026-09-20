/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'fs';
import path from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { CACHE_DIR } from './constants.js';
import logger from '../logger.js';

/**
 * Read-through cache for regional data: kommune polygons and tax rates barely change, and every
 * Fredy instance asking DAWA/Statbank for the same national dataset on every process restart would
 * be an odd way to treat a public service. In memory for the lifetime of the process, mirrored to a
 * JSON file under `db/regionalDataCache/` so a restart does not pay the fetch (and, for kommune
 * polygons, the simplification) again.
 *
 * Mirrors the shape of `lib/services/transit/transitCache.js` - same read-through-plus-in-flight-
 * dedup design, a `null` result cached briefly rather than a thrown error - plus the disk mirror,
 * which transit lookups do not need because they are cheap to redo and keyed by coordinate rather
 * than by "the whole country".
 *
 * Deliberately not the SQLite database: this is a handful of read-mostly blobs with no relational
 * shape, and one file each is simpler than a migration and a table would be.
 */

/** @type {Map<string, {expiresAt: number, value: unknown}>} */
const memory = new Map();

/** @type {Map<string, Promise<unknown>>} */
const inFlight = new Map();

function filePathFor(key) {
  return path.join(CACHE_DIR, `${key}.json`);
}

async function readDiskEntry(key) {
  try {
    const raw = await readFile(filePathFor(key), 'utf8');
    const entry = JSON.parse(raw);
    if (entry && typeof entry.expiresAt === 'number' && entry.expiresAt > Date.now() && entry.value != null) {
      return entry;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.debug(`Regional data cache: could not read ${key} from disk`, error);
    }
  }
  return null;
}

async function writeDiskEntry(key, entry) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    // Written to a temp file and renamed, same reasoning as conf/config.json: a crash mid-write must
    // not leave a truncated JSON file that a later read fails to parse.
    const target = filePathFor(key);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(entry));
    fs.renameSync(tmp, target);
  } catch (error) {
    // The disk mirror is an optimization, not the source of truth - losing it only costs the next
    // process start a re-fetch.
    logger.debug(`Regional data cache: could not persist ${key} to disk`, error);
  }
}

/**
 * Reads through the cache, collapsing concurrent misses of the same key into one upstream call.
 * A successful (non-null) load is also mirrored to disk; a `null` result never is, so a struggling
 * upstream cannot freeze the layer permanently off for every future process start.
 *
 * @template T
 * @param {string} key - Used as the cache file's name; keep it filesystem-safe.
 * @param {(value: T) => number} ttlFor - Lifetime in milliseconds for the value that was loaded.
 * @param {() => Promise<T>} loader - Should resolve to `null` rather than reject on a failed fetch.
 * @returns {Promise<T>}
 */
export async function cached(key, ttlFor, loader) {
  const hit = memory.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return /** @type {T} */ (hit.value);
  }
  memory.delete(key);

  const running = inFlight.get(key);
  if (running) {
    return /** @type {Promise<T>} */ (running);
  }

  const promise = (async () => {
    const onDisk = await readDiskEntry(key);
    if (onDisk) {
      memory.set(key, onDisk);
      return /** @type {T} */ (onDisk.value);
    }

    const value = await loader();
    const entry = { expiresAt: Date.now() + ttlFor(value), value };
    memory.set(key, entry);
    if (value != null) {
      await writeDiskEntry(key, entry);
    }
    return value;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

/** Drops every cached entry from memory (not disk). Only used by tests. */
export function clearRegionalDataCache() {
  memory.clear();
  inFlight.clear();
}
