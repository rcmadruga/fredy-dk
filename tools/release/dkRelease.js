/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

/**
 * Release logic for Fredy DK, used by `.github/workflows/release-dk.yml`.
 *
 * A DK release is named `<upstream version>-dk.<n>`. The upstream version is read from package.json,
 * which a fork never edits, so syncing upstream stays clean; `n` counts up per upstream version and
 * starts again at 1 when a sync moves the upstream version on.
 *
 * Everything that decides something is a pure function exported here and unit-tested. The CLI at the
 * bottom is a thin wrapper the workflow calls:
 *
 *   node tools/release/dkRelease.js version   prints the next version (reads package.json + git tags)
 *   node tools/release/dkRelease.js news      prepends the PR's `## News` to news.dk.json
 *   node tools/release/dkRelease.js notes     prints the GitHub Release notes
 *
 * `news` and `notes` read the pull request from the JSON file named by `PR_JSON`
 * (`{title, body, url, number}`), and `news` also needs `VERSION`. Data travels through files and
 * environment variables, never through the command line, so a PR body cannot reach a shell.
 */

/** Where the DK release notes live, relative to the repository root. */
export const NEWS_DK_PATH = 'ui/src/assets/news/news.dk.json';

/**
 * Escape text for use in HTML element content and double-quoted attributes.
 *
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The next DK version for an upstream version.
 *
 * One more than the highest existing `<upstream>-dk.<n>` tag, or 1 when there is none. Tags of other
 * upstream versions (and upstream's own tags) are ignored, which is what restarts the counter after a
 * sync bumps the upstream version.
 *
 * @param {string} upstreamVersion The version from package.json, e.g. `29.2.1`.
 * @param {string[]} tags Every tag in the repository.
 * @returns {string} e.g. `29.2.1-dk.3`
 */
export function nextDkVersion(upstreamVersion, tags) {
  const upstream = String(upstreamVersion ?? '').trim();
  if (!upstream) {
    throw new Error('The upstream version is empty.');
  }
  const prefix = `${upstream}-dk.`;
  let highest = 0;
  for (const raw of tags ?? []) {
    const tag = String(raw).trim().replace(/^v/, '');
    if (!tag.startsWith(prefix)) {
      continue;
    }
    const counter = tag.slice(prefix.length);
    if (/^\d+$/.test(counter)) {
      highest = Math.max(highest, Number.parseInt(counter, 10));
    }
  }
  return `${prefix}${highest + 1}`;
}

/**
 * The text under the `## News` heading of a pull request body.
 *
 * Runs up to the next level-2 heading or the end. A `###` heading stays inside the section. HTML
 * comments (the hint in the PR template) are dropped, so an untouched template yields no news.
 *
 * @param {string|null|undefined} body
 * @returns {string|null} The trimmed section, or null when there is none or it is empty.
 */
export function extractNewsSection(body) {
  if (typeof body !== 'string' || body.length === 0) {
    return null;
  }
  const lines = body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^##[ \t]+news[ \t]*#*[ \t]*$/i.test(line));
  if (start === -1) {
    return null;
  }
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##[ \t]+\S/.test(line)) {
      break;
    }
    section.push(line);
  }
  const text = section.join('\n').trim();
  return text.length > 0 ? text : null;
}

/**
 * Convert the inline part of the Markdown subset: `**bold**`, `*italic*` and `[text](url)`.
 *
 * Everything is escaped first, so nothing a PR author types can become markup except those three.
 * Only http(s) and mailto links are turned into anchors; any other scheme (`javascript:`) stays
 * visible as plain text.
 *
 * @param {string} text
 * @returns {string} Inline HTML.
 */
