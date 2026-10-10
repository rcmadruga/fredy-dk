# Releasing Fredy DK

Fredy DK releases are cut by a GitHub Action when a pull request is merged. Nobody tags by hand.

## Versions

A release is called `<upstream version>-dk.<n>`, for example `29.2.1-dk.1`.

- The upstream version is read from `package.json`. This fork never edits it, so syncing upstream
  stays clean.
- `n` is one more than the highest existing `<upstream version>-dk.*` tag. When a sync moves the
  upstream version on (say to `29.3.0`), the counter starts again at 1: `29.3.0-dk.1`.

## How to release

1. Open a pull request into `master` as usual.
2. If it is worth telling users about, add a `## News` section to the description. The template
   has one. Leave it empty, or delete it, for a release without news.
3. Add the label `release`.
4. Merge. That is all.

A merged pull request without the `release` label does nothing. For a manual release, run the
workflow "Release Fredy DK" from the Actions tab (optionally with a pull request number, to use its
title and News section); it releases `master` as it stands.

## What the action does

`.github/workflows/release-dk.yml` runs on merge and:

1. Works out the next version from `package.json` and the existing tags.
2. If the pull request has a `## News` section, adds it as a release at the top of
   `ui/src/assets/news/news.dk.json` and commits that to `master` as `github-actions[bot]` with the
   message `chore(release): <version> [skip ci]`. If master has moved on meanwhile, it rebases and
   pushes again.
3. Tags that commit (or the merge commit, when there is no news) `<version>` and pushes the tag.
4. Creates a GitHub Release called `<version>`. Its notes are the pull request title and link, plus
   the News section.
5. Builds and pushes the Docker image as `<version>` and `latest` by calling `docker-build.yml`. This
   is done from the workflow itself because a tag pushed with the built-in `GITHUB_TOKEN` does not
   trigger `docker.yml`.

Releases run one at a time (concurrency group `release-dk`), so two merges cannot claim the same
number. GitHub keeps only one waiting run per group, so if several releases are merged while one is
still running, re-run the dropped one by hand.

The commit to `master` is made with the built-in token, so branch protection on `master` must allow
`github-actions[bot]` to push.

The logic lives in `tools/release/dkRelease.js` and is tested in `test/tools/dkRelease.test.js`.

### Writing the News section

The section runs up to the next `## ` heading or the end of the description. Only a small Markdown
subset is understood; everything else is escaped and shown as typed, so HTML in a description does
nothing.

| You write | What users see |
| --- | --- |
| a blank line between paragraphs | a gap between paragraphs |
| `- item` | a bullet list |
| `**text**` | bold |
| `*text*` | italic |
| `[text](https://example.com)` | a link (only `http`, `https` and `mailto`) |

The entry title is the pull request title, so write that for users too.

## How What's new works

The "What's new" dialog has two parts, each with its own file and its own marker per user:

| Part | File | Versions | Marker (user setting) |
| --- | --- | --- | --- |
| Fredy (upstream) | `ui/src/assets/news/news.json` | `29.1.0` | `news_last_seen_version` |
| Fredy DK | `ui/src/assets/news/news.dk.json` | `29.2.1-dk.1` | `news_dk_last_seen_version` |

`news.json` belongs to upstream and is never edited here. Both files have the same shape.

- A section appears in the dialog only when it has releases the user has not seen. Closing the dialog
  records the newest version of each part that was shown.
- DK versions are ordered by the upstream version first and the `-dk.<n>` counter second, so
  `29.3.0-dk.1` is newer than `29.2.1-dk.9`.
- A user with no DK marker is new, sees nothing, and gets the current newest DK version recorded.
  Users who already existed when migration 53 ran were given `0.0.0-dk.0` instead, so they see the
  first DK news once.
- The history (bell icon in the sidebar) shows both parts as two tabs.
- The footer shows `v<upstream>-dk.<n>` while the newest entry in `news.dk.json` matches the running
  upstream version, and the plain upstream version otherwise (for example right after a sync, before
  the next release).

The first release, `29.2.1-dk.1`, is already written in `news.dk.json`. When the action cuts it, the
News section of that pull request is added to the existing release rather than replacing it.
