/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import logger from '../logger.js';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const TIMEOUT_MS = 8000;
// Well under what the endpoint accepts in one request, and split on paragraph or sentence breaks so
// a chunk never ends mid-word.
const MAX_CHUNK_CHARS = 3500;

/**
 * The smallest gap between two requests to the endpoint, whoever makes them. A search run used to
 * translate every new description back to back, which for the first run of a search is a hundred
 * requests in a few seconds from one address: exactly what the endpoint answers with a block.
 */
export const MIN_INTERVAL_MS = 1500;

/**
 * How long to leave the endpoint alone once it has refused us (HTTP 429 or 403). Every request made
 * while it is refusing is one more reason for it to carry on, and a search run would otherwise try
 * again every few minutes for as long as the block lasts.
 */
export const COOLDOWN_MS = 30 * 60 * 1000;

/**
 * How many new descriptions one search run translates. The rest stay untranslated and are offered
 * on the listing page, which asks for one description at a time.
 */
export const MAX_PER_RUN = 20;

/** Failures in a row after which a run stops asking: the endpoint is down, not busy. */
const MAX_FAILURES_IN_A_ROW = 3;

/** When the next request may go out, and until when the endpoint is not to be asked at all. */
let nextSlotAt = 0;
let refusedUntil = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for this request's turn. Callers that arrive together get consecutive slots, so concurrent
 * searches share one pace instead of each keeping its own.
 *
 * @returns {Promise<void>}
 */
async function takeSlot() {
  const now = Date.now();
  const at = Math.max(now, nextSlotAt);
  nextSlotAt = at + MIN_INTERVAL_MS;
  if (at > now) await sleep(at - now);
}

/**
 * How much longer the endpoint is being left alone after a refusal.
 *
 * @param {number} [now=Date.now()]
 * @returns {number} Milliseconds, 0 when translations may be asked for.
 */
export function translationPausedFor(now = Date.now()) {
  return Math.max(0, refusedUntil - now);
}

/** Forget the pace and any pause. For tests; nothing in the app needs it. */
export function resetTranslationGate() {
  nextSlotAt = 0;
  refusedUntil = 0;
}

/**
 * Split a text into pieces the endpoint takes in one request, keeping paragraph breaks.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function chunkText(text) {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const chunks = [];
  let current = '';
  // Lines first, then sentences inside a line that is too long by itself.
  const pieces = text
    .split(/(\n)/)
    .flatMap((line) => (line.length > MAX_CHUNK_CHARS ? (line.match(/[^.!?]+[.!?]*\s*/g) ?? [line]) : [line]));
  for (const piece of pieces) {
    if (current.length + piece.length > MAX_CHUNK_CHARS && current.length > 0) {
      chunks.push(current);
      current = '';
    }
    // A single sentence longer than the limit is cut hard; it is the only case that can split a word.
    for (let start = 0; start < piece.length; start += MAX_CHUNK_CHARS) {
      const part = piece.slice(start, start + MAX_CHUNK_CHARS);
      if (current.length + part.length > MAX_CHUNK_CHARS && current.length > 0) {
        chunks.push(current);
        current = '';
      }
      current += part;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Translate one chunk. POST rather than GET, since a listing description does not fit in a URL.
 *
 * @param {string} chunk
 * @returns {Promise<{text: string, lang: string|null}>}
 */
async function translateChunk(chunk) {
  await takeSlot();
  const response = await fetch(`${ENDPOINT}?client=gtx&sl=auto&tl=en&dt=t`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ q: chunk }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    if (response.status === 429 || response.status === 403) {
      if (translationPausedFor() === 0) {
        logger.warn(
          `The translation service refused the request (HTTP ${response.status}); leaving it alone for ${COOLDOWN_MS / 60000} minutes.`,
        );
      }
      refusedUntil = Date.now() + COOLDOWN_MS;
    }
    throw new Error(`translate endpoint answered ${response.status}`);
  }
  const body = await response.json();
  if (!Array.isArray(body) || !Array.isArray(body[0])) {
    throw new Error('translate endpoint answered in an unknown shape');
  }
  const text = body[0].map((segment) => (Array.isArray(segment) ? (segment[0] ?? '') : '')).join('');
  return { text, lang: typeof body[2] === 'string' ? body[2] : null };
}

/**
 * Translate a listing description into English.
 *
 * Best effort by design: a translation is a nicety next to the listing itself, so every failure -
 * a timeout, a rate limit, a changed response - comes back as `null` and never as an exception,
 * and nothing that calls this may depend on it succeeding. The endpoint is Google's unofficial
 * `translate_a` one, which needs no key and can start refusing without notice.
 *
 * @param {string|null|undefined} text
 * @returns {Promise<{text: string|null, lang: string}|null>} `text` is null when the description is
 *   already English (nothing to show); the whole result is null when no translation was possible.
 */
export async function translateToEnglish(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return null;
  // Asking again while it is refusing only prolongs the block; the listing page shows why.
  if (translationPausedFor() > 0) return null;

  try {
    const results = [];
    for (const chunk of chunkText(text)) {
      results.push(await translateChunk(chunk));
    }
    const lang = results.find((result) => result.lang)?.lang;
    if (!lang) return null;
    if (lang === 'en') return { text: null, lang };
    return { text: results.map((result) => result.text).join(''), lang };
  } catch (error) {
    logger.warn('Could not translate a listing description.', error?.message || error);
    return null;
  }
}

/**
 * Translate the descriptions of a run's new listings, in place.
 *
 * At most {@link MAX_PER_RUN} of them, in the order given; the rest are left alone for the listing
 * page to translate on demand. A run also stops asking after three failures in a row, since a
 * refusing endpoint would otherwise cost a timeout per listing. Every request goes through the
 * shared pace, so a run of twenty takes about half a minute rather than a burst.
 *
 * @param {Array<{description?: string|null, descriptionEn?: string|null, descriptionLang?: string|null}>} listings
 * @returns {Promise<{attempted: number, skipped: number}>} How many descriptions were asked for, and
 *   how many were left for later.
 */
export async function translateDescriptions(listings) {
  let attempted = 0;
  let skipped = 0;
  let failures = 0;
  for (const listing of Array.isArray(listings) ? listings : []) {
    if (typeof listing?.description !== 'string' || listing.description.trim().length === 0) continue;
    if (attempted >= MAX_PER_RUN || failures >= MAX_FAILURES_IN_A_ROW) {
      skipped++;
      continue;
    }
    attempted++;
    const translation = await translateToEnglish(listing.description);
    if (translation == null) {
      failures++;
      continue;
    }
    failures = 0;
    listing.descriptionEn = translation.text;
    listing.descriptionLang = translation.lang;
  }
  return { attempted, skipped };
}
