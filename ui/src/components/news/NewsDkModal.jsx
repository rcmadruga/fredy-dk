/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useMemo, useState } from 'react';

import newsDkConfig from '../../assets/news/news.dk.json';
import { dkReleaseNotes } from '../../services/news/dkNews.js';
import { newestDkVersion, selectUnseenDkReleases, selectUnseenRelease } from '../../services/news/newsSelection.js';
import { useActions, useSelector } from '../../services/state/store';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import { ReleaseNotesDialog } from './newsContent.jsx';

/**
 * What is new in Fredy DK, shown once per release, after upstream's own notes.
 *
 * The same dialog as `NewsModal`, fed from `news.dk.json` and keyed by its own marker
 * (`news_dk_last_seen_version`), so the two never mark each other as read. A reader who skipped
 * several releases gets them as one dialog, oldest first, as in the history.
 *
 * It waits for upstream's dialog: two modals on top of each other help nobody, and upstream's is
 * the one a version upgrade is about.
 *
 * @returns {React.ReactElement|null}
 */
const NewsDkModal = () => {
  const t = useTranslation();
  const lastSeen = useSelector((state) => state.userSettings.settings.news_dk_last_seen_version);
  const upstreamLastSeen = useSelector((state) => state.userSettings.settings.news_last_seen_version);
  const releases = useSelector((state) => state.news.releases);
  const userSettingsLoaded = useSelector((state) => state.userSettings.loaded);
  const actions = useActions();
  const [dismissed, setDismissed] = useState(false);

  const newest = useMemo(() => newestDkVersion(newsDkConfig), []);
  const unseen = useMemo(() => {
    const notes = dkReleaseNotes({ releases: selectUnseenDkReleases(newsDkConfig, lastSeen) });
    // One dialog for however many releases were missed: the newest on top, the older ones below it.
    if (notes.length === 0) return null;
    const latest = notes[0];
    return {
      ...latest,
      bodyHtml: notes.map((note) => note.bodyHtml).join(''),
      outline: notes.flatMap((n) => n.outline),
    };
  }, [lastSeen]);

  // A new account has no marker: it is not greeted with a history, and starts from here.
  useEffect(() => {
    if (!userSettingsLoaded || newest == null) return;
    if (lastSeen == null || String(lastSeen).length === 0) {
      actions.userSettings.setNewsDkLastSeenVersion(newest).catch((error) => {
        console.warn('Could not record the DK news starting point for this user.', error);
      });
    }
  }, [userSettingsLoaded, lastSeen, newest, actions.userSettings]);

  const upstreamPending = selectUnseenRelease(releases, upstreamLastSeen) != null;
  const visible = !dismissed && userSettingsLoaded && unseen != null && !upstreamPending;

  const handleClose = () => {
    setDismissed(true);
    actions.userSettings.setNewsDkLastSeenVersion(newest).catch((error) => {
      console.warn('Could not remember that the DK news were read.', error);
    });
  };

  if (!visible) return null;

  return (
    <ReleaseNotesDialog
      release={unseen}
      eyebrow={t('news.sectionDk')}
      fromVersion={lastSeen}
      doneLabel={t('news.sheetDone')}
      onDone={handleClose}
      onClose={handleClose}
    />
  );
};

NewsDkModal.displayName = 'NewsDkModal';

export default NewsDkModal;
