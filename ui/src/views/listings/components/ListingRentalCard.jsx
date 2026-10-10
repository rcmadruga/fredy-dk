/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Tooltip } from '@douyinfe/semi-ui-19';
import { IconHelpCircle } from '@douyinfe/semi-icons';

import { buildRentalFacts } from '../listingFacts.js';
import { useTranslation, useLocale } from '../../../services/i18n/i18n.jsx';
import { useCurrencyOf } from '../../../hooks/useCurrencyOf.js';
import './ListingRentalCard.less';

/**
 * What a rental states beside the rent: when the home is free, what it costs on top, the deposit and
 * the cash needed on the day. The date leads and is set large, because for anyone moving at a fixed
 * time it decides whether the rest matters.
 *
 * Renders nothing for a sale, or for a rental that states none of it.
 *
 * @param {Object} props
 * @param {Object} props.listing - A row as the listings API returns it.
 * @returns {React.ReactElement|null}
 */
export default function ListingRentalCard({ listing }) {
  const t = useTranslation();
  const locale = useLocale();
  const currencyOf = useCurrencyOf();

  const facts = buildRentalFacts(listing, { t, locale, currency: currencyOf(listing?.provider) });
  if (facts == null) return null;
  const { availability, rows, moveIn, warnings, socialHousing } = facts;

  const help = (text, label) =>
    text ? (
      <Tooltip content={text} position="top">
        <IconHelpCircle
          className="listing-rental__help"
          role="img"
          aria-label={t('listing.detail.explain', { field: label })}
        />
      </Tooltip>
    ) : null;

  return (
    <section className="listing-card listing-rental">
      <h2 className="listing-card__label">{t('listing.detail.rentalTitle')}</h2>

      <div className={`listing-rental__available listing-rental__available--${availability?.state ?? 'unknown'}`}>
        <span className="listing-rental__available-label">{t('listing.detail.rentalAvailableFrom')}</span>
        {availability != null ? (
          <>
            <span className="listing-rental__available-date">{availability.date}</span>
            <span className="listing-rental__available-relative">{availability.relative}</span>
          </>
        ) : (
          <span className="listing-rental__available-relative">{t('listing.detail.rentalAvailableUnknown')}</span>
        )}
      </div>

      {socialHousing && <span className="listing-rental__chip">{t('listing.detail.rentalSocialHousing')}</span>}

      <dl className="listing-rental__rows">
        {rows.map((row) => (
          <div key={row.id} className="listing-rental__row">
            <dt>
              {row.label}
              {help(row.helpText, row.label)}
            </dt>
            <dd>{row.value}</dd>
          </div>
        ))}
        {moveIn != null && (
          <div className="listing-rental__row listing-rental__row--total">
            <dt>
              {t(moveIn.stated ? 'listing.detail.rentalMoveInStated' : 'listing.detail.rentalMoveIn')}
              {help(moveIn.helpText, t('listing.detail.rentalMoveIn'))}
            </dt>
            <dd>{moveIn.text}</dd>
          </div>
        )}
      </dl>

      {warnings.map((warning) => (
        <p key={warning} className="listing-rental__warning" role="note">
          {warning}
        </p>
      ))}
    </section>
  );
}
