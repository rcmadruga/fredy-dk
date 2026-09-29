/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useRef, useState } from 'react';
import { Button, Spin, Typography } from '@douyinfe/semi-ui-19';
import { IconArticle, IconLanguage, IconRefresh } from '@douyinfe/semi-icons';

import { useTranslation } from '../../../services/i18n/i18n.jsx';
import './ListingDescriptionCard.less';

const { Text } = Typography;

const TRANSLATE_PREF_KEY = 'fredy.translateDescription';

/** Whether the reader asked for English descriptions. Per browser: a reading preference, not data. */
function readTranslatePref() {
  try {
    return window.localStorage.getItem(TRANSLATE_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

function writeTranslatePref(value) {
  try {
    window.localStorage.setItem(TRANSLATE_PREF_KEY, value ? '1' : '0');
  } catch {
    // Storage can be blocked; the choice then lasts until the page is left.
  }
}

/** Where the action sits inside the hint sentence. Each locale places it by its own grammar. */
const ACTION_SLOT = '{{action}}';

/**
 * What the card says about the last fetch, per outcome.
 *
 * `updated` is missing on purpose: when it worked, the text itself is the answer, and a line saying
 * so would be the page congratulating itself under the thing the reader asked for.
 *
 * @type {Record<string, {key: string, tone: string}>}
 */
const OUTCOME = {
  unsupported: { key: 'listing.detail.refetchUnsupported', tone: 'muted' },
  unchanged: { key: 'listing.detail.refetchUnchanged', tone: 'muted' },
  failed: { key: 'listing.detail.refetchFailed', tone: 'error' },
  busy: { key: 'listing.detail.refetchBusy', tone: 'muted' },
};

/**
 * The portal's own words about the flat, and a way to go and get them.
 *
 * An empty description is the normal case on some portals rather than the exception, because the
 * search page a listing is scraped from carries a headline and little else. The detail page has the
 * text, and Fredy can read it - but in the bulk sweep only for the portals ticked in settings, and
 * only at the moment a listing was found. This card offers the same fetch by hand, for this one
 * listing: one person asking for one exposé is not the traffic that setting is there to hold back.
 *
 * In the empty state the verb in the sentence IS the control, rather than a button next to a
 * sentence describing what the button would do. There is only one thing to do here and saying it
 * twice is one time too many.
 *
 * The outcome stays on the card rather than passing by as a toast. "This portal has no detail page"
 * is a standing fact about the listing, not an event, and a reader who missed the toast would
 * otherwise press again to find out what happened.
 *
 * @param {Object} props
 * @param {Object} props.listing
 * @param {() => void} props.onRefetch
 * @param {boolean} props.refetching - Whether a fetch is in flight.
 * @param {string|null} props.outcome - The last status the route answered with, or null.
 * @param {() => Promise<void>} [props.onTranslate] - Asks the server to translate this description and
 *   reloads the listing. Called at most once per listing, when English is wanted and none is stored.
 * @returns {React.ReactElement}
 */
export default function ListingDescriptionCard({ listing, onRefetch, refetching, outcome, onTranslate }) {
  const t = useTranslation();
  const description = listing?.description;
  const translation = listing?.description_en;
  // Known to be English already: nothing to translate, so nothing to offer.
  const isEnglish = listing?.description_lang === 'en';
  const [wantEnglish, setWantEnglish] = useState(readTranslatePref);
  const [translating, setTranslating] = useState(false);
  const askedFor = useRef(null);

  // The stored translation is made when the listing is fetched, so this only fires for listings
  // that predate translation or whose automatic attempt failed. Once per listing and description,
  // so an unreachable service is not asked again on every render.
  useEffect(() => {
    const key = `${listing?.id}:${description}`;
    if (!wantEnglish || !description || listing?.description_lang != null || askedFor.current === key) return;
    if (typeof onTranslate !== 'function') return;
    askedFor.current = key;
    setTranslating(true);
    Promise.resolve(onTranslate()).finally(() => setTranslating(false));
  }, [wantEnglish, description, listing?.id, listing?.description_lang, onTranslate]);

  const toggleEnglish = () => {
    const next = !wantEnglish;
    writeTranslatePref(next);
    setWantEnglish(next);
  };
  const showTranslation = wantEnglish && Boolean(translation);
  const note = outcome ? OUTCOME[outcome] : null;
  // A portal with no detail page will not grow one on a second press.
  const exhausted = outcome === 'unsupported';

  // Read without variables, so the placeholder survives to be split on. The two halves are whatever
  // the locale wrote around it, which is the only way a German verb at the end and an English one
  // in the middle can share a single string.
  const [before, after] = t('listing.detail.refetchHint').split(ACTION_SLOT);

  return (
    <section className="listing-card listing-description">
      <div className="listing-description__head">
        <h2 className="listing-card__label">{t('listing.detail.descriptionTitle')}</h2>
        {/* Only when there is already text: the empty state acts through its own sentence, and a
            second control in the corner would be the same action offered twice. */}
        {description && !isEnglish && (
          <Button
            className="listing-description__translate"
            icon={<IconLanguage />}
            theme="borderless"
            size="small"
            loading={translating}
            disabled={translating}
            onClick={toggleEnglish}
          >
            {wantEnglish ? t('listing.detail.showOriginal') : t('listing.detail.translate')}
          </Button>
        )}
        {description && (
          <Button
            className="listing-description__refetch"
            icon={<IconRefresh />}
            theme="borderless"
            size="small"
            loading={refetching}
            disabled={refetching || exhausted}
            onClick={onRefetch}
          >
            {t('listing.detail.refetchAgain')}
          </Button>
        )}
      </div>

      {description ? (
        <>
          <p className="listing-description__body">{showTranslation ? translation : description}</p>
          {showTranslation && (
            <Text type="tertiary" size="small">
              {t('listing.detail.translatedNote')}
            </Text>
          )}
        </>
      ) : (
        <div className="listing-description__empty">
          <IconArticle className="listing-description__empty-icon" aria-hidden="true" />
          <div className="listing-description__empty-body">
            <span className="listing-description__empty-lead">{t('listing.detail.noDescription')}</span>
            <Text type="tertiary" size="small">
              {before}
              {/* A button, not an anchor: it acts on this page and goes nowhere, so it has to be
                  the element a keyboard and a screen reader treat as an action. */}
              <button
                type="button"
                className="listing-description__action"
                disabled={refetching || exhausted}
                onClick={onRefetch}
              >
                {t('listing.detail.refetchHintAction')}
              </button>
              {after}
              {refetching && <Spin size="small" className="listing-description__spinner" />}
            </Text>
            {listing?.link && (
              <a href={listing.link} target="_blank" rel="noopener noreferrer" className="listing-description__link">
                {t('listing.detail.noDescriptionLink')}
              </a>
            )}
          </div>
        </div>
      )}

      {note && (
        <p className={`listing-description__outcome listing-description__outcome--${note.tone}`}>{t(note.key)}</p>
      )}
    </section>
  );
}

ListingDescriptionCard.displayName = 'ListingDescriptionCard';
