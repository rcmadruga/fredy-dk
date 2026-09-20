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
