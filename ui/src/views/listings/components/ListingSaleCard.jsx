/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Tooltip } from '@douyinfe/semi-ui-19';
import { IconHelpCircle } from '@douyinfe/semi-icons';

import { buildSaleFacts } from '../listingFacts.js';
import { useTranslation, useLocale } from '../../../services/i18n/i18n.jsx';
import { useCurrencyOf } from '../../../hooks/useCurrencyOf.js';
import './ListingSaleCard.less';

/**
 * What a for-sale advert states beside the price, in the order a Danish buyer reads it: the monthly
 * costs first, then how long the home has been on the market (and whether it was relisted), then the
 * building, which is folded away until asked for, and links to the floor plan and the next open house.
 *
 * Renders nothing for a rental, or for a purchase whose portal states none of it.
 *
 * @param {Object} props
 * @param {Object} props.listing - A row as the listings API returns it.
 * @param {Object|null} [props.finance] - The listing's financing payload (`useListingFinance`). Once the
 *   household has a profile, its own monthly payment is shown next to the realtor's example.
 * @returns {React.ReactElement|null}
 */
export default function ListingSaleCard({ listing, finance = null }) {
  const t = useTranslation();
  const locale = useLocale();
  const currencyOf = useCurrencyOf();

  const facts = buildSaleFacts(listing, {
    t,
    locale,
    currency: currencyOf(listing?.provider),
    yourFinance: finance?.result ?? null,
  });
  if (facts == null) return null;
  const { costs, sales, market, building, floorPlanUrl, openHouse } = facts;

  const help = (text, label) =>
    text ? (
      <Tooltip content={text} position="top">
        <IconHelpCircle
          className="listing-sale__help"
          role="img"
          aria-label={t('listing.detail.explain', { field: label })}
        />
      </Tooltip>
    ) : null;

  const rows = (list) => (
    <dl className="listing-sale__rows">
      {list.map((row) => (
        <div key={row.id} className={`listing-sale__row${row.id === 'price' ? ' listing-sale__row--lead' : ''}`}>
          <dt>
            {row.label}
            {help(row.helpText, row.label)}
          </dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <section className="listing-card listing-sale">
      <h2 className="listing-card__label">{t('listing.detail.saleTitle')}</h2>

      {costs.length > 0 && (
        <div className="listing-sale__section">
          <h3 className="listing-sale__heading">{t('listing.detail.saleCostsTitle')}</h3>
          {rows(costs)}
        </div>
      )}

      {sales != null && (
        <div className="listing-sale__section">
          <h3 className="listing-sale__heading">{t('listing.detail.saleSalesTitle')}</h3>

          {sales.sales.length > 0 && (
            <div className="listing-sale__table-wrap">
              <table className="listing-sale__table">
                <thead>
                  <tr>
                    <th scope="col">{t('listing.detail.saleSalesDate')}</th>
                    <th scope="col">{t('listing.detail.saleSalesPrice')}</th>
                    <th scope="col">{t('listing.detail.saleSalesPerM2')}</th>
                    <th scope="col">
                      {t('listing.detail.saleSalesChange')}
                      {help(t('listing.detail.saleSalesChangeHelp'), t('listing.detail.saleSalesChange'))}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sales.sales.map((sale, index) => (
                    <tr
                      // A register can list several sales on one day, so the date alone is not a key.
                      key={`${sale.date}-${index}`}
                      className={sale.free ? undefined : 'listing-sale__sale--not-free'}
                    >
                      <th scope="row">
                        {sale.date}
                        {/* Said in words as well as greyed: grey alone would not tell a family sale from an old one. */}
                        {!sale.free && <span className="listing-sale__sale-type">{sale.typeLabel}</span>}
                      </th>
                      <td>{sale.amount}</td>
                      {/* The labels are only shown when the table is stacked, see the .less file. */}
                      <td data-label={t('listing.detail.saleSalesPerM2')}>{sale.perM2 ?? t('common.na')}</td>
                      <td data-label={t('listing.detail.saleSalesChange')} title={sale.change?.diffText}>
                        {sale.change?.text ?? t('common.na')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sales.hasNonFree && <p className="listing-sale__note">{t('listing.detail.saleSalesNotFreeNote')}</p>}

          {sales.valuation != null && (
            <dl className="listing-sale__rows">
              <div className="listing-sale__row">
                <dt>
                  {t('listing.detail.saleValuation')}
                  {help(sales.valuation.helpText, t('listing.detail.saleValuation'))}
                </dt>
                <dd>{sales.valuation.text}</dd>
              </div>
            </dl>
          )}
        </div>
      )}

      {market != null && (
        <div className="listing-sale__section">
          <h3 className="listing-sale__heading">
            {t('listing.detail.saleMarketTitle')}
            {market.relisted && (
              <Tooltip content={t('listing.detail.saleRelistedHelp', { days: market.gapDays })} position="top">
                <span className="listing-sale__badge" tabIndex={0}>
                  {t('listing.detail.saleRelisted')}
                </span>
              </Tooltip>
            )}
          </h3>
          <dl className="listing-sale__rows">
            {market.current != null && (
              <div className="listing-sale__row">
                <dt>{t('listing.detail.saleDaysCurrent')}</dt>
                <dd>{market.current}</dd>
              </div>
            )}
            {market.total != null && (
              <div className="listing-sale__row">
                <dt>{t('listing.detail.saleDaysTotal')}</dt>
                <dd>{market.total}</dd>
              </div>
            )}
          </dl>
          {market.relisted && market.previousRealtors.length > 0 && (
            <p className="listing-sale__note">
              {t('listing.detail.salePreviousRealtors', { names: market.previousRealtors.join(', ') })}
            </p>
          )}
        </div>
      )}

      {building.length > 0 && (
        <details className="listing-sale__section listing-sale__building">
          <summary className="listing-sale__heading">{t('listing.detail.saleBuildingTitle')}</summary>
          {rows(building)}
        </details>
      )}

      {(floorPlanUrl != null || openHouse != null) && (
        <ul className="listing-sale__links">
          {floorPlanUrl != null && (
            <li>
              <a href={floorPlanUrl} target="_blank" rel="noopener noreferrer">
                {t('listing.detail.saleFloorPlan')}
              </a>
            </li>
          )}
          {openHouse != null && (
            <li>
              {t('listing.detail.saleOpenHouse', { date: openHouse.text })}
              {openHouse.signUpUrl != null && (
                <>
                  {' '}
                  <a href={openHouse.signUpUrl} target="_blank" rel="noopener noreferrer">
                    {t('listing.detail.saleOpenHouseSignUp')}
                  </a>
                </>
              )}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
