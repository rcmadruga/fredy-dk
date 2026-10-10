/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  NEWS_DK_PATH,
  buildRelease,
  buildReleaseNotes,
  escapeHtml,
  extractNewsSection,
  inlineToHtml,
  isoDate,
  main,
  markdownToHtml,
  nextDkVersion,
  prependRelease,
  serializeNews,
} from '../../tools/release/dkRelease.js';
import { compareDkVersions } from '../../ui/src/services/news/newsSelection.js';

describe('nextDkVersion', () => {
  it('starts at 1 when the upstream version has no DK tag yet', () => {
    expect(nextDkVersion('29.2.1', [])).toBe('29.2.1-dk.1');
    expect(nextDkVersion('29.2.1', ['29.2.1', '29.2.0-dk.4'])).toBe('29.2.1-dk.1');
  });

  it('is one more than the highest existing counter, not the number of tags', () => {
    expect(nextDkVersion('29.2.1', ['29.2.1-dk.1', '29.2.1-dk.2'])).toBe('29.2.1-dk.3');
    expect(nextDkVersion('29.2.1', ['29.2.1-dk.2', '29.2.1-dk.9', '29.2.1-dk.10'])).toBe('29.2.1-dk.11');
  });

  it('restarts at 1 when a sync bumps the upstream version', () => {
    const tags = ['29.2.1-dk.1', '29.2.1-dk.2', '29.2.1-dk.3'];
    expect(nextDkVersion('29.3.0', tags)).toBe('29.3.0-dk.1');
  });

  it('does not mistake a longer upstream version for a prefix match', () => {
    expect(nextDkVersion('29.2.1', ['29.2.10-dk.5', '29.2.1-dk.1'])).toBe('29.2.1-dk.2');
  });

  it('ignores malformed counters, blank lines and a v prefix', () => {
    expect(nextDkVersion('29.2.1', ['', '29.2.1-dk.x', '29.2.1-dk.', 'v29.2.1-dk.4', '29.2.1-dk.2-rc'])).toBe(
      '29.2.1-dk.5',
    );
  });

  it('refuses an empty upstream version', () => {
    expect(() => nextDkVersion('', [])).toThrow();
  });

  it('produces versions the UI orders correctly', () => {
    expect(compareDkVersions(nextDkVersion('29.2.1', ['29.2.1-dk.1']), '29.2.1-dk.1')).toBeGreaterThan(0);
    expect(compareDkVersions(nextDkVersion('29.3.0', ['29.2.1-dk.5']), '29.2.1-dk.5')).toBeGreaterThan(0);
  });
});

describe('extractNewsSection', () => {
  it('takes the section up to the next level-2 heading', () => {
    const body = '## What\n\nstuff\n\n## News\n\nA line.\n\n- one\n- two\n\n## Checklist\n\n- [ ] done';
    expect(extractNewsSection(body)).toBe('A line.\n\n- one\n- two');
  });

  it('takes the section to the end of the body', () => {
    expect(extractNewsSection('## News\nLast thing.\n')).toBe('Last thing.');
  });

  it('finds the heading regardless of case and with CRLF line endings', () => {
    expect(extractNewsSection('## what\r\n\r\n## NEWS\r\n\r\nHello\r\nworld\r\n\r\n## x')).toBe('Hello\nworld');
  });

  it('keeps level-3 headings inside the section', () => {
    expect(extractNewsSection('## News\n\n### Sub\n\ntext\n\n## End')).toBe('### Sub\n\ntext');
  });

  it('returns null when there is no section, or it is empty', () => {
    expect(extractNewsSection('## What does this PR do?\n\nx')).toBeNull();
    expect(extractNewsSection('## News\n\n\n## Next')).toBeNull();
    expect(extractNewsSection('## News')).toBeNull();
    expect(extractNewsSection('')).toBeNull();
    expect(extractNewsSection(null)).toBeNull();
    expect(extractNewsSection(undefined)).toBeNull();
  });

  it('treats the untouched template comment as no news', () => {
    expect(
      extractNewsSection('## News\n\n<!-- One line for the What is new dialog. -->\n\n## Related issue'),
    ).toBeNull();
  });

  it('does not match a heading that merely starts with News', () => {
    expect(extractNewsSection('## Newsletter\n\ntext')).toBeNull();
  });

  it('takes only the first News section', () => {
    expect(extractNewsSection('## News\n\nfirst\n\n## News\n\nsecond')).toBe('first');
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
});

describe('inlineToHtml', () => {
  it('converts bold, italic and links', () => {
    expect(inlineToHtml('a **b** and *c* and [d](https://example.com/x?y=1&z=2)')).toBe(
      'a <b>b</b> and <i>c</i> and <a href="https://example.com/x?y=1&amp;z=2" target="_blank" rel="noopener noreferrer">d</a>',
    );
  });

  it('allows emphasis inside link text but never inside the url', () => {
    const html = inlineToHtml('[**big**](https://example.com/*a*/*b*)');
    expect(html).toContain('>' + '<b>big</b>' + '</a>');
    expect(html).toContain('href="https://example.com/*a*/*b*"');
  });

  it('does not treat spaced asterisks as emphasis', () => {
    expect(inlineToHtml('2 * 3 * 4')).toBe('2 * 3 * 4');
  });

  it('keeps raw HTML from reaching the output', () => {
    const html = inlineToHtml('<script>alert(1)</script> <img src=x onerror=alert(1)> **<b>x</b>**');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<b>&lt;b&gt;x&lt;/b&gt;</b>');
  });

  it('leaves links with other schemes as visible text', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'JAVASCRIPT:alert(1)']) {
      const html = inlineToHtml(`[click](${url})`);
      expect(html).not.toContain('<a ');
      expect(html).toContain('[click]');
    }
  });

  it('cannot break out of the href attribute', () => {
    const html = inlineToHtml('[x](https://e.com/"onmouseover="alert(1))');
    expect(html).not.toMatch(/href="[^"]*"[^>]*onmouseover/);
    expect(html).not.toContain('"onmouseover');
  });

  it('cannot forge an anchor placeholder', () => {
    expect(inlineToHtml('0 [a](https://e.com)')).not.toContain('undefined');
  });
});

