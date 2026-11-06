/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getProviders } from '../../utils.js';
import { normalizeCurrency } from './currencies.js';
import { currencyForLink } from './currency.js';

/**
 * The currency a listing is stored with.
 *
 * Asked once, when the pipeline writes the row. Everything after that reads `listings.currency`,
 * because a comparison in SQL has no provider module to ask.
 *
 * @param {string} providerId The provider the listing was found by.
 * @param {{link?: string|null}|null} listing
 * @returns {Promise<string>} ISO 4217 code.
 */
export async function getCurrencyForListing(providerId, listing) {
  const meta = (await getProviders()).find((p) => p.metaInformation.id === providerId)?.metaInformation;
  return currencyForLink(meta, listing?.link);
}

/**
 * @param {string} providerId
 * @returns {Promise<string>} The provider's declared currency code, euros for an unknown provider.
 */
export async function getCurrencyForProvider(providerId) {
  const providers = await getProviders();
  const meta = (providers ?? []).find((provider) => provider?.metaInformation?.id === providerId)?.metaInformation;
  return normalizeCurrency(meta?.currency);
}

/**
 * The ids of every provider that quotes its prices in a currency.
 *
 * What the Danish affordability paths use to pick a model: the listing row carries a provider id, and
 * the currency lives in the provider's `metaInformation`.
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
