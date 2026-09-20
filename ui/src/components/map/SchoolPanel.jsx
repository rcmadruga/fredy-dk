/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Button, Checkbox, Switch, Tooltip, Typography } from '@douyinfe/semi-ui-19';
import _RangeSlider from 'react-range-slider-input';
import 'react-range-slider-input/dist/style.css';
import { useTranslation, useLocale } from '../../services/i18n/i18n.jsx';
import { formatDecimal } from '../../services/number/numberService.js';
import { SELECTABLE_CATEGORIES, categoryColor, hasActiveFilters, scoreDomain } from './schoolFilters.js';
import './SchoolPanel.less';

// Same interop the other range slider in the app needs: the package is CommonJS with a default export.
const RangeSlider = _RangeSlider?.default ?? _RangeSlider;

const { Text } = Typography;

/** The tooltip for each state the layer switch can be disabled in; `ready` and `loading` have none. */
const STATUS_HINT = {
  'no-key': (t) => t('map.filterSchoolLayerUnavailable'),
  error: (t) => t('map.filterSchoolLayerError'),
};

/**
 * A colour dot, the same colour the marker has on the map.
 *
 * @param {{category: string}} props
 */
function Dot({ category }) {
  return <span className="school-panel__dot" style={{ background: categoryColor(category) }} aria-hidden="true" />;
}

/**
 * Everything about the Denmark school layer in one box: the switch that turns it on, whether special
 * schools are shown, which kinds of school are, and a range on the grade average. The kinds double as
 * the legend - each row carries the colour its markers have.
 *
 * Renders only its switch until the layer is on and its data has arrived, so an unused layer costs a
 * single row in the map's controls.
 *
 * @param {Object} props
 * @param {'loading'|'ready'|'no-key'|'error'} props.status - What the school data is doing. Anything
 *   but `ready` disables the switch, each with its own tooltip: a missing key and a failed request
 *   need different things from the reader, and `loading` needs nothing.
 * @param {boolean} props.enabled - Whether the layer is on.
 * @param {(enabled: boolean) => void} props.onEnabledChange
 * @param {import('./schoolFilters.js').SchoolFilters} props.filters
 * @param {(patch: Partial<import('./schoolFilters.js').SchoolFilters>) => void} props.onFiltersChange
 * @param {Array<Object>} props.schools - Everything loaded, unfiltered: the score range is read from
 *   it, so its ends do not move as the filters change.
 * @param {number} props.shownCount - How many of them the filters leave.
 * @param {() => void} props.onReset
 */
export default function SchoolPanel({
  status,
  enabled,
  onEnabledChange,
  filters,
  onFiltersChange,
  schools,
  shownCount,
  onReset,
}) {
  const t = useTranslation();
  const locale = useLocale();

  const ready = status === 'ready';
  const domain = scoreDomain(schools);
  const range = [
    Math.max(filters.scoreMin ?? domain.min, domain.min),
    Math.min(filters.scoreMax ?? domain.max, domain.max),
  ];

  /**
   * A handle at the end of the track means "no limit", which is stored as null: that way the range
   * follows the data instead of freezing at whatever the ends were when it was last dragged.
   */
  const handleRange = ([low, high]) => {
    onFiltersChange({
      scoreMin: low <= domain.min ? null : low,
      scoreMax: high >= domain.max ? null : high,
    });
  };

  const setCategory = (id, checked) => onFiltersChange({ categories: { ...filters.categories, [id]: checked } });

  return (
    <div className="map-panel school-panel">
      <div className="map-panel__row">
        <Text size="small" strong className="map-panel__label">
          {t('map.filterSchoolLayer')}
        </Text>
        <Tooltip content={STATUS_HINT[status]?.(t) ?? null} position="left">
          <Switch
            size="small"
            aria-label={t('map.filterSchoolLayer')}
            checked={enabled}
            disabled={!ready}
            onChange={onEnabledChange}
          />
        </Tooltip>
      </div>

      {enabled && ready && (
        <>
          <div className="map-panel__row school-panel__summary">
            <Text size="small" type="tertiary">
              {t('map.schoolShowing', { shown: shownCount, total: schools.length })}
            </Text>
            {hasActiveFilters(filters) && (
              <Button size="small" theme="borderless" onClick={onReset}>
                {t('map.schoolResetFilters')}
              </Button>
            )}
          </div>

          <div className="map-panel__row">
            <Text size="small" className="school-panel__kind">
              <Dot category="special" />
              {t('map.schoolCategory.special')}
            </Text>
            <Switch
              size="small"
              aria-label={t('map.schoolCategory.special')}
              checked={filters.showSpecial}
              onChange={(value) => onFiltersChange({ showSpecial: value })}
            />
          </div>

          <div className="school-panel__section">
            <Text size="small" strong className="map-panel__label">
              {t('map.schoolTypeTitle')}
            </Text>
            {SELECTABLE_CATEGORIES.map((id) => (
              <Checkbox
                key={id}
                checked={filters.categories[id] !== false}
                onChange={(event) => setCategory(id, event.target.checked)}
              >
                <span className="school-panel__kind">
                  <Dot category={id} />
                  {t(`map.schoolCategory.${id}`)}
                </span>
              </Checkbox>
            ))}
          </div>

          <div className="school-panel__section">
            <Text size="small" strong className="map-panel__label">
              {t('map.schoolScoreTitle')}
            </Text>
            <div className="school-panel__slider">
              <div className="school-panel__sliderLabels">
                <span>{formatDecimal(range[0], locale)}</span>
                <span>{formatDecimal(range[1], locale)}</span>
              </div>
              <RangeSlider min={domain.min} max={domain.max} step={0.1} value={range} onInput={handleRange} />
            </div>
            <Checkbox
              checked={filters.includeUnscored}
              onChange={(event) => onFiltersChange({ includeUnscored: event.target.checked })}
            >
              <Text size="small">{t('map.schoolIncludeUnscored')}</Text>
            </Checkbox>
            <Text size="small" type="tertiary">
              {t('map.schoolScoreNote')}
            </Text>
          </div>
        </>
      )}
    </div>
  );
}

SchoolPanel.displayName = 'SchoolPanel';