describe('markdownToHtml', () => {
  it('joins paragraphs with <br/><br/>', () => {
    expect(markdownToHtml('One.\n\nTwo.\n\n\n\nThree.')).toBe('One.<br/><br/>Two.<br/><br/>Three.');
  });

  it('turns a single line break into <br/>', () => {
    expect(markdownToHtml('One\nTwo')).toBe('One<br/>Two');
  });

  it('renders bullets as a list that sits against the paragraph before it', () => {
    expect(markdownToHtml('Also in this release:\n\n- **A** thing\n- Another\n\nAfter.')).toBe(
      'Also in this release:<ul><li><b>A</b> thing</li><li>Another</li></ul>After.',
    );
  });

  it('handles a bullet list with no intro and CRLF input', () => {
    expect(markdownToHtml('- a\r\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('escapes list items too', () => {
    expect(markdownToHtml('- <script>x</script>')).toBe('<ul><li>&lt;script&gt;x&lt;/script&gt;</li></ul>');
  });

  it('returns an empty string for nothing', () => {
    expect(markdownToHtml('')).toBe('');
    expect(markdownToHtml(undefined)).toBe('');
  });
});

describe('building and prepending a release', () => {
  const existing = {
    schemaVersion: 1,
    releases: [{ version: '29.2.1-dk.1', date: '2026-10-10', entries: [{ title: 'First', text: 'x' }] }],
  };

  it('builds an entry titled with the PR title', () => {
    const release = buildRelease({
      version: '29.2.1-dk.2',
      date: '2026-10-11',
      title: ' Add a thing ',
      news: 'Hi **you**',
    });
    expect(release).toEqual({
      version: '29.2.1-dk.2',
      date: '2026-10-11',
      entries: [{ title: 'Add a thing', text: 'Hi <b>you</b>' }],
    });
  });

  it('falls back to the version when the title is blank', () => {
    expect(buildRelease({ version: '1.0.0-dk.1', date: 'd', title: '  ', news: 'x' }).entries[0].title).toBe(
      '1.0.0-dk.1',
    );
  });

  it('puts the new release first and leaves the input alone', () => {
    const release = buildRelease({ version: '29.2.1-dk.2', date: '2026-10-11', title: 'T', news: 'n' });
    const next = prependRelease(existing, release);
    expect(next.releases.map((r) => r.version)).toEqual(['29.2.1-dk.2', '29.2.1-dk.1']);
    expect(existing.releases).toHaveLength(1);
  });

  it('merges into a release of the same version, keeping what it already says', () => {
    const release = buildRelease({ version: '29.2.1-dk.1', date: '2026-10-12', title: 'Again', news: 'n' });
    const next = prependRelease(existing, release);
    expect(next.releases).toHaveLength(1);
    expect(next.releases[0].date).toBe('2026-10-10');
    expect(next.releases[0].entries.map((entry) => entry.title)).toEqual(['Again', 'First']);
  });

  it('does not add the same entry twice when a release is repeated', () => {
    const release = buildRelease({ version: '29.2.1-dk.2', date: '2026-10-12', title: 'Again', news: 'n' });
    const once = prependRelease(existing, release);
    const twice = prependRelease(once, release);
    expect(twice).toEqual(once);
  });

  it('copes with an empty or missing config', () => {
    const release = buildRelease({ version: '1.0.0-dk.1', date: 'd', title: 'T', news: 'n' });
    expect(prependRelease({}, release)).toEqual({ schemaVersion: 1, releases: [release] });
    expect(prependRelease(undefined, release).releases).toEqual([release]);
  });

  it('serialises with two spaces and a trailing newline', () => {
    expect(serializeNews({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}\n');
  });

  it('round-trips the shipped file byte for byte, so a release commit changes only what it adds', () => {
    const raw = fs.readFileSync(NEWS_DK_PATH, 'utf8');
    expect(serializeNews(JSON.parse(raw))).toBe(raw);
  });
});

describe('buildReleaseNotes', () => {
  it('has the title, the link and the News section', () => {
    expect(
      buildReleaseNotes({ title: 'Add x', url: 'https://github.com/o/r/pull/7', number: 7, news: 'Big **news**' }),
    ).toBe('Add x ([#7](https://github.com/o/r/pull/7))\n\nBig **news**\n');
  });

  it('is just the title and link without news', () => {
    expect(buildReleaseNotes({ title: 'Fix y', url: 'https://u', number: 3 })).toBe('Fix y ([#3](https://u))\n');
  });

  it('copes with a manual release that has no PR', () => {
    expect(buildReleaseNotes({})).toBe('Manual release\n');
    expect(buildReleaseNotes({ title: 'T', url: 'https://u' })).toBe('T (https://u)\n');
  });
});

describe('isoDate', () => {
  it('is the UTC date', () => {
    expect(isoDate(new Date('2026-10-10T23:30:00Z'))).toBe('2026-10-10');
  });
});

describe('the command line', () => {
  let dir;
  let out;
  const write = (text) => out.push(text);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-release-'));
    out = [];
    fs.mkdirSync(path.join(dir, path.dirname(NEWS_DK_PATH)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '29.2.1' }));
    fs.writeFileSync(
      path.join(dir, NEWS_DK_PATH),
      serializeNews({
        schemaVersion: 1,
        releases: [{ version: '29.2.1-dk.1', date: 'd', entries: [{ title: 'a', text: 'b' }] }],
      }),
    );
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const prFile = (pr) => {
    const file = path.join(dir, 'pr.json');
    fs.writeFileSync(file, JSON.stringify(pr));
    return file;
  };

  it('version: reads package.json and the tags', () => {
    main(['version'], { cwd: dir, write, git: () => '29.2.1\n29.2.1-dk.1\n29.2.1-dk.2\n' });
    expect(out.join('')).toBe('29.2.1-dk.3\n');
  });

  it('news: prepends the PR and reports it', () => {
    const PR_JSON = prFile({ title: 'Add Foo', body: '## News\n\nFoo is **here**.', url: 'https://u', number: 4 });
    main(['news'], { cwd: dir, write, env: { PR_JSON, VERSION: '29.2.1-dk.2', RELEASE_DATE: '2026-11-01' } });
    expect(out.join('')).toBe('changed\n');
    const config = JSON.parse(fs.readFileSync(path.join(dir, NEWS_DK_PATH), 'utf8'));
    expect(config.releases[0]).toEqual({
      version: '29.2.1-dk.2',
      date: '2026-11-01',
      entries: [{ title: 'Add Foo', text: 'Foo is <b>here</b>.' }],
    });
    expect(config.releases).toHaveLength(2);
  });

  it('news: leaves the file alone when the PR has no News section', () => {
    const before = fs.readFileSync(path.join(dir, NEWS_DK_PATH), 'utf8');
    const PR_JSON = prFile({ title: 'Fix', body: '## What\n\nx', url: 'u', number: 1 });
    main(['news'], { cwd: dir, write, env: { PR_JSON, VERSION: '29.2.1-dk.2' } });
    expect(out.join('')).toBe('none\n');
    expect(fs.readFileSync(path.join(dir, NEWS_DK_PATH), 'utf8')).toBe(before);
  });

  it('news: needs a version and a PR file', () => {
    expect(() => main(['news'], { cwd: dir, write, env: {} })).toThrow(/VERSION/);
    expect(() => main(['news'], { cwd: dir, write, env: { VERSION: 'x' } })).toThrow(/PR_JSON/);
  });

  it('notes: prints the title, link and News section', () => {
    const PR_JSON = prFile({ title: 'Add Foo', body: '## News\n\nFoo.', url: 'https://u', number: 4 });
    main(['notes'], { cwd: dir, write, env: { PR_JSON } });
    expect(out.join('')).toBe('Add Foo ([#4](https://u))\n\nFoo.\n');
  });

  it('refuses an unknown command', () => {
    expect(() => main(['nope'], { cwd: dir, write })).toThrow(/Unknown command/);
  });
});