export function inlineToHtml(text) {
  const anchors = [];
  // The placeholder uses a control character that is stripped from the input, so text can never
  // forge one.
  const escaped = escapeHtml(String(text ?? '').replace(/\uE000/g, ''));

  const emphasis = (value) =>
    value.replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<b>$1</b>').replace(/\*(?=[^\s*])([^*]+?)\*/g, '<i>$1</i>');

  const withAnchors = escaped.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/gi, (_match, label, url) => {
    anchors.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${emphasis(label)}</a>`);
    return `\uE000${anchors.length - 1}\uE000`;
  });

  return emphasis(withAnchors).replace(/\uE000(\d+)\uE000/g, (_match, index) => anchors[Number(index)]);
}

/**
 * Convert a small Markdown subset to the inline HTML news entries use.
 *
 * Paragraphs (separated by a blank line) are joined with `<br/><br/>`, a single line break inside a
 * paragraph becomes `<br/>`, `- ` lines become `<ul><li>`, and the inline rules of
 * {@link inlineToHtml} apply. A list sits directly against its neighbours, as in upstream's entries
 * ("Also in this release:<ul>...</ul>"). Anything else is escaped and shown literally.
 *
 * @param {string} markdown
 * @returns {string} Inline HTML.
 */
export function markdownToHtml(markdown) {
  const lines = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  /** @type {Array<{type: 'p'|'ul', lines: string[]}>} */
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (line.trim() === '') {
      current = null;
      continue;
    }
    const bullet = /^\s*-\s+(.*)$/.exec(line);
    const type = bullet ? 'ul' : 'p';
    if (!current || current.type !== type) {
      current = { type, lines: [] };
      blocks.push(current);
    }
    current.lines.push(bullet ? bullet[1] : line.trim());
  }

  let html = '';
  let previous = null;
  for (const block of blocks) {
    if (block.type === 'ul') {
      html += `<ul>${block.lines.map((item) => `<li>${inlineToHtml(item)}</li>`).join('')}</ul>`;
    } else {
      if (previous === 'p') {
        html += '<br/><br/>';
      }
      html += block.lines.map(inlineToHtml).join('<br/>');
    }
    previous = block.type;
  }
  return html;
}

/**
 * Build a news release from a pull request.
 *
 * @param {Object} input
 * @param {string} input.version The DK version being released.
 * @param {string} input.date ISO date (`YYYY-MM-DD`).
 * @param {string} input.title The PR title, used as the entry title.
 * @param {string} input.news The `## News` section of the PR body, as Markdown.
 * @returns {{version: string, date: string, entries: {title: string, text: string}[]}}
 */
export function buildRelease({ version, date, title, news }) {
  return {
    version,
    date,
    entries: [{ title: String(title ?? '').trim() || version, text: markdownToHtml(news) }],
  };
}

/**
 * Put a release at the top of a news config. An existing release with the same version is replaced
 * rather than duplicated, so re-running a half-finished release is harmless. The input is not
 * mutated.
 *
 * @param {{schemaVersion?: number, releases?: any[]}} config The parsed news.dk.json.
 * @param {{version: string}} release
 * @returns {{schemaVersion: number, releases: any[]}}
 */
export function prependRelease(config, release) {
  const others = (Array.isArray(config?.releases) ? config.releases : []).filter(
    (existing) => existing?.version !== release.version,
  );
  return { ...config, schemaVersion: config?.schemaVersion ?? 1, releases: [release, ...others] };
}

/**
 * Serialise a news config the way the file is stored: two-space indentation, trailing newline.
 *
 * @param {any} config
 * @returns {string}
 */
export function serializeNews(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * The Markdown body of the GitHub Release: the PR title and link, then the News section if any.
 *
 * @param {Object} input
 * @param {string} [input.title]
 * @param {string} [input.url]
 * @param {number|string|null} [input.number]
 * @param {string|null} [input.news]
 * @returns {string}
 */
export function buildReleaseNotes({ title, url, number, news }) {
  const heading = String(title ?? '').trim() || 'Manual release';
  let link = '';
  if (url) {
    link = number ? ` ([#${number}](${url}))` : ` (${url})`;
  }
  return `${heading}${link}${news ? `\n\n${news}` : ''}\n`;
}

/**
 * Today's date in UTC as `YYYY-MM-DD`.
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function isoDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Read the pull request the workflow saved to `PR_JSON`.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{title: string, body: string, url: string, number: number|null}}
 */
function readPullRequest(env) {
  const file = env.PR_JSON;
  if (!file) {
    throw new Error('PR_JSON is not set.');
  }
  const pr = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { title: pr.title ?? '', body: pr.body ?? '', url: pr.url ?? '', number: pr.number ?? null };
}

/**
 * The command line. Exported so it can be tested against a temporary directory.
 *
 * @param {string[]} argv Arguments after the script name.
 * @param {Object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.cwd] The repository root.
 * @param {(line: string) => void} [options.write] Where stdout goes.
 * @param {(args: string[]) => string} [options.git] Runs git and returns stdout.
 * @returns {void}
 */
export function main(argv, options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const write = options.write ?? ((text) => process.stdout.write(text));
  const git = options.git ?? ((args) => execFileSync('git', args, { cwd, encoding: 'utf8' }));
  const [command] = argv;

  if (command === 'version') {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    write(`${nextDkVersion(pkg.version, git(['tag', '--list']).split('\n'))}\n`);
    return;
  }

  if (command === 'news') {
    const version = env.VERSION;
    if (!version) {
      throw new Error('VERSION is not set.');
    }
    const pr = readPullRequest(env);
    const news = extractNewsSection(pr.body);
    if (!news) {
      write('none\n');
      return;
    }
    const file = path.join(cwd, NEWS_DK_PATH);
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    const release = buildRelease({ version, date: env.RELEASE_DATE || isoDate(), title: pr.title, news });
    fs.writeFileSync(file, serializeNews(prependRelease(config, release)));
    write('changed\n');
    return;
  }

  if (command === 'notes') {
    const pr = readPullRequest(env);
    write(buildReleaseNotes({ ...pr, news: extractNewsSection(pr.body) }));
    return;
  }

  throw new Error(`Unknown command "${command ?? ''}". Use version, news or notes.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
