/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { chunkText, translateToEnglish } from '../../../lib/services/translation/translateService.js';

const answer = (segments, lang) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve([segments.map((text) => [text, 'x', null, null, 1]), null, lang]),
});

afterEach(() => vi.unstubAllGlobals());

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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    expect(await translateToEnglish('Lys lejlighed')).toBeNull();
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
