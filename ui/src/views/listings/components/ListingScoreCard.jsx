/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useMemo, useState } from 'react';
import { Radar } from 'react-chartjs-2';
import { Tooltip } from '@douyinfe/semi-ui-19';
import { IconChevronDown, IconChevronRight, IconHelpCircle } from '@douyinfe/semi-icons';

import { CHART_COLORS, registerScoreChart, withAlpha } from '../../../components/cards/chartTheme.js';
import { useCurrencyOf } from '../../../hooks/useCurrencyOf.js';
import { useTranslation, useLocale } from '../../../services/i18n/i18n.jsx';
import { bandOf, formatMetricValue, formatTargetBand, radarSpokes } from '../../../services/score/scoreDisplay.js';
import './ListingScoreCard.less';

registerScoreChart();

/** The marker each spoke gets, so state does not rest on colour alone. */
const POINT_STYLE = { ok: 'circle', missing: 'rectRot', off: 'crossRot' };

/**
 * chart.js data and options for the radar.
 *
 * Colours are read from the theme at the moment this runs (a canvas cannot inherit them), and the
 * layout is remounted on a theme switch, so this is always built in the theme on screen.
 *
 * @param {Array<{id: string, label: string, value: number, state: 'ok'|'missing'|'off'}>} spokes
 * @param {(key: string, vars?: Record<string, string>) => string} t
 * @returns {{data: Object, options: Object}}
 */
