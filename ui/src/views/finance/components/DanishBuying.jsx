/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Col, Collapse, Row, Typography } from '@douyinfe/semi-ui-19';
import { IconCalendar, IconTickCircle } from '@douyinfe/semi-icons';

import { SegmentPart } from '../../../components/segment/SegmentPart.jsx';
import KpiCard from '../../../components/cards/KpiCard.jsx';
import { NumberField } from './ProfileForm.jsx';
import VerdictBanner from './VerdictBanner.jsx';
import { formatPrice } from '../../../services/price/priceService.js';
import { formatDecimal } from '../../../services/number/numberService.js';
import { useTranslation, useLocale } from '../../../services/i18n/i18n.jsx';

import './FinanceForms.less';

const { Text } = Typography;

/** The ceiling the bidrag bands stop at, as the server's defaults have them: 40, 60 and 80 % of the price. */
const BAND_LIMITS = Object.freeze([40, 60, 80]);

/**
 * Whole kroner, grouped the way the reader's language writes them.
 *
 * @param {number|null|undefined} value
 * @param {string} locale
 * @returns {string} A dash for anything that is not a number.
 */
function kr(value, locale) {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return formatPrice(Math.round(Number(value)), locale, null, 'DKK');
}

/**
 * The Danish variant of the buying tab: the inputs on the left, the answer on the right.
 *
 * Everything shown comes from the server's calculation of the draft (`result.dk`). The browser
 * holds no Danish arithmetic, for the same reason it holds no German: two copies of the tinglysning
 * rules would drift. What the user can change is stored under `financing.dk` as only what they
 * changed; a field they have not touched shows the default the server applied (`result.dk.params`).
 *
 * @param {Object} props
 * @param {import('../../../types/finance.js').FinancingParams} props.financing The draft's `financing`.
 * @param {Object|null} props.result The Danish result for the draft (`model: 'dk'`), or null before the first answer.
 * @param {(patch: Object) => void} props.onChange Shallow-merged into the draft's `financing`.
 */
