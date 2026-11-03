/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { DK_CURRENCY } from '../finance/dk/constants.js';
import { getProviderIdsForCurrency } from '../providers/providerCurrency.js';
import { distanceMeters } from '../listings/distanceCalculator.js';
import { kommuneOfPoint } from '../geo/denmarkGeo.js';
import { getGroceryLayer, getJobsLayer, getSchoolLayer } from '../regionalData/regionalDataService.js';
import * as jobStorage from '../storage/jobStorage.js';
import * as listingsStorage from '../storage/listingsStorage.js';
import * as settingsStorage from '../storage/settingsStorage.js';
import logger from '../logger.js';
import { readScoreConfig } from './config.js';
import { pricePerSqmBand } from './metrics/money.js';
import { walkMinutesToPlace } from './metrics/area.js';
import { resolveCommuteLabel } from './metrics/work.js';
import { compactScore, scoreListing } from './score.js';
import { buildSchoolsData } from './schoolsData.js';

/**
 * The only part of the score that touches the database or a cache.
 *
 * `score.js` and the metrics are pure; what they need to know about the world is gathered here, once
 * per batch of listings, with one query or one layer read per kind of data and never one per listing.
 * A page of the overview, the detail page and the MCP tools all come through {@link attachScores}.
 *
 * Nothing in the score is stored. Targets, weights, the job's percentiles and the finance profile all
 * move, so every read computes it afresh from what is current.
 */

/**
 * How long a read waits for a national layer (schools, supermarkets, job posts) that is not cached
 * yet. The first fetch of one can take a long while, and an overview page must not wait for it: past
 * the deadline the layer counts as unavailable for this request (its metrics score missing) while the
 * fetch carries on in the background and answers the next one from the cache.
 */
export const LAYER_DEADLINE_MS = 1500;

/**
 * @typedef {Object} ScoreDeps The data sources, replaceable so a test can count calls and feed fixtures.
 * @property {(ids: string[]) => Map<string, Object>} getJobsForScoring
 * @property {(ids: string[]) => Map<string, number[]>} getPricePerSqmByJob
 * @property {(userId: string) => Record<string, any>} getUserSettings
 * @property {() => Promise<{available: boolean, failed?: boolean, schools: Array<Object>}>} schoolLayer
 * @property {() => Promise<{stores: Array<{lat: number, lng: number}>}>} groceryLayer
 * @property {() => Promise<{failed?: boolean, fetchedAt: (number|null), choropleth: {features: Array<Object>}}>} jobsLayer
 * @property {(lat: number, lng: number) => ({code: string}|null)} kommuneOf
 * @property {number} [deadlineMs]
 */

/*
 * The storage modules are reached through their namespaces, at call time. A route test that replaces
 * one of them with a partial mock then finds the missing function inside `attachScores`, which
 * swallows it (the score is decoration), instead of failing at import time for every route that
 * happens to load this module.
 */
/** @type {ScoreDeps} */
const DEFAULT_DEPS = {
  getJobsForScoring: (ids) => jobStorage.getJobsForScoring(ids),
  getPricePerSqmByJob: (ids) => listingsStorage.getPricePerSqmByJob(ids),
  getUserSettings: (userId) => settingsStorage.getUserSettings(userId),
  schoolLayer: getSchoolLayer,
  groceryLayer: getGroceryLayer,
  jobsLayer: getJobsLayer,
  kommuneOf: kommuneOfPoint,
  deadlineMs: LAYER_DEADLINE_MS,
  dkkProviderIds: () => getProviderIdsForCurrency(DK_CURRENCY),
};

/**
 * Wait for a layer for at most `ms`, and treat a failure like a timeout: unavailable.
 *
 * @template T
 * @param {() => Promise<T>} load
 * @param {number} ms
 * @returns {Promise<T|null>}
 */
