/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { VERDICT_COLORS, formatEuro } from '../../../components/cards/chartTheme.js';
import { formatPrice } from '../../../services/price/priceService.js';
import { useTranslation, useLocale } from '../../../services/i18n/i18n.jsx';

import './VerdictBanner.less';

/**
 * The one-sentence answer, stated plainly.
 *
 * Shared by the calculator and the listing detail card so a listing never gets one verdict in
 * one place and a different one somewhere else.
 *
 * Only the verdict itself carries the verdict's colour - "Affordable", "A stretch", "Out of reach" -
 * and the rest of the sentence stays in the text colour. It used to be a tinted box with a coloured
 * edge, a coloured dot and the whole sentence coloured: four signals for one word, and the figures
 * in the sentence were the hardest thing on it to read.
 *
 * @param {Object} props
 * @param {'affordable'|'stretch'|'unaffordable'} props.verdict
 * @param {number|null} props.share Rate as a fraction of net income, including existing debt.
 * @param {number} props.monthlyRate
 * @param {number} [props.recommendedRate] What the 35 % rule allows.
 * @param {number} [props.maxPrice] Highest purchase price that stays inside the rule.
 * @param {string|null} [props.advice] Replaces the purchase-specific advice line - renting has
 *   no purchase price to quote, but the same budget ceiling is still worth naming.
 * @param {boolean} [props.compact] Tighter layout for the listing detail card.
 * @param {string} [props.currency] ISO 4217 code the amounts are written in; euros unless it says otherwise.
 */
export default function VerdictBanner({
  verdict,
  share,
  monthlyRate,
  recommendedRate,
  maxPrice,
  advice: customAdvice,
  compact = false,
  currency,
}) {
  const t = useTranslation();
  const locale = useLocale();

  // Whole units: a verdict line is read, not reconciled.
  const money = (value) =>
    currency ? formatPrice(Math.round(Number(value)), locale, null, currency) : formatEuro(value, locale);

  const color = VERDICT_COLORS[verdict] ?? VERDICT_COLORS.unaffordable;
  const percent = share == null ? null : (share * 100).toFixed(0);

  const word = t(`finance.verdict.${verdict}`);
  const headline =
    percent == null ? word : t(`finance.verdict.${verdict}Detail`, { percent, rate: money(monthlyRate) });
  // Every language opens the sentence with the verdict word, so the colour can stop where the word
  // does. Should a translation ever word it differently, the whole sentence takes the colour rather
  // than none of it.
  const rest = headline.startsWith(word) ? headline.slice(word.length) : null;

  // Only say something useful when it is actually useful: an affordable purchase does not
  // need to be told what it could have spent.
  const advice =
    customAdvice !== undefined
      ? customAdvice
      : verdict === 'affordable'
        ? null
        : recommendedRate > 0
          ? t('finance.verdict.advice', {
              rate: money(recommendedRate),
              price: money(maxPrice),
            })
          : t('finance.verdict.adviceNoRoom');

  return (
    <div className={`verdictBanner${compact ? ' verdictBanner--compact' : ''}`} role="status">
      <span className="verdictBanner__headline">
        {rest == null ? (
          <span style={{ color }}>{headline}</span>
        ) : (
          <>
            <span className="verdictBanner__word" style={{ color }}>
              {word}
            </span>
            {rest}
          </>
        )}
      </span>
      {advice && <span className="verdictBanner__advice">{advice}</span>}
    </div>
  );
}

VerdictBanner.displayName = 'VerdictBanner';
