/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COOLDOWN_MS,
  MAX_PER_RUN,
  MIN_INTERVAL_MS,
  chunkText,
  resetTranslationGate,
  translateDescriptions,
  translateToEnglish,
  translationPausedFor,
} from '../../../lib/services/translation/translateService.js';

const answer = (segments, lang) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve([segments.map((text) => [text, 'x', null, null, 1]), null, lang]),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetTranslationGate();
});

describe('translateToEnglish', () => {
  it('joins the translated segments and reports the detected language', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(['Bright flat. ', 'Near the station.'], 'da')));
    expect(await translateToEnglish('Lys lejlighed. Tæt på stationen.')).toEqual({
      text: 'Bright flat. Near the station.',
      lang: 'da',
    });
  });

  it('keeps nothing to show for a description that is already English', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(['Bright flat.'], 'en')));
    expect(await translateToEnglish('Bright flat.')).toEqual({ text: null, lang: 'en' });
  });

  it('answers null instead of throwing when the service fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await translateToEnglish('Lys lejlighed')).toBeNull();
    resetTranslationGate();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await translateToEnglish('Lys lejlighed')).toBeNull();
  });

  it('does not call out for an empty description', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await translateToEnglish('   ')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('chunkText', () => {
  it('leaves a short text whole and splits a long one without losing a character', () => {
    expect(chunkText('short')).toEqual(['short']);
    const long = Array.from({ length: 400 }, (_, i) => `Sentence number ${i}.`).join(' ');
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 3500)).toBe(true);
    expect(chunks.join('')).toBe(long);
  });
});

describe('the pace of the requests', () => {
  it('sends the first request at once and holds the next one back for the minimum gap', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(answer(['Hi'], 'da'));
    vi.stubGlobal('fetch', fetchMock);

    const first = translateToEnglish('Hej');
    const second = translateToEnglish('Farvel');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await Promise.all([first, second]);
  });

  it('gives callers that arrive together consecutive slots, so searches share one pace', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(answer(['Hi'], 'da'));
    vi.stubGlobal('fetch', fetchMock);

    const calls = [translateToEnglish('a'), translateToEnglish('b'), translateToEnglish('c')];
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await Promise.all(calls);
  });
});

describe('after the endpoint refuses', () => {
  it.each([429, 403])('leaves it alone for a while after an HTTP %s', async (status) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status });
    vi.stubGlobal('fetch', fetchMock);

    expect(await translateToEnglish('Lys lejlighed')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(translationPausedFor()).toBeGreaterThan(0);

    // Not one more request while the pause lasts.
    expect(await translateToEnglish('Lys lejlighed')).toBeNull();
    await vi.advanceTimersByTimeAsync(COOLDOWN_MS - 1000);
    expect(await translateToEnglish('Lys lejlighed')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // And asks again once it is over.
    await vi.advanceTimersByTimeAsync(1000);
    expect(translationPausedFor()).toBe(0);
    fetchMock.mockResolvedValue(answer(['Bright flat'], 'da'));
    expect(await translateToEnglish('Lys lejlighed')).toEqual({ text: 'Bright flat', lang: 'da' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not pause for an error that may pass by itself', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    expect(await translateToEnglish('Lys lejlighed')).toBeNull();
    expect(translationPausedFor()).toBe(0);
  });
});

describe('translateDescriptions', () => {
  const listing = (n) => ({ id: `l${n}`, description: `Beskrivelse ${n}` });

  it('translates in place and reports what it did', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(['Description'], 'da')));
    const listings = [listing(1), listing(2), { id: 'empty', description: '  ' }, { id: 'none' }];

    const run = translateDescriptions(listings);
    await vi.runAllTimersAsync();
    expect(await run).toEqual({ attempted: 2, skipped: 0 });
    expect(listings[0]).toMatchObject({ descriptionEn: 'Description', descriptionLang: 'da' });
    expect(listings[2].descriptionLang).toBeUndefined();
  });

  it('translates at most MAX_PER_RUN descriptions and leaves the rest for the listing page', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(answer(['Description'], 'da'));
    vi.stubGlobal('fetch', fetchMock);
    const listings = Array.from({ length: MAX_PER_RUN + 7 }, (_, i) => listing(i));

    const run = translateDescriptions(listings);
    await vi.runAllTimersAsync();
    expect(await run).toEqual({ attempted: MAX_PER_RUN, skipped: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(MAX_PER_RUN);
    expect(listings[MAX_PER_RUN - 1].descriptionLang).toBe('da');
    expect(listings[MAX_PER_RUN].descriptionLang).toBeUndefined();
  });

  it('stops asking after three failures in a row, and counts the rest as left for later', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);
    const listings = Array.from({ length: 6 }, (_, i) => listing(i));

    const run = translateDescriptions(listings);
    await vi.runAllTimersAsync();
    expect(await run).toEqual({ attempted: 3, skipped: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('copes with something that is not a list', async () => {
    expect(await translateDescriptions(null)).toEqual({ attempted: 0, skipped: 0 });
  });
});
