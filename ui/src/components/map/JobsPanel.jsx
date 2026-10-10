/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Spin, Switch, Typography } from '@douyinfe/semi-ui-19';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import { JOB_COUNT_STEPS, JOB_POINT_COLOR } from './regionalDataLayers.js';
import './SchoolPanel.less';

const { Text } = Typography;

/** @param {number|null|undefined} ms @returns {string} The date, as the browser's locale writes it; empty if unknown. */
function asOf(ms) {
  if (!Number.isFinite(ms)) return '';
  try {
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * Everything about the Denmark jobs layer: two switches (the kommune shading and the dots), what the
 * data is doing, when it was fetched, and a legend that says the same as the map.
 *
 * Both switches draw on one fetch, made the first time either is switched on. Shares
 * `SchoolPanel.less`: the rows and the colour dot are the same thing there and here.
 *
 * @param {Object} props
 * @param {'idle'|'loading'|'ready'|'error'} props.status - What the jobs data is doing.
 * @param {boolean} props.areaEnabled - Whether the jobs-by-kommune shading is on.
 * @param {(enabled: boolean) => void} props.onAreaEnabledChange
 * @param {boolean} props.pointsEnabled - Whether the dots are on.
 * @param {(enabled: boolean) => void} props.onPointsEnabledChange
 * @param {number} props.total - Adverts placed on the map.
 * @param {number} props.kommuneCount - Kommuner that have at least one.
 * @param {number|null} props.fetchedAt - When the server read the adverts, in ms.
 * @param {boolean} [props.bare=false] - Render without the panel box, for a parent that supplies its own.
 */
export default function JobsPanel({
  status,
  areaEnabled,
  onAreaEnabledChange,
  pointsEnabled,
  onPointsEnabledChange,
  total,
  kommuneCount,
  fetchedAt,
  bare = false,
}) {
  const t = useTranslation();
  const on = areaEnabled || pointsEnabled;
  const date = asOf(fetchedAt);

  return (
    <div className={bare ? 'map-panel__group school-panel' : 'map-panel school-panel'}>
      <div className="map-panel__row">
        <Text size="small" strong className="map-panel__label">
          {t('map.filterJobsArea')}
        </Text>
        <Switch
          size="small"
          aria-label={t('map.filterJobsArea')}
          checked={areaEnabled}
          onChange={onAreaEnabledChange}
        />
      </div>
      <div className="map-panel__row">
        <Text size="small" strong className="map-panel__label">
          {t('map.filterJobsPoints')}
        </Text>
        <Switch
          size="small"
          aria-label={t('map.filterJobsPoints')}
          checked={pointsEnabled}
          onChange={onPointsEnabledChange}
        />
      </div>

      {on && status === 'error' && (
        <div className="map-panel__row school-panel__summary">
          <Text size="small" type="danger">
            {t('map.jobsError')}
          </Text>
        </div>
      )}

      {on && status === 'loading' && (
        <div className="map-panel__row school-panel__summary">
          <Text size="small" type="tertiary">
            {t('map.jobsLoading')}
          </Text>
          <Spin size="small" />
        </div>
      )}

      {on && status === 'ready' && (
        <>
          <div className="map-panel__row school-panel__summary">
            <Text size="small" type="tertiary">
              {t('map.jobsSummary', { total, kommuner: kommuneCount })}
              {date ? ` · ${t('map.jobsAsOf', { date })}` : ''}
            </Text>
          </div>

          <div className="school-panel__section">
            {areaEnabled && (
              <>
                <Text size="small" strong className="map-panel__label">
                  {t('map.jobsLegendArea')}
                </Text>
                {JOB_COUNT_STEPS.map((step, i) => {
                  const next = JOB_COUNT_STEPS[i + 1];
                  const label =
                    next == null
                      ? `${step.min}+`
                      : next.min - step.min === 1
                        ? `${step.min}`
                        : `${step.min}-${next.min - 1}`;
                  return (
                    <div key={step.min} className="school-panel__kind">
                      <span className="school-panel__dot" style={{ background: step.color }} aria-hidden="true" />
                      <Text size="small">{label}</Text>
                    </div>
                  );
                })}
              </>
            )}
            {pointsEnabled && (
              <>
                <Text size="small" strong className="map-panel__label">
                  {t('map.jobsLegendPoints')}
                </Text>
                <div className="school-panel__kind">
                  <span className="school-panel__dot" style={{ background: JOB_POINT_COLOR }} aria-hidden="true" />
                  <Text size="small">{t('map.jobsLegendExact')}</Text>
                </div>
                <div className="school-panel__kind">
                  <span
                    className="school-panel__dot"
                    style={{ background: 'transparent', boxShadow: `inset 0 0 0 2px ${JOB_POINT_COLOR}` }}
                    aria-hidden="true"
                  />
                  <Text size="small">{t('map.jobsLegendApproximate')}</Text>
                </div>
              </>
            )}
            <Text size="small" type="tertiary">
              <a href="https://www.jobindex.dk/" target="_blank" rel="noopener noreferrer">
                {t('map.jobsCredit')}
              </a>
            </Text>
          </div>
        </>
      )}
    </div>
  );
}

JobsPanel.displayName = 'JobsPanel';
