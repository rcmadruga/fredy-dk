/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback } from 'react';
import { useSelector } from '../services/state/store.js';
import { DEFAULT_CURRENCY } from '../services/price/priceService.js';

/**
 * @param {unknown} value
 * @returns {string|null} Upper-case ISO 4217 code, or null for anything that is not one.
 */
const codeOrNull = (value) => (typeof value === 'string' && /^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : null);

/**
 * The currency a listing's price is in.
 *
 * A listing row carries the currency it was stored with, and that one is right: a provider can price
 * differently on each of its portals (`currencyByHost`), which no lookup by provider can tell. Handed
 * only a provider id, or a row that has none (a pin on the map before it is stored), the provider's
 * declared currency answers; a provider declares `currency` only when it is not euros, so an unknown
 * provider or a missing field stays euros.
 *
 * @returns {(subject: {currency?: string, provider?: string}|string|null|undefined) => string} ISO 4217 code.
 */
export function useCurrencyOf() {
  const providers = useSelector((state) => state.provider);

  return useCallback(
    (subject) => {
      const own = codeOrNull(subject?.currency);
      if (own != null) return own;
      const providerId = typeof subject === 'string' ? subject : subject?.provider;
      const declared = (providers ?? []).find((provider) => provider?.id === providerId)?.currency;
      return codeOrNull(declared) ?? DEFAULT_CURRENCY;
    },
    [providers],
  );
}
