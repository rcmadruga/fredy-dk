/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import React from 'react';

import { useActions } from '../services/state/store.js';

/**
 * What this listing would cost the household, measured against the saved finance profile.
 *
 * One request for the whole detail page: the financing card and the sale card both read it, and
 * asking twice for the same answer would only make the two disagree for a moment.
 *
 * The answer comes from `GET /api/finance/listing/:id`, which runs the same core as the calculator
 * and picks the Danish model for a listing priced in kroner, so neither card needs to know which
 * model produced it - only its shape (`result.model === 'dk'` for the Danish one).
 *
 * @param {{id?: string, price?: number|null}|null|undefined} listing
 * @returns {Object|null} The payload, or `null` while it loads or when the listing has no price.
 */
export function useListingFinance(listing) {
  const actions = useActions();
  const [finance, setFinance] = React.useState(null);

  React.useEffect(() => {
    if (listing?.id == null || listing?.price == null) {
      setFinance(null);
      return undefined;
    }
    let cancelled = false;
    actions.finance.getListingFinance(listing.id).then((payload) => {
      if (!cancelled) setFinance(payload);
    });
    return () => {
      cancelled = true;
    };
  }, [listing?.id, listing?.price]);

  return finance;
}
