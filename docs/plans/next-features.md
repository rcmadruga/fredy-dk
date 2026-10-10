# Next features: Danish UI, price-drop radar, weekly digest

Agreed with the user on 2026-10-10. These are plans only; nothing is built yet. Each feature gets its
own branch and PR, with one commit per step, and tests and JSDoc as AGENTS.md requires. The three are
independent and can run in parallel. Migration numbers are settled at merge time: master has 53, and
`feat/listing-score` (#15) adds 52.

---

## 1 Danish UI language

**Decision:** AI translation, labelled as AI-made, the way upstream labels its French, Spanish and
Italian ("AI-generated translation, corrections welcome").

**What exists:** six locales under `ui/src/locales/` (de, en, es, fr, it, tr). en and de are complete
(about 1,870 keys); the others trail by 23 to 62 keys, and `test/ui/locales.test.js` encodes which
gaps are allowed.

**Steps**
1. Find how a language is registered: the language picker, `i18n` setup, the `language` user setting,
   the server-side notification language (`ROOMS_LABEL`, `PRICE_CHANGE_LABEL` in
   `lib/utils/formatListing.js`, the scam-detection patterns), and anything else keyed by a language
   code. Write the list down in this file before translating.
2. `ui/src/locales/da.json`: every key of `en.json`, translated from English with the German as a
   cross-check. Keep placeholders (`{{count}}`), HTML and brand names unchanged. Danish real-estate
   terms stay Danish (ejerudgift, udbetaling, andelsbolig, kommune, BBR, tinglysning), because that is
   what users read on the portals.
3. Register `da` everywhere step 1 found, including the server-side labels for notifications.
4. Make the parity test accept `da` as a complete locale (no allowed gaps).
5. An "AI-generated translation" note wherever upstream shows one for fr, es and it.
6. A Danish note in the DK news for the next release.

**Risk:** about 1,870 strings is a long single generation. Split it by key prefix, and validate the
result for parity and placeholders with the existing test plus a placeholder check.

---

## 2 Price-drop radar

**Decisions:** alert on all four (watched listings, listings above a score threshold, a listing back
on the market, and a minimum drop percentage).

**What exists:** upstream already re-reads prices when the admin turns it on
(`lib/services/listings/priceTrackingService.js`, `price-tracking-cron.js`). It records changes above
a global threshold percentage (`getThresholdPercent`) and notifies each job's channels for EVERY
recorded change (`notifyPriceChanges` in `priceHistoryService.js`). It only probes active listings
(`is_active IS NULL OR is_active = 1`). The watch list lives in `watch_list`.

**Bug found while planning (fix first):** `notifyPriceChanges` calls
`formatPriceChange(change, language)` without the currency. Since the upstream merge,
`formatPriceChange` takes the provider's currency, so price-change notifications for Danish listings
print `€`. Pass the provider's currency, as the pipeline already does for new listings
(`FredyPipelineExecutioner.js`, `formatListing(listing, language, currency)`).

**Steps**
1. Fix the currency bug above, with a test.
2. Per-job radar settings: a nullable JSON column `radar_config` on `jobs`, holding
   `{ watched: bool, minScore: number|null, backOnMarket: bool, minDropPct: number }`. NULL means
   today's behaviour (notify on every recorded change), so nothing changes for existing jobs.
3. A filter in `notifyPriceChanges`: with a radar config, keep a change only when
   - it is a drop of at least `minDropPct` (rises are never radar events), and
   - the listing is watched (`watch_list`, by the job's owner), or
   - its score is at least `minScore`. This needs the score from #15 and is skipped until that merges.
4. **Back on the market:** two sources.
   - A listing the alive-checker had marked inactive becomes active again. Find where `is_active` flips
     back to 1, if it does; if nothing ever reactivates, the alive-checker needs a "seen again" path.
   - A "new" listing whose fingerprint matches an older, inactive listing of the same job (the
     similarity cache's fingerprint tier already matches across providers). Notify as "back on the
     market" with the old and new price instead of as a new listing.
5. Notification wording: a radar line ("Price drop −4.8 %, now 2.450.000 kr.", "Back on the market
   after 63 days"), in every adapter that renders price changes, in all locales.
6. Job form: a "Radar" card with the four settings.
7. MCP: `get_listing` shows radar events in the price history.

**Note:** price checks are an admin opt-in (the Execution page). The radar card says so when the
admin has it off.

---

## 3 Weekly digest

**Decision:** configurable per job: day, time and channel. Instant pings can be turned off per job.

**What exists:** each job sends every new listing at once through its channels
(`notify.send` in `_notify` of `FredyPipelineExecutioner.js`). There is no digest and no per-job
schedule. Crons live in `lib/services/crons/`.

**Steps**
1. Per-job digest settings: a nullable JSON column `digest_config` on `jobs`, holding
   `{ enabled, weekday 0-6, hour 0-23, channelIds: string[], instant: bool }`. `instant: false`
   suppresses the per-listing notifications for that job. NULL means no digest, instant on, as today.
2. `digest-cron.js`: runs hourly, finds the jobs whose (weekday, hour) has come in the server's
   timezone, and has not sent this week (`digest_last_sent_at` beside the config, so a restart
   neither skips nor doubles a digest).
3. Content, built from the last 7 days of the job:
   - new listings, the top 10 by score (newest first until #15 merges), with photo, price,
     size and rooms, and the commute;
   - price drops and back-on-market events (shares the radar's queries);
   - listings that went inactive (gone, so you can stop thinking about them);
   - counts: new, still active, average price per m² against last week.
4. Rendering per channel: email gets a full HTML template; Telegram, Slack, Discord and ntfy get a compact
   text with links. Add a `sendDigest` to the adapters that can carry it; others fall back to a text
   summary through `send`.
5. Job form: a "Weekly digest" card (on/off, weekday, hour, channels, the "instant notifications" toggle).
6. "Send a digest now" button on the job, for testing.
7. i18n in all locales (including `da` if feature 1 has landed).

---

## Later (agreed, not planned in detail yet)

- **Buy vs rent, per listing:** a purchase's monthly cost (Danish or German model) against what a
  comparable rental costs, from the rentals the user's jobs have seen nearby; the year buying breaks
  even.
- **Climate and noise risk (DK):** flood risk (Klimaatlas, Kystdirektoratet), road and rail noise
  (Miljøstyrelsen noise map) and radon zones, as Area metrics in the score and as a card. It would
  extend the existing "Neighbourhood check", which today covers Germany only.
- **10-year cost of ownership:** loans, ejerudgift, the upkeep estimate and property-tax changes over
  10 years, beside the month-one figure.
- **"Why this score?":** one plain-language paragraph per listing from the local LLM, once the
  roulette's Ollama link exists.
