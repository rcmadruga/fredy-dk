/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const root = (await import('node:path')).resolve('.');

/** @type {Array<{settings: Record<string, any>, userId: string|null}>} */
let upserted;

/**
 * Register the user-settings plugin against a fastify double and return the two news handlers.
 *
 * @param {{demoMode?: boolean, admin?: boolean}} [options]
 * @returns {Promise<Record<string, (request: any, reply: any) => Promise<any>>>}
 */
async function loadRoutes({ demoMode = false, admin = true } = {}) {
  upserted = [];
  vi.resetModules();
  vi.doMock(root + '/lib/services/storage/settingsStorage.js', () => ({
    getSettings: async () => ({ demoMode }),
    getUserSettings: () => ({}),
    getAddresses: () => [],
    upsertSettings: (settings, userId = null) => upserted.push({ settings, userId }),
  }));
  vi.doMock(root + '/lib/api/security.js', () => ({ isAdmin: () => admin }));
  vi.doMock(root + '/lib/services/tracking/Tracker.js', () => ({ trackPoi: async () => {} }));
  vi.doMock(root + '/lib/services/geocoding/geoCodingService.js', () => ({ geocodeAddress: vi.fn() }));
  vi.doMock(root + '/lib/services/geocoding/autocompleteService.js', () => ({ autocompleteAddress: vi.fn() }));
  vi.doMock(root + '/lib/services/geocoding/distanceService.js', () => ({
    updateDistancesForAddressChange: vi.fn(),
  }));
  vi.doMock(root + '/lib/services/crons/geocoding-cron.js', () => ({ runGeoCordTask: vi.fn() }));

  const plugin = (await import(root + '/lib/api/routes/userSettingsRoute.js')).default;
  const routes = {};
  await plugin({ get: () => {}, post: (path, handler) => (routes[path] = handler) });
  return routes;
}

/** A reply double that records what the handler answered. */
function replyDouble() {
  const recorded = { status: 200, payload: undefined };
  return {
    recorded,
    code(status) {
      recorded.status = status;
      return this;
    },
    send(payload) {
      recorded.payload = payload;
      return recorded;
    },
  };
}

describe('POST /api/user/settings/news-dk-last-seen-version', () => {
  /** @type {Record<string, (request: any, reply: any) => Promise<any>>} */
  let routes;

  beforeEach(async () => {
    routes = await loadRoutes();
  });

  const post = async (body, route = '/news-dk-last-seen-version') => {
    const reply = replyDouble();
    const result = await routes[route]({ session: { currentUser: 'u1' }, body }, reply);
    return { reply, result };
  };

  it('stores the DK marker under its own key for the calling user', async () => {
    const { result } = await post({ news_dk_last_seen_version: '29.2.1-dk.1' });
    expect(result).toEqual({ success: true });
    expect(upserted).toEqual([{ settings: { news_dk_last_seen_version: '29.2.1-dk.1' }, userId: 'u1' }]);
  });

  it('keeps the upstream marker on its own route', async () => {
    await post({ news_last_seen_version: '29.1.0' }, '/news-last-seen-version');
    expect(upserted).toEqual([{ settings: { news_last_seen_version: '29.1.0' }, userId: 'u1' }]);
  });

  it.each([[{}], [undefined], [{ news_dk_last_seen_version: 12 }], [{ news_dk_last_seen_version: 'x'.repeat(65) }]])(
    'rejects %j',
    async (body) => {
      const { reply } = await post(body);
      expect(reply.recorded.status).toBe(400);
      expect(upserted).toEqual([]);
    },
  );

  it('refuses a non-admin in demo mode', async () => {
    routes = await loadRoutes({ demoMode: true, admin: false });
    const { reply } = await post({ news_dk_last_seen_version: '29.2.1-dk.1' });
    expect(reply.recorded.status).toBe(403);
    expect(upserted).toEqual([]);
  });
});
