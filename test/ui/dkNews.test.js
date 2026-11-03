/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

import { dkReleaseNotes } from '../../ui/src/services/news/dkNews.js';
import newsDkConfig from '../../ui/src/assets/news/news.dk.json';

const config = {
  releases: [
    {
      version: '29.2.1-dk.1',
      date: '2026-10-10',
      entries: [{ title: 'First', text: 'One <b>thing</b>' }],
    },
    {
      version: '29.2.1-dk.2',
      date: '2026-10-20',
      entries: [
        { title: 'Tom & <Jerry>', text: 'Two' },
        { title: 'Plain', text: '' },
      ],
    },
  ],
};

describe('dkReleaseNotes', () => {
  it('returns the releases newest first, in the shape the release dialog reads', () => {
    const notes = dkReleaseNotes(config);
    expect(notes.map((note) => note.version)).toEqual(['29.2.1-dk.2', '29.2.1-dk.1']);
    expect(notes[0]).toMatchObject({ date: '2026-10-20' });
    expect(typeof notes[0].bodyHtml).toBe('string');
  });

  it('makes a heading of each entry title, escaped, and keeps the entry text as the HTML it already is', () => {
    const [newest, oldest] = dkReleaseNotes(config);
    expect(newest.bodyHtml).toBe('<h3>Tom &amp; &lt;Jerry&gt;</h3><p>Two</p><h3>Plain</h3>');
    expect(oldest.bodyHtml).toBe('<h3>First</h3><p>One <b>thing</b></p>');
  });

  it('lists one contents entry per release entry', () => {
    const [newest] = dkReleaseNotes(config);
    expect(newest.outline).toEqual([
      { title: 'Tom & <Jerry>', items: 0 },
      { title: 'Plain', items: 0 },
    ]);
  });

  it('copes with an empty or missing file', () => {
    expect(dkReleaseNotes({ releases: [] })).toEqual([]);
    expect(dkReleaseNotes(null)).toEqual([]);
  });

  it('reads the shipped file', () => {
    expect(dkReleaseNotes(newsDkConfig).length).toBe(newsDkConfig.releases.length);
  });
});

describe('the DK news wiring', () => {
  const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

  it("mounts the DK dialog beside upstream's, outside demo mode", () => {
    expect(read('ui/src/App.jsx')).toMatch(/\{!settings\.demoMode && <NewsDkModal \/>\}/);
  });

  it("keeps its own marker, never upstream's", () => {
    const modal = read('ui/src/components/news/NewsDkModal.jsx');
    expect(modal).toMatch(/news_dk_last_seen_version/);
    expect(modal).toMatch(/setNewsDkLastSeenVersion/);
    expect(modal).not.toMatch(/setNewsLastSeenVersion/);
  });

  it("waits for upstream's dialog instead of stacking on it", () => {
    expect(read('ui/src/components/news/NewsDkModal.jsx')).toMatch(/!upstreamPending/);
  });

  it('shows the DK release in the footer', () => {
    expect(read('ui/src/components/footer/FredyFooter.jsx')).toMatch(
      /footerVersion\(versionUpdate\?\.localFredyVersion, newsDkConfig\)/,
    );
  });
});
