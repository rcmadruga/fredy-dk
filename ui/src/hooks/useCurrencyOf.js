/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback } from 'react';
import { useSelector } from '../services/state/store.js';
import { DEFAULT_CURRENCY } from '../services/price/priceService.js';

/**
 * The currency a listing's price is in, looked up by the provider that found it.
 *
 * Every price the UI shows used to be printed with a euro sign, which is wrong for the Danish
 * providers - a 2.000.000 kr. house read as 2.000.000 €. A provider declares `currency` in its
 * metadata only when it is not euros, so an unknown provider or a missing field stays what it was.
 *
 * @returns {(providerId: string|null|undefined) => string} ISO 4217 code.
 */
export function useCurrencyOf() {
  const providers = useSelector((state) => state.provider);

  return useCallback(
    (providerId) => {
      const declared = (providers ?? []).find((provider) => provider?.id === providerId)?.currency;
      return typeof declared === 'string' && /^[A-Za-z]{3}$/.test(declared) ? declared.toUpperCase() : DEFAULT_CURRENCY;
    },
    [providers],
  );
}
