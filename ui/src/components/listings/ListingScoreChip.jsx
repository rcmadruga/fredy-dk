/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Tooltip } from '@douyinfe/semi-ui-19';

import { useTranslation } from '../../services/i18n/i18n.jsx';
import { bandOf } from '../../services/score/scoreDisplay.js';

import './ListingScoreChip.less';

/**
 * A listing's score, shown inline in the overview: the total out of 100, banded at 70 and 40 with
 * the same tokens the verdict chips use. Hovering lists the score of each group; the full breakdown
 * and the radar are on the listing's page.
 *
 * The score travels with the row, computed by the server against the job's weights and targets, so
 * the chip never works anything out itself. Renders nothing for a row without one, or whose groups
 * are all switched off.
 *
 * @param {Object} props
 * @param {{total: (number|null), groups: Array<{id: string, score: (number|null), off: boolean, missing: boolean}>}|null} [props.score]
 *   The compact score from the listings query.
 */
export default function ListingScoreChip({ score }) {
  const t = useTranslation();

  if (score == null || !Number.isFinite(score.total)) {
    return null;
  }
  const total = Math.round(score.total);
  const band = bandOf(total);

  const breakdown = (
    <div className="listingScoreChip__tip">
      <strong>{t('score.chipTitle', { score: total })}</strong>
      <ul>
        {score.groups.map((group) => (
          <li key={group.id}>
            <span>{t(`score.group.${group.id}`)}</span>
            <span>
              {group.off ? t('score.groupOff') : group.missing ? t('score.unknown') : Math.round(group.score)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <Tooltip content={breakdown} position="top">
      <span
        className={`listingScoreChip listingScoreChip--${band}`}
        aria-label={t('score.chipTitle', { score: total })}
      >
        {total}
      </span>
    </Tooltip>
  );
}

ListingScoreChip.displayName = 'ListingScoreChip';
