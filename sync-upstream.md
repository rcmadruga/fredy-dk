# Syncing this fork with upstream and deploying

Playbook for pulling `orangecoding/fredy` into `rcmadruga/fredy-dk` and redeploying on LXC 116.
Written after the first big sync (43 upstream commits, 229 files, Sep 2026). Not project docs.

## Model

- `origin` = `https://github.com/rcmadruga/fredy-dk.git` (the fork). `upstream` = `https://github.com/orangecoding/fredy.git`.
- The fork is a thin patch layer on top of upstream, so **rebase our commits onto `upstream/master`** rather than merging.
  Cost: `origin/master` gets force-pushed, so the LXC checkout must be reset once (step 7).
- Our fork-only work: Boligsiden, Lejebolig and BoligPortal providers, `tools/deploy/rebuild-on-lxc.sh` and `browser-probe.mjs`, `searchHosts`,
  per-provider `currency`, the regional-data map layers (tax + schools panel).
- Run the sync in a **separate clone**, not in a checkout another agent or session is editing.

## Before you start

1. `df -h /` on the devbox. Root is ~7.9G and has hit 100% repeatedly. Need ~2G free.
   - Yarn cache is already redirected to NFS (`yarn config get cache-folder` -> `/mnt/devbox/.cache/yarn`). Check it still is.
   - If root is full: `docker builder prune -af` (safe) and `yarn cache clean`.
   - Do NOT touch the `mapadotesouro-app` container/image (unrelated, live) or move Docker's data-root (restarts it; overlay2 on NFS may not work).
   - Disk resize (Proxmox host): `pct resize 112 rootfs +15G`.
2. `gh auth status` must list the `workflow` scope. Upstream touches `.github/workflows/*` and GitHub rejects the push without it.
   Fix: `gh auth refresh -h github.com -s workflow`, then open https://github.com/login/device and enter the code (needs a human).
3. Commit or stash everything in the main checkout first. `PLAN.md` and `.claude/worktrees/` are untracked cruft: never `git add -A` blindly, it swept `PLAN.md` into a commit once.
4. Preview the drift: `gh api repos/orangecoding/fredy/compare/rcmadruga:fredy-dk:master...master --jq '.files[].filename'`.
   Expect conflicts in whatever we also touch: `lib/types/providerConfig.js`, `ui/src/services/jobs/providerUrl.js`,
   `ui/src/services/providerOrder.js`, `test/provider/testProvider.json`, `test/offlineFixtures.js`,
   `test/services/tracking/priceRange.test.js`, `test/ui/providerOrder.test.js`, `test/ui/locales.test.js`, `package.json`, `yarn.lock`.

## Steps

```bash
# 1. Isolated clone (reuses local objects, small)
git clone --reference /mnt/devbox/projects/fredy-dk https://github.com/rcmadruga/fredy-dk.git /mnt/devbox/scratch/fredy-dk-sync
cd /mnt/devbox/scratch/fredy-dk-sync
git config user.name rcmadruga && git config user.email rcmadruga@gmail.com   # local only; a fresh clone has no identity
git remote add upstream https://github.com/orangecoding/fredy.git
git fetch upstream

# 2. Rebase our commits onto upstream
git rebase upstream/master
#    resolve conflicts, `git add`, `git rebase --continue` (see "Conflict rules")
#    Do not use `git rebase -i`.

# 3. Dependencies + verify
yarn install --network-timeout 600000
yarn lint                # oxlint (upstream replaced eslint/prettier with oxlint/oxfmt)
yarn test:offline        # must be fully green (last run: 266 files, 3487 tests)

# 4. Push (force is needed because history was rewritten)
git push origin master --force-with-lease
```

Put the scratch clone under `/mnt/devbox`, not `/root`: a fresh `node_modules` is ~700MB.
Delete it afterwards.

## Conflict rules learned