async function withDeadline(load, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(load)
        .catch((error) => {
          logger.error('Listing score: a regional data layer failed, its metrics score as unknown', error?.message);
          return null;
        }),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The derived school data, kept until the layer underneath changes: building it places every school in a kommune. */
let schoolsMemo = { signature: null, data: null };

/**
 * @param {Array<Object>} schools
 * @param {ScoreDeps} deps
 * @returns {import('./schoolsData.js').SchoolsData}
 */
function schoolsDataFor(schools, deps) {
  const signature = `${schools.length}:${schools[0]?.id}:${schools[schools.length - 1]?.id}`;
  if (schoolsMemo.signature !== signature || schoolsMemo.data == null) {
    schoolsMemo = { signature, data: buildSchoolsData(schools, deps.kommuneOf) };
  }
  return schoolsMemo.data;
}

/** The derived job counts, kept until the layer is fetched again. */
let jobsMemo = { fetchedAt: null, counts: null };

/**
 * @param {Awaited<ReturnType<ScoreDeps['jobsLayer']>>} layer
 * @returns {Map<string, number>}
 */
function jobCounts(layer) {
  if (jobsMemo.fetchedAt !== layer.fetchedAt || jobsMemo.counts == null) {
    const counts = new Map();
    for (const feature of layer.choropleth?.features ?? []) {
      const { code, count } = feature.properties ?? {};
      if (code != null && Number.isFinite(count)) counts.set(code, count);
    }
    jobsMemo = { fetchedAt: layer.fetchedAt, counts };
  }
  return jobsMemo.counts;
}

/** Forget what was derived from the national layers. For tests, and after the layers are cleared. */
export function resetScoreContextMemo() {
  schoolsMemo = { signature: null, data: null };
  jobsMemo = { fetchedAt: null, counts: null };
}

/**
 * @param {Object} listing
 * @returns {{lat: number, lng: number}|null}
 */
function pointOf(listing) {
  if (listing?.latitude == null || listing?.longitude == null) return null;
  const lat = Number(listing.latitude);
  const lng = Number(listing.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * @typedef {Object} ListingScoring What it takes to score one listing.
 * @property {import('./config.js').ScoreConfig|null} config The job's config.
 * @property {import('./metrics/types.js').ScoreContext} ctx
 * @property {Object} listing The row, with its deal type filled in from the job where the row lacks one.
 */

/**
 * Gather everything the metrics need for a batch of listings.
 *
 * Reads, at most once each regardless of the batch size: the jobs of the listings, the price per m²
 * of those jobs' active listings, the viewer's settings (finance profile and saved addresses), and
 * the school, supermarket and job-post layers. A layer is only asked for when some listing in the
 * batch lies in Denmark and could use it, so a German page never touches the Danish sources.
 *
 * @param {Object[]} listings Rows as the listings storage returns them, with `travelTimes` attached.
 * @param {Object} options
 * @param {string} options.userId The viewer: their finance profile and addresses apply, whoever owns the job.
 * @param {Partial<ScoreDeps>} [options.deps]
 * @param {number} [options.currentYear]
 * @returns {Promise<ListingScoring[]>} One entry per listing, in order.
 */
export async function buildScoreContexts(listings, { userId, deps: overrides = {}, currentYear } = {}) {
  const deps = { ...DEFAULT_DEPS, ...overrides };
  const rows = Array.isArray(listings) ? listings : [];
  if (rows.length === 0) return [];

  const jobIds = [...new Set(rows.map((row) => row.job_id).filter(Boolean))];
  const jobs = deps.getJobsForScoring(jobIds);
  const pricesByJob = deps.getPricePerSqmByJob(jobIds);
  const settings = deps.getUserSettings(userId) ?? {};
  const addresses = Array.isArray(settings.home_addresses) ? settings.home_addresses : [];
  const financeProfile = settings.finance_profile ?? null;
  // Providers that price in kroner, so a Danish purchase is judged by the Danish model.
  const dkkProviders = new Set((await deps.dkkProviderIds()) ?? []);

  // Where each listing is, once: it decides which national layers are worth reading at all.
  const kommuneCodes = rows.map((row) => {
    const point = pointOf(row);
    return point == null ? null : (deps.kommuneOf(point.lat, point.lng)?.code ?? null);
  });
  const inDenmark = kommuneCodes.some((code) => code != null);
  const needsSupermarket = rows.some(
    (row, i) => kommuneCodes[i] != null && walkMinutesToPlace(row, 'supermarket') == null,
  );

  const [schoolLayer, jobsLayer, groceryLayer] = await Promise.all([
    inDenmark ? withDeadline(deps.schoolLayer, deps.deadlineMs) : null,
    inDenmark ? withDeadline(deps.jobsLayer, deps.deadlineMs) : null,
    needsSupermarket ? withDeadline(deps.groceryLayer, deps.deadlineMs) : null,
  ]);
  const schools =
    schoolLayer?.available && !schoolLayer.failed && schoolLayer.schools.length > 0
      ? schoolsDataFor(schoolLayer.schools, deps)
      : null;
  const jobsByKommune = jobsLayer && !jobsLayer.failed ? jobCounts(jobsLayer) : null;
  const stores = groceryLayer?.stores ?? [];

  // The percentile band depends only on the job, so it is worked out once per job.
  const bands = new Map(jobIds.map((id) => [id, pricePerSqmBand(pricesByJob.get(id) ?? [])]));
  const year = currentYear ?? new Date().getFullYear();

  return rows.map((row, i) => {
    const job = jobs.get(row.job_id) ?? null;
    const config = readScoreConfig(job?.scoreConfig);
    const commuteLabel = resolveCommuteLabel(config, job?.commuteFilter);
    const code = kommuneCodes[i];
    const point = pointOf(row);

    let nearestSupermarketMeters = null;
    if (code != null && point != null && stores.length > 0 && walkMinutesToPlace(row, 'supermarket') == null) {
      nearestSupermarketMeters = Math.min(
        ...stores.map((store) => distanceMeters(point.lat, point.lng, store.lat, store.lng)),
      );
    }

    /** @type {import('./metrics/types.js').ScoreContext} */
    const ctx = {
      currentYear: year,
      financeProfile,
      danish: dkkProviders.has(row.provider),
      job: { maxPrice: job?.specFilter?.maxPrice ?? null, minSize: job?.specFilter?.minSize ?? null },
      pricePerSqm: bands.get(row.job_id) ?? null,
      commuteLabel,
      commuteMode: commuteLabel == null ? null : (addresses.find((a) => a?.label === commuteLabel)?.mode ?? null),
      kommuneCode: code,
      schools: code == null ? null : schools,
      kommuneJobs: code == null || jobsByKommune == null ? null : (jobsByKommune.get(code) ?? null),
      nearestSupermarketMeters,
    };
    return { config, ctx, listing: row.dealType ? row : { ...row, dealType: job?.dealType ?? row.dealType } };
  });
}

/**
 * Put a `score` on every listing of a batch.
 *
 * Fail-soft: a score that cannot be built must never take the page it decorates down with it, so an
 * error is logged and the rows come back with `score: null`.
 *
 * @param {Object[]} listings Rows with `travelTimes` attached (what `queryListings` and `getListingById` return).
 * @param {Object} options
 * @param {string} options.userId The viewer.
 * @param {boolean} [options.detail=true] Every metric of every group (the detail page, MCP) or only the
 *   total and the group scores (the overview rows, which would otherwise carry a few KB each).
 * @param {Partial<ScoreDeps>} [options.deps]
 * @returns {Promise<Object[]>} New row objects; the input is left alone.
 */
export async function attachScores(listings, { userId, detail = true, deps } = {}) {
  const rows = Array.isArray(listings) ? listings : [];
  try {
    const scorings = await buildScoreContexts(rows, { userId, deps });
    return rows.map((row, i) => {
      const { config, ctx, listing } = scorings[i];
      const score = scoreListing(listing, config, ctx);
      return { ...row, score: detail ? score : compactScore(score) };
    });
  } catch (error) {
    logger.error('Listing score could not be built', error);
    return rows.map((row) => ({ ...row, score: null }));
  }
}
