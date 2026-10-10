/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getProviders } from '../../utils.js';
import { normalizeCurrency } from './currencies.js';

/**
 * @param {string} providerId
 * @returns {Promise<string>} The provider's currency code, euros for an unknown provider.
 */
export async function getCurrencyForProvider(providerId) {
  const providers = await getProviders();
  const meta = (providers ?? []).find((provider) => provider?.metaInformation?.id === providerId)?.metaInformation;
  return normalizeCurrency(meta?.currency);
}

/**
 * The ids of every provider that quotes its prices in a currency.
 *
 * What the affordability paths need to pick a model: the listing row carries a provider id, and the
 * currency lives in the provider's `metaInformation`.
 *
 * @param {string} currency ISO 4217 code, e.g. `DKK`.
 * @returns {Promise<string[]>}
 */
export async function getProviderIdsForCurrency(currency) {
  const wanted = normalizeCurrency(currency);
  const providers = await getProviders();
  return (providers ?? [])
    .map((provider) => provider?.metaInformation)
    .filter((meta) => meta?.id != null && normalizeCurrency(meta.currency) === wanted)
    .map((meta) => meta.id);
}