- **Both sides appended to a list/table/JSON** (provider order, price-range fixtures, `testProvider.json`, locale backlog): keep both.
- **`yarn.lock`**: don't hand-merge. Take upstream's, then run `yarn install`. Check the result:
  `git diff origin/master -- yarn.lock` should show only our new deps (e.g. `@turf/simplify` + transitives).
  If it shows unrelated bumps (rolldown, oxc), reset it with `git checkout origin/master -- yarn.lock` and run `yarn install` again.
- **Host validation**: upstream's `hosts` *adds to* `baseUrl` (its own test requires `baseUrl`'s host in it).
  Our `searchHosts` *replaces* `baseUrl` (Boligsiden must reject `www.boligsiden.dk`, accept `api.boligsiden.dk`). Keep them separate;
  `hostsOf()` in `ui/src/services/jobs/providerUrl.js` checks `searchHosts` first.
- **`test/ui/providerOrder.test.js`**: the expected country set is one representative per provider (best-ranked). idealista's `pt` never appears.
  Current set: `de, at, ch, es, it, dk`. Add a country only when a provider's best-ranked country is new.
- After a rebase the committer becomes whoever git detects. Set the local identity (above) before committing so authorship stays `rcmadruga`.
- A follow-on feature branch built on the old history: commit it, then
  `git rebase --onto origin/master <old-base-commit> HEAD`, then `git branch -f master HEAD && git checkout master`.

## Deploy on the LXC (you run this, there is no SSH from the devbox)

`tools/deploy/rebuild-on-lxc.sh` clones/pulls into `~/fredy-dk`, builds `fredy-dk:local`, stops the old container, and starts `fredy-new`.
Its `git pull origin master` **fails after a force-push**, so the first run after any rebase needs:

```bash
git -C ~/fredy-dk fetch origin && git -C ~/fredy-dk reset --hard origin/master
~/fredy-dk/tools/deploy/rebuild-on-lxc.sh
```

Then confirm the new container in the browser. The script stops but does not remove the old container; finish or roll back by hand as it prints.
The LXC's own disk needs headroom for the build (Chromium download).

## Drift watcher

`.github/workflows/upstream-watch.yml` runs weekly (and on manual dispatch), checks `behind_by`
via the GitHub compare API and the latest upstream release tag, and files/updates a single
`upstream-sync`-labelled issue when we're behind. Read-only - it doesn't touch the sync steps above.

## Housekeeping after

- `rm -rf` the scratch clone. Reset the main checkout: `git fetch origin && git reset --hard origin/master`
  (only if it has nothing uncommitted you want).
- Optional: make the script self-healing by replacing its `git pull origin master` (line ~69) with fetch + `reset --hard origin/master`.
- The school layer needs `UDDANNELSESSTATISTIK_API_KEY` (free key: https://api.uddannelsesstatistik.dk/GetStarted), set in `~/fredy.env` on the LXC.
  Its queries (`INCLUSION_QUERY`, `GRADE_QUERY` in `lib/services/regionalData/schoolClient.js`) are verified against the live API; positions come from STIL's institution register.
- Things in this fork that a merge can quietly break, worth a look after every sync:
  - `currency` on `ProviderMetaInformation` (default EUR; the Danish providers declare DKK) and the UI's
    `useCurrencyOf` / `formatPrice`. A new upstream price display that hardcodes `€` is a regression here.
  - Anything cached to disk (`lib/services/regionalData/`) must survive `JSON.stringify`, and is versioned by
    its cache key (`...V2`/`V3`) - bump the key when the cached shape changes.
  - `buildHash` skips anything that is not a non-empty string: pass `String(price)`, never a number.
  - `searchHosts` (replaces `baseUrl`'s host) sits beside upstream's `hosts` (adds to it); upstream's own test
    requires `hosts` to include `baseUrl`'s host, so the two must stay separate.
- Live tests (`yarn test`) trigger a CloakBrowser Chromium download even for providers that don't need it. Avoid on the devbox; use `test:offline`.
