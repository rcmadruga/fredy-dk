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
  const response = await fetch(`${ENDPOINT}?client=gtx&sl=auto&tl=en&dt=t`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ q: chunk }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
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
