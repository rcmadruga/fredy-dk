/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Checkbox } from '@douyinfe/semi-ui-19';

import { FilterHelp } from '../filters/FilterDrawer.jsx';
import { formatMoveInWindow, parseMoveInWindow, MOVE_IN_DATED_KEY } from '../../services/listings/listingFilters.js';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import './MoveInWindowFilter.less';

/**
 * When the home has to be free: two dates, either of which may be left open, and a switch for
 * leaving out listings that state no date.
 *
 * Plain date inputs rather than a calendar widget: the browser's own picker is already in the user's
 * language and format, works on a phone, and takes a typed date, which is how somebody who knows they
 * are moving in January wants to say it.
 *
 * Both dates are written into one URL value (see `parseMoveInWindow`), and clearing the last of them
 * takes the dated-only flag with it, since the flag means nothing without a window to narrow.
 *
 * @param {Object} props
 * @param {Object} props.values The full URL state.
 * @param {(patch: Object) => void} props.onChange Applies a URL patch.
 * @returns {React.ReactElement}
 */
export default function MoveInWindowFilter({ values, onChange }) {
  const t = useTranslation();
  const window = parseMoveInWindow(values.movein);
  const from = window?.from ?? '';
  const to = window?.to ?? '';

  const setWindow = (next) => {
    const packed = formatMoveInWindow(next);
    onChange({
      movein: packed,
      ...(packed == null ? { [MOVE_IN_DATED_KEY]: null } : {}),
      page: 1,
    });
  };

  return (
    <>
      <FilterHelp>{t('listings.filterMoveInHelp')}</FilterHelp>
      <div className="moveInWindow">
        <label className="moveInWindow__field">
          <span className="moveInWindow__label">{t('listings.filterMoveInFrom')}</span>
          <input
            className="moveInWindow__input"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setWindow({ from: event.target.value || null, to: to || null })}
          />
        </label>
        <label className="moveInWindow__field">
          <span className="moveInWindow__label">{t('listings.filterMoveInTo')}</span>
          <input
            className="moveInWindow__input"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setWindow({ from: from || null, to: event.target.value || null })}
          />
        </label>
      </div>
      <Checkbox
        disabled={window == null}
        checked={values[MOVE_IN_DATED_KEY] === true}
        onChange={(event) => onChange({ [MOVE_IN_DATED_KEY]: event.target.checked ? true : null, page: 1 })}
      >
        {t('listings.filterMoveInDatedOnly')}
      </Checkbox>
    </>
  );
}

MoveInWindowFilter.displayName = 'MoveInWindowFilter';
