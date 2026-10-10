/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useId, useState } from 'react';
import { Button, InputNumber, Select, Slider } from '@douyinfe/semi-ui-19';

import { useSelector } from '../../../../services/state/store';
import { useTranslation, useLocale } from '../../../../services/i18n/i18n.jsx';
import { savedAddresses } from '../../../../services/jobs/commuteFilter.js';
import {
  GROUP_WEIGHT_RANGE,
  hasCoincidingTarget,
  setCommuteLabel,
  setGroupWeight,
  setMetricWeight,
  setTarget,
} from '../../../../services/jobs/scoreConfig.js';
import { groupsForDealType, metricsOfGroup } from '../../../../services/score/metricCatalog.js';
import { formatMetricValue } from '../../../../services/score/scoreDisplay.js';
import { isPlaceType } from '../../../../services/travelTime/placeCategories.js';
import './scoreConfig.less';

/** The value of the "use the default" entry in the commute address picker. */
const DEFAULT_ADDRESS = '__default__';

/**
 * How a job weighs and scores its listings.
 *
 * Each group of the radar gets a weight, from 0 (off: it keeps its spoke but takes no part) to 3. An
 * untouched slider sits at 1, which is the default and is not stored, so a job nobody customised keeps
 * a `null` config. "Advanced" opens a weight and an ideal and worst value per metric, with the
 * defaults as placeholders; leaving a box empty uses the default. The commute metric measures to one
 * of the saved addresses, chosen here.
 *
 * Deal is only offered for a purchase, as the radar only draws it for one.
 *
 * @param {Object} props
 * @param {Object|null} props.value The job's `scoreConfig`.
 * @param {(next: Object|null) => void} props.onChange `null` once everything is back at the defaults.
 * @param {'rent'|'buy'|null} props.dealType
 * @returns {React.ReactElement}
 */
export default function ScoreConfig({ value, onChange, dealType }) {
  const t = useTranslation();
  const locale = useLocale();
  const userSettings = useSelector((state) => state.userSettings.settings);
  const [advanced, setAdvanced] = useState(false);
  const addressLabelId = useId();

  const env = { t, locale, currency: 'EUR' };
  const groups = groupsForDealType(dealType);
  // Named addresses only: a place type ("the nearest supermarket") is a different place for each
  // listing, so there is no one journey to call the commute.
  const addresses = savedAddresses(userSettings).filter((address) => !isPlaceType(address));
  const weightOf = (group) => value?.groups?.[group] ?? 1;

  return (
    <div className="scoreConfig">
      <p className="scoreConfig__intro">{t('jobs.mutation.scoreIntro')}</p>

      <div className="scoreConfig__groups">
        {groups.map((group) => {
          const weight = weightOf(group);
          const labelId = `${addressLabelId}-${group}`;
          return (
            <div key={group} className="scoreConfig__group" role="group" aria-labelledby={labelId}>
              <span className="scoreConfig__groupName" id={labelId}>
                {t(`score.group.${group}`)}
              </span>
              <Slider
                className="scoreConfig__slider"
                min={GROUP_WEIGHT_RANGE.min}
                max={GROUP_WEIGHT_RANGE.max}
                step={GROUP_WEIGHT_RANGE.step}
                value={weight}
                tipFormatter={(v) => (v === 0 ? t('score.groupOff') : `×${v}`)}
                onChange={(v) => onChange(setGroupWeight(value, group, v))}
              />
              <span className={`scoreConfig__weight${weight === 0 ? ' scoreConfig__weight--off' : ''}`}>
                {weight === 0 ? t('score.groupOff') : `×${weight}`}
              </span>
            </div>
          );
        })}
      </div>

      <div className="scoreConfig__commute">
        <span className="scoreConfig__commuteLabel" id={`${addressLabelId}-commute`}>
          {t('jobs.mutation.scoreCommuteLabel')}
        </span>
        <Select
          size="small"
          className="scoreConfig__commuteSelect"
          aria-labelledby={`${addressLabelId}-commute`}
          value={value?.commute?.label ?? DEFAULT_ADDRESS}
          onChange={(v) => onChange(setCommuteLabel(value, v === DEFAULT_ADDRESS ? null : v))}
        >
          <Select.Option value={DEFAULT_ADDRESS}>{t('jobs.mutation.scoreCommuteDefault')}</Select.Option>
          {addresses.map((address) => (
            <Select.Option key={address.label} value={address.label}>
              {address.label}
            </Select.Option>
          ))}
        </Select>
        <span className="scoreConfig__hint">
          {addresses.length === 0 ? t('jobs.mutation.scoreCommuteNoAddresses') : t('jobs.mutation.scoreCommuteHint')}
        </span>
      </div>

      <Button
        theme="borderless"
        size="small"
        className="scoreConfig__advancedToggle"
        aria-expanded={advanced}
        onClick={() => setAdvanced((open) => !open)}
      >
        {advanced ? t('jobs.mutation.scoreAdvancedClose') : t('jobs.mutation.scoreAdvancedOpen')}
      </Button>

      {advanced && (
        <div className="scoreConfig__advanced">
          <p className="scoreConfig__hint">{t('jobs.mutation.scoreAdvancedHint')}</p>
          {groups.map((group) => (
            <fieldset key={group} className="scoreConfig__fieldset">
              <legend>{t(`score.group.${group}`)}</legend>
              {metricsOfGroup(group, dealType).map((metric) => {
                const target = value?.targets?.[metric.key] ?? {};
                const coinciding = hasCoincidingTarget(value, metric.key);
                const placeholder = (end) =>
                  metric[end] == null
                    ? t('jobs.mutation.scoreAutomatic')
                    : formatMetricValue(metric[end], metric.unit, env);
                return (
                  <div key={metric.key} className="scoreConfig__metric">
                    <span className="scoreConfig__metricName">{t(metric.labelKey)}</span>
                    <InputNumber
                      size="small"
                      className="scoreConfig__weightInput"
                      min={0}
                      max={100}
                      step={0.5}
                      hideButtons
                      aria-label={t('jobs.mutation.scoreMetricWeightAria', { metric: t(metric.labelKey) })}
                      value={value?.metrics?.[metric.key] ?? ''}
                      placeholder={`×${metric.defaultWeight}`}
                      onChange={(v) => onChange(setMetricWeight(value, metric.key, v))}
                    />
                    <InputNumber
                      size="small"
                      className="scoreConfig__targetInput"
                      hideButtons
                      aria-label={t('jobs.mutation.scoreIdealAria', { metric: t(metric.labelKey) })}
                      validateStatus={coinciding ? 'error' : 'default'}
                      value={target.ideal ?? ''}
                      placeholder={`${t('jobs.mutation.scoreIdeal')} ${placeholder('ideal')}`}
                      onChange={(v) => onChange(setTarget(value, metric.key, 'ideal', v))}
                    />
                    <InputNumber
                      size="small"
                      className="scoreConfig__targetInput"
                      hideButtons
                      aria-label={t('jobs.mutation.scoreWorstAria', { metric: t(metric.labelKey) })}
                      validateStatus={coinciding ? 'error' : 'default'}
                      value={target.worst ?? ''}
                      placeholder={`${t('jobs.mutation.scoreWorst')} ${placeholder('worst')}`}
                      onChange={(v) => onChange(setTarget(value, metric.key, 'worst', v))}
                    />
                    {coinciding && (
                      <span className="scoreConfig__error" role="alert">
                        {t('jobs.mutation.scoreTargetsDiffer')}
                      </span>
                    )}
                  </div>
                );
              })}
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}

ScoreConfig.displayName = 'ScoreConfig';