function buildRadar(spokes, t) {
  const accent = CHART_COLORS.ACCENT;
  const fill = (state) => (state === 'ok' ? accent : state === 'missing' ? CHART_COLORS.ELEVATED : 'transparent');
  const data = {
    labels: spokes.map((spoke) => spoke.label),
    datasets: [
      {
        label: t('score.title'),
        data: spokes.map((spoke) => spoke.value),
        borderColor: accent,
        backgroundColor: withAlpha(accent, 0.16),
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointStyle: spokes.map((spoke) => POINT_STYLE[spoke.state]),
        pointBackgroundColor: spokes.map((spoke) => fill(spoke.state)),
        pointBorderColor: spokes.map((spoke) => (spoke.state === 'off' ? CHART_COLORS.MUTED : accent)),
        pointBorderWidth: 2,
      },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      r: {
        min: 0,
        max: 100,
        ticks: { display: false, stepSize: 25 },
        grid: { color: CHART_COLORS.GRID },
        angleLines: { color: CHART_COLORS.GRID },
        pointLabels: {
          color: (context) => (spokes[context.index]?.state === 'off' ? CHART_COLORS.FAINT : CHART_COLORS.TEXT),
          font: { family: CHART_COLORS.FONT_UI, size: 12 },
          padding: 6,
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: CHART_COLORS.ELEVATED,
        borderColor: CHART_COLORS.GRID_BRIGHT,
        borderWidth: 1,
        titleColor: CHART_COLORS.TEXT,
        bodyColor: CHART_COLORS.MUTED,
        displayColors: false,
        callbacks: {
          label: (context) => {
            const spoke = spokes[context.dataIndex];
            if (spoke?.state === 'off') return t('score.groupOff');
            const value = Math.round(spoke?.value ?? 0);
            return spoke?.state === 'missing' ? `${value} · ${t('score.groupMissing')}` : String(value);
          },
        },
      },
    },
  };
  return { data, options };
}

/**
 * One metric inside an expanded group: what was measured, how it scored, and the targets it was
 * scored against. A kommune average or an estimate is said so next to the value.
 */
function MetricRow({ metric, env }) {
  const { t } = env;
  const target = formatTargetBand(metric, env);
  const band = metric.off ? null : metric.missing ? 'unknown' : bandOf(metric.score);

  return (
    <li className={`listing-score__metric${metric.off ? ' listing-score__metric--off' : ''}`}>
      <div className="listing-score__metric-head">
        <span className="listing-score__metric-label">{t(metric.labelKey)}</span>
        {metric.qualifier != null && (
          <Tooltip content={t(`score.qualifierHelp.${metric.qualifier}`)} position="top">
            <span className="listing-score__qualifier">{t(`score.qualifier.${metric.qualifier}`)}</span>
          </Tooltip>
        )}
        <span className={`listing-score__metric-score listing-score__metric-score--${band ?? 'off'}`}>
          {metric.off ? t('score.groupOff') : metric.missing ? t('score.unknown') : Math.round(metric.score)}
        </span>
      </div>
      {!metric.off && (
        <div className="listing-score__metric-detail">
          {!metric.missing && (
            <span className="listing-score__metric-value">{formatMetricValue(metric.raw, metric.unit, env)}</span>
          )}
          {target != null && <span className="listing-score__metric-target">{target}</span>}
          {metric.customTarget && <span className="listing-score__metric-target">{t('score.customTarget')}</span>}
        </div>
      )}
    </li>
  );
}

/**
 * The listing score on the detail page: a radar of the groups with the total beside it, and below it
 * a row per group that opens onto its metrics.
 *
 * A purchase draws a hexagon (Money, Schools, Work, Home, Area, Deal) and a rental a pentagon (the
 * same without Deal), so the shape tells at a glance which kind of search a listing belongs to. The
 * corners are fixed, so the same corner always means the same group. A group switched off keeps its
 * spoke, marked "off"; a group with no data is drawn hollow and says so.
 *
 * Renders nothing for a listing that has no score.
 *
 * @param {Object} props
 * @param {Object} props.listing A row as the listings API returns it, with `score` from the detail endpoint.
 * @returns {React.ReactElement|null}
 */
export default function ListingScoreCard({ listing }) {
  const t = useTranslation();
  const locale = useLocale();
  const currencyOf = useCurrencyOf();
  const [open, setOpen] = useState(() => new Set());

  const score = listing?.score;
  const spokes = useMemo(() => (score ? radarSpokes(score, t) : []), [score, t]);
  const radar = useMemo(() => buildRadar(spokes, t), [spokes, t]);

  if (!score || spokes.length === 0) return null;

  const env = { t, locale, currency: currencyOf(listing?.provider) };
  const totalBand = bandOf(score.total);
  const toggle = (id) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="listing-card listing-score">
      <h2 className="listing-card__label">{t('score.title')}</h2>

      <div className="listing-score__top">
        <div
          className="listing-score__chart"
          role="img"
          aria-label={t('score.chartLabel', {
            count: spokes.length,
            total: score.total == null ? '–' : Math.round(score.total),
          })}
        >
          <Radar data={radar.data} options={radar.options} />
        </div>
        <div className={`listing-score__total listing-score__total--${totalBand ?? 'off'}`}>
          <span className="listing-score__total-value">{score.total == null ? '–' : Math.round(score.total)}</span>
          <span className="listing-score__total-of">{t('score.outOf')}</span>
        </div>
      </div>

      <ul className="listing-score__groups">
        {score.groups.map((group) => {
          const expanded = open.has(group.id);
          const band = group.off ? null : group.missing ? 'unknown' : bandOf(group.score);
          return (
            <li key={group.id} className="listing-score__group">
              <button
                type="button"
                className="listing-score__group-head"
                aria-expanded={expanded}
                onClick={() => toggle(group.id)}
              >
                {expanded ? <IconChevronDown /> : <IconChevronRight />}
                <span className="listing-score__group-name">{t(`score.group.${group.id}`)}</span>
                {group.id === 'deal' && (
                  <Tooltip content={t('score.dealHelp')} position="top">
                    <IconHelpCircle className="listing-score__help" role="img" aria-label={t('score.dealHelpLabel')} />
                  </Tooltip>
                )}
                <span className="listing-score__bar" aria-hidden="true">
                  {!group.off && (
                    <span
                      className={`listing-score__bar-fill listing-score__bar-fill--${band}`}
                      style={{ width: `${Math.max(0, Math.min(100, group.score ?? 0))}%` }}
                    />
                  )}
                </span>
                <span className={`listing-score__group-score listing-score__group-score--${band ?? 'off'}`}>
                  {group.off ? t('score.groupOff') : group.missing ? t('score.unknown') : Math.round(group.score)}
                </span>
              </button>
              {expanded && (
                <ul className="listing-score__metrics">
                  {group.metrics.map((metric) => (
                    <MetricRow key={metric.key} metric={metric} env={env} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
