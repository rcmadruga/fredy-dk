/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/* eslint-disable no-console */

/**
 * Loads pages the way Fredy's own extractor does and reports what came back, to find out - before a
 * provider is written - whether a portal's bot wall lets Fredy's browser through, and where its data
 * actually comes from.
 *
 * It has to run where a browser works (the LXC's container), and `tools/` is not part of the image,
 * so it is fed to node on stdin from the checkout; the container's working directory is what lets
 * `cloakbrowser` resolve:
 *
 *   docker exec -i -w /fredy fredy-new node --input-type=module - <url> [<url>...] \
 *     < ~/fredy-dk/tools/deploy/browser-probe.mjs
 *
 * For each URL it prints the HTTP status, the page title once any challenge has had time to resolve,
 * a sample of the visible text, how many links the page has, and every JSON response the page fetched
 * (URL, size, first bytes) - the shortlist of endpoints a provider could call directly. The full HTML
 * and each JSON body are written to /tmp/probe-out inside the container, to `docker cp` out as
 * fixtures:
 *
 *   docker cp fredy-new:/tmp/probe-out ./probe-out
 *
 * Options (before the URLs): --wait=<seconds> to give a slow challenge longer (default 30),
 * --dry-run to check the arguments and that the browser library resolves, without opening a browser.
 */

import fs from 'fs';
import path from 'path';

const OUT_DIR = '/tmp/probe-out';
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const urls = args.filter((arg) => /^https?:\/\//.test(arg));
const dryRun = args.includes('--dry-run');
const waitSeconds = Number(option('wait', 30));

if (urls.length === 0) {
  console.error('Usage: node - [--wait=30] [--dry-run] <url> [<url>...]   (script on stdin)');
  process.exit(2);
}

const { launch } = await import('cloakbrowser/puppeteer');
if (dryRun) {
  console.log(`dry run ok: ${urls.length} url(s), wait ${waitSeconds}s, browser library resolved`);
  process.exit(0);
}

/** Titles Cloudflare and its kin show while a challenge is still being worked out. */
const CHALLENGE_TITLE = /just a moment|et øjeblik|attention required|access denied|verifying|checking your browser/i;

const slug = (url) =>
  new URL(url).hostname.replace(/^www\./, '') + '_' + Buffer.from(url).toString('base64url').slice(-8);

fs.mkdirSync(OUT_DIR, { recursive: true });

// The same launch settings the extractor uses (lib/services/extractor/puppeteerExtractor.js), so a
// pass here means a pass there.
const browser = await launch({
  headless: true,
  humanize: true,
  locale: 'da-DK',
  timezone: 'Europe/Copenhagen',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--ignore-certificate-errors',
    '--no-zygote',
    '--window-size=1366,900',
  ],
});

let exitCode = 0;
try {
  for (const url of urls) {
    const started = Date.now();
    const page = await browser.newPage();
    const base = slug(url);
    let mainStatus = null;
    const jsonResponses = [];
    const pending = [];

    page.on('response', (response) => {
      if (response.url() === url) mainStatus = response.status();
      const type = response.headers()['content-type'] ?? '';
      if (!/json/i.test(type)) return;
      pending.push(
        response
          .text()
          .then((body) => {
            jsonResponses.push({ url: response.url(), status: response.status(), bytes: body.length, body });
          })
          .catch(() => {}),
      );
    });

    console.log(`\n=== ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (error) {
      console.log(`navigation: ${error.message}`);
    }

    // A challenge resolves on its own if the browser passes; poll until the title stops being one.
    let title = '';
    const deadline = Date.now() + waitSeconds * 1000;
    do {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      title = await page.title().catch(() => '');
    } while (CHALLENGE_TITLE.test(title) && Date.now() < deadline);
    // Then let the page's own data requests finish.
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await Promise.all(pending);

    const page_ = await page
      .evaluate(() => ({
        text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim(),
        links: [...document.querySelectorAll('a[href]')].map((a) => a.href),
        html: document.documentElement.outerHTML,
      }))
      .catch(() => ({ text: '', links: [], html: '' }));

    const cleared = !CHALLENGE_TITLE.test(title) && page_.text.length > 200;
    if (!cleared) exitCode = 1;

    fs.writeFileSync(path.join(OUT_DIR, `${base}.html`), page_.html);
    console.log(`status:      ${mainStatus ?? 'unknown'}`);
    console.log(`title:       ${title || '(none)'}`);
    console.log(`verdict:     ${cleared ? 'PASSED - the page loaded' : 'BLOCKED - still a challenge or an empty page'}`);
    console.log(`time:        ${Math.round((Date.now() - started) / 1000)}s`);
    console.log(`text:        ${page_.text.length} chars - ${page_.text.slice(0, 240)}`);
    console.log(`links:       ${page_.links.length} (${new Set(page_.links.map((l) => new URL(l).hostname)).size} hosts)`);
    console.log(`html saved:  ${path.join(OUT_DIR, `${base}.html`)} (${page_.html.length} bytes)`);

    console.log(`json calls:  ${jsonResponses.length}`);
    jsonResponses.forEach((entry, index) => {
      const file = path.join(OUT_DIR, `${base}.${index}.json`);
      fs.writeFileSync(file, entry.body);
      console.log(`  [${index}] ${entry.status} ${entry.bytes}B ${entry.url.slice(0, 150)}`);
      console.log(`       ${entry.body.replace(/\s+/g, ' ').slice(0, 140)}`);
    });
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
