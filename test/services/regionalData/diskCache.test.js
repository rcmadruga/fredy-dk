/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rm } from 'fs/promises';
import { CACHE_DIR } from '../../../lib/services/regionalData/constants.js';
import { cached, clearRegionalDataCache } from '../../../lib/services/regionalData/diskCache.js';

// A real (temporary, gitignored) location under db/, not a mock: the disk mirror is the point of
// this module, and a test that stubs fs would only prove the stub works.
const TEST_KEY = `test-${Math.random().toString(36).slice(2)}`;

beforeEach(() => {
  clearRegionalDataCache();
});

afterEach(async () => {
  clearRegionalDataCache();
  await rm(CACHE_DIR, { recursive: true, force: true });
});

describe('cached', () => {
  it('serves a second call from memory without calling the loader again', async () => {
    const loader = vi.fn().mockResolvedValue('value');

    await cached(TEST_KEY, () => 60_000, loader);
    await cached(TEST_KEY, () => 60_000, loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent misses into one upstream call', async () => {
    // The executor runs synchronously, so `resolveLoad` is assigned before either `cached()` call
    // below has a chance to invoke the loader - unlike `mockImplementation(() => new Promise(...))`,
    // which would only create (and thus resolve) the promise once the loader actually runs.
    let resolveLoad;
    const deferred = new Promise((resolve) => (resolveLoad = resolve));
    const loader = vi.fn().mockReturnValue(deferred);

    const both = Promise.all([cached(TEST_KEY, () => 60_000, loader), cached(TEST_KEY, () => 60_000, loader)]);
    resolveLoad('value');
    const [first, second] = await both;

    expect(loader).toHaveBeenCalledTimes(1);
    expect(first).toBe('value');
    expect(second).toBe('value');
  });

  it('persists a successful load to disk, and a fresh process (empty memory) reads it back', async () => {
    await cached(
      TEST_KEY,
      () => 60_000,
      async () => ({ hello: 'world' }),
    );
    clearRegionalDataCache(); // simulate a restart: memory is gone, the disk file is not

    const loader = vi.fn();
    const value = await cached(TEST_KEY, () => 60_000, loader);

    expect(value).toEqual({ hello: 'world' });
    expect(loader).not.toHaveBeenCalled();
  });

  it('does not persist a null (failed) load, so a struggling upstream is retried next time', async () => {
    await cached(
      TEST_KEY,
      () => 60_000,
      async () => null,
    );
    clearRegionalDataCache();

    const loader = vi.fn().mockResolvedValue('recovered');
    const value = await cached(TEST_KEY, () => 60_000, loader);

    expect(value).toBe('recovered');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reloads once the TTL has expired', async () => {
    await cached(
      TEST_KEY,
      () => -1,
      async () => 'stale',
    );

    const loader = vi.fn().mockResolvedValue('fresh');
    const value = await cached(TEST_KEY, () => 60_000, loader);

    expect(value).toBe('fresh');
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