export default function DanishBuying({ financing, result, onChange }) {
  const t = useTranslation();
  const locale = useLocale();

  const dk = result?.model === 'dk' ? result.dk : null;
  const own = financing.dk ?? {};
  const base = dk?.params ?? {};

  // What the field shows: the user's own value, else the default the server applied.
  const value = (key) => own[key] ?? base[key] ?? null;
  const loanValue = (loan, key) => own[loan]?.[key] ?? base[loan]?.[key] ?? null;
  const setOwn = (patch) => onChange({ dk: { ...own, ...patch } });
  const setLoan = (loan, patch) => setOwn({ [loan]: { ...own[loan], ...patch } });
  const bands = own.realkredit?.bidragBands ?? base.realkredit?.bidragBands ?? [];
  const setBand = (index, bidragPct) => {
    const next = BAND_LIMITS.map((limit, i) => ({
      upToLtvPct: limit,
      bidragPct: i === index ? bidragPct : (bands[i]?.bidragPct ?? 0),
    }));
    setLoan('realkredit', { bidragBands: next });
  };

  const hasPrice = (financing.purchasePrice ?? 0) > 0;
  const hasIncome = (result?.budget?.netIncome ?? 0) > 0;
  const noData = t('finance.noData');
  const pct = (n) => `${formatDecimal(n, locale)} %`;

  const debtFree = (result?.debtFreeAges ?? [])
    .filter((person) => person.ageWhenDebtFree != null)
    .map((person) => `${person.label} ${person.ageWhenDebtFree}`)
    .join(' · ');

  const ownerCost = dk?.running.ownerCostMonthly;
  const ownerSource = dk?.running.source;

  const readout = dk
    ? [
        { key: 'loansNet', label: t('finance.dk.loansNet'), value: kr(dk.payment.net, locale) },
        { key: 'loansGross', label: t('finance.dk.loansGross'), value: kr(dk.payment.gross, locale) },
        {
          key: 'realkredit',
          label: t('finance.dk.realkreditMonthly'),
          value: `${kr(dk.loans.realkredit.grossMonthly, locale)} / ${kr(dk.loans.realkredit.netMonthly, locale)}`,
        },
        ...(dk.loans.bank.nominal > 0
          ? [
              {
                key: 'bank',
                label: t('finance.dk.bankMonthly'),
                value: `${kr(dk.loans.bank.grossMonthly, locale)} / ${kr(dk.loans.bank.netMonthly, locale)}`,
              },
            ]
          : []),
        {
          key: 'ownerCost',
          label: t('finance.dk.ownerCost'),
          value: ownerCost == null ? t('finance.dk.ownerCostUnknown') : kr(ownerCost, locale),
        },
        {
          key: 'grundskyld',
          label: t('finance.dk.grundskyld'),
          value:
            ownerSource === 'advert'
              ? t('finance.dk.grundskyldIncluded')
              : dk.running.grundskyldMonthly == null
                ? t('finance.dk.grundskyldUnknown')
                : kr(dk.running.grundskyldMonthly, locale),
        },
        { key: 'cash', label: t('finance.dk.cashNeeded'), value: kr(dk.cashNeeded, locale) },
        { key: 'skoede', label: t('finance.dk.tinglysningSkoede'), value: kr(dk.oneOff.skoede.total, locale) },
        {
          key: 'pant',
          label: t('finance.dk.tinglysningPant'),
          value: kr(dk.oneOff.pantRealkredit + dk.oneOff.pantBank, locale),
        },
        ...(dk.debt.afterInterestOnly !== dk.funding.totalNominal || dk.loans.realkredit.interestOnlyYears > 0
          ? [{ key: 'afterIo', label: t('finance.dk.debtAfterIo'), value: kr(dk.debt.afterInterestOnly, locale) }]
          : []),
        {
          key: 'debtAt',
          label: t('finance.dk.debtAfterYears', { years: String(dk.debt.atYears) }),
          value: kr(dk.debt.atYearsBalance, locale),
        },
        { key: 'debtFree', label: t('finance.kpi.debtFreeAge'), value: debtFree || '-' },
      ]
    : [];

  return (
    <Row gutter={[16, 16]} className="finance__split">
      <Col xs={24} lg={10} xl={9}>
        <SegmentPart
          name={t('finance.dk.propertyTitle')}
          helpText={t('finance.dk.propertyHelp')}
          helpMode="popover"
          action={<span className="financeStep">{t('finance.form.step', { n: '2' })}</span>}
        >
          <div className="financeForm__fields">
            <NumberField
              label={t('finance.dk.price')}
              value={financing.purchasePrice}
              step={25000}
              suffix="kr"
              help={t('finance.dk.priceHelp')}
              onChange={(purchasePrice) => onChange({ purchasePrice })}
            />
            <NumberField
              label={t('finance.dk.cashOnHand')}
              value={financing.equity}
              step={10000}
              suffix="kr"
              help={t('finance.dk.cashOnHandHelp')}
              onChange={(equity) => onChange({ equity })}
            />
            <NumberField
              label={t('finance.dk.valuation')}
              value={own.publicValuation}
              step={25000}
              suffix="kr"
              allowEmpty
              help={t('finance.dk.valuationHelp')}
              onChange={(publicValuation) => setOwn({ publicValuation })}
            />
            <NumberField
              label={t('finance.dk.ownerCostInput')}
              value={own.ownerCostMonthly}
              step={100}
              suffix="kr"
              allowEmpty
              help={t('finance.dk.ownerCostInputHelp')}
              onChange={(ownerCostMonthly) => setOwn({ ownerCostMonthly })}
            />
          </div>
        </SegmentPart>

        <SegmentPart
          name={t('finance.dk.fundingTitle')}
          helpText={t('finance.dk.fundingHelp')}
          helpMode="popover"
          action={<span className="financeStep">{t('finance.form.step', { n: '3' })}</span>}
        >
          <div className="financeForm__fields">
            <NumberField
              label={t('finance.dk.downPayment')}
              value={value('downPaymentPct')}
              step={1}
              max={100}
              suffix="%"
              help={t('finance.dk.downPaymentHelp')}
              onChange={(downPaymentPct) => setOwn({ downPaymentPct })}
            />
            <NumberField
              label={t('finance.dk.realkreditShare')}
              value={loanValue('realkredit', 'pct')}
              step={1}
              max={100}
              suffix="%"
              help={t('finance.dk.realkreditShareHelp')}
              onChange={(next) => setLoan('realkredit', { pct: next })}
            />
            <NumberField
              label={t('finance.dk.realkreditRate')}
              value={loanValue('realkredit', 'rate')}
              step={0.1}
              max={100}
              suffix="%"
              help={t('finance.dk.realkreditRateHelp')}
              onChange={(rate) => setLoan('realkredit', { rate })}
            />
            <NumberField
              label={t('finance.dk.realkreditTerm')}
              value={loanValue('realkredit', 'termYears')}
              step={1}
              max={50}
              suffix={t('finance.dk.yearsSuffix')}
              onChange={(termYears) => setLoan('realkredit', { termYears })}
            />
            <NumberField
              label={t('finance.dk.realkreditInterestOnly')}
              value={loanValue('realkredit', 'interestOnlyYears')}
              step={1}
              max={10}
              suffix={t('finance.dk.yearsSuffix')}
              help={t('finance.dk.interestOnlyHelp')}
              onChange={(interestOnlyYears) => setLoan('realkredit', { interestOnlyYears })}
            />
            <NumberField
              label={t('finance.dk.kurs')}
              value={loanValue('realkredit', 'kurs')}
              step={0.5}
              max={150}
              help={t('finance.dk.kursHelp')}
              onChange={(kurs) => setLoan('realkredit', { kurs })}
            />
            <NumberField
              label={t('finance.dk.bankRate')}
              value={loanValue('bank', 'rate')}
              step={0.1}
              max={100}
              suffix="%"
              help={t('finance.dk.bankRateHelp')}
              onChange={(rate) => setLoan('bank', { rate })}
            />
            <NumberField
              label={t('finance.dk.bankTerm')}
              value={loanValue('bank', 'termYears')}
              step={1}
              max={50}
              suffix={t('finance.dk.yearsSuffix')}
              onChange={(termYears) => setLoan('bank', { termYears })}
            />
            <NumberField
              label={t('finance.dk.bankInterestOnly')}
              value={loanValue('bank', 'interestOnlyYears')}
              step={1}
              max={10}
              suffix={t('finance.dk.yearsSuffix')}
              onChange={(interestOnlyYears) => setLoan('bank', { interestOnlyYears })}
            />
          </div>

          {/* The figures a lender sets, and the two taxes. All arrive with a working default; the
              readout in the header says what they currently come to so the fold need not be opened. */}
          <Collapse className="propertyForm__rates" keepDOM={false}>
            <Collapse.Panel
              itemKey="costs"
              header={
                <span className="finance__foldHeader">
                  <span className="finance__foldTitle">{t('finance.dk.costsTitle')}</span>
                  <span className="finance__foldSummary">
                    {dk == null
                      ? t('finance.form.ratesSummaryPending')
                      : t('finance.dk.costsSummary', { bidrag: pct(dk.funding.bidragPct) })}
                  </span>
                </span>
              }
            >
              <div className="financeForm__fields">
                {BAND_LIMITS.map((limit, index) => (
                  <NumberField
                    key={limit}
                    label={t('finance.dk.bidragBand', { limit: String(limit) })}
                    value={bands[index]?.bidragPct ?? null}
                    step={0.05}
                    max={10}
                    suffix="%"
                    help={index === 0 ? t('finance.dk.bidragHelp') : undefined}
                    onChange={(bidragPct) => setBand(index, bidragPct)}
                  />
                ))}
                <NumberField
                  label={t('finance.dk.lenderFees')}
                  value={value('lenderFees')}
                  step={500}
                  suffix="kr"
                  help={t('finance.dk.lenderFeesHelp')}
                  onChange={(lenderFees) => setOwn({ lenderFees })}
                />
                <NumberField
                  label={t('finance.dk.advisorFee')}
                  value={value('advisorFee')}
                  step={500}
                  suffix="kr"
                  help={t('finance.dk.advisorFeeHelp')}
                  onChange={(advisorFee) => setOwn({ advisorFee })}
                />
                <NumberField
                  label={t('finance.dk.ownerChangeInsurance')}
                  value={value('ownerChangeInsurance')}
                  step={500}
                  suffix="kr"
                  help={t('finance.dk.ownerChangeInsuranceHelp')}
                  onChange={(ownerChangeInsurance) => setOwn({ ownerChangeInsurance })}
                />
                <NumberField
                  label={t('finance.dk.deductionPct')}
                  value={value('deductionPct')}
                  step={1}
                  max={100}
                  suffix="%"
                  help={t('finance.dk.deductionHelp')}
                  onChange={(deductionPct) => setOwn({ deductionPct })}
                />
                <NumberField
                  label={t('finance.dk.deductionHighPct')}
                  value={value('deductionHighPct')}
                  step={1}
                  max={100}
                  suffix="%"
                  onChange={(deductionHighPct) => setOwn({ deductionHighPct })}
                />
                <NumberField
                  label={t('finance.dk.landValue')}
                  value={own.landValue}
                  step={25000}
                  suffix="kr"
                  allowEmpty
                  help={t('finance.dk.landValueHelp')}
                  onChange={(landValue) => setOwn({ landValue })}
                />
                <NumberField
                  label={t('finance.dk.landTaxPerMille')}
                  value={own.landTaxPerMille}
                  step={0.5}
                  suffix="‰"
                  allowEmpty
                  help={t('finance.dk.landTaxPerMilleHelp')}
                  onChange={(landTaxPerMille) => setOwn({ landTaxPerMille })}
                />
              </div>
            </Collapse.Panel>
          </Collapse>
        </SegmentPart>
      </Col>

      <Col xs={24} lg={14} xl={15}>
        {dk != null && hasIncome && hasPrice && (
          <VerdictBanner
            currency="DKK"
            verdict={result.verdict}
            share={result.rateShareOfNetIncome}
            monthlyRate={dk.totalMonthly.net}
            recommendedRate={result.recommendation.recommendedRate}
            maxPrice={result.recommendation.maxAffordablePrice}
          />
        )}

        <Row gutter={[16, 16]} className="finance__kpi-row">
          <Col xs={24} sm={12}>
            <KpiCard
              title={t('finance.dk.monthlyTotal')}
              color="orange"
              value={dk != null && hasPrice ? kr(dk.totalMonthly.net, locale) : noData}
              icon={<IconCalendar />}
              description={
                dk != null && !dk.totalMonthly.ownerCostKnown
                  ? t('finance.dk.monthlyTotalLoansOnly')
                  : t('finance.dk.monthlyTotalDesc')
              }
            />
          </Col>
          <Col xs={24} sm={12}>
            <KpiCard
              title={t('finance.kpi.maxPrice')}
              color="green"
              value={dk != null && hasIncome ? kr(result.recommendation.maxAffordablePrice, locale) : noData}
              icon={<IconTickCircle />}
              description={t('finance.kpi.maxPriceDesc')}
            />
          </Col>
        </Row>

        {readout.length > 0 && hasPrice && (
          <div className="financeForm__readout resultSummary__rows">
            {readout.map(({ key, label, value: shown }) => (
              <div className="financeForm__readout-row" key={key}>
                <span className="resultSummary__label">{label}</span>
                <span className="financeForm__readout-value">{shown}</span>
              </div>
            ))}
          </div>
        )}

        {dk != null && hasPrice && dk.cashShortfall > 0 && (
          <Text type="warning" size="small" className="finance__tab-lead">
            {t('finance.dk.cashShortfall', { amount: kr(dk.cashShortfall, locale) })}
          </Text>
        )}

        {dk != null && hasPrice && (
          <Text type="tertiary" size="small" className="finance__tab-lead">
            {t('finance.dk.estimateNote')}
          </Text>
        )}
      </Col>
    </Row>
  );
}

DanishBuying.displayName = 'DanishBuying';
