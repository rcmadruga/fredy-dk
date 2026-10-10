/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { MONEY_METRICS } from './money.js';
import { SCHOOLS_METRICS } from './schools.js';
import { WORK_METRICS } from './work.js';

/**
 * Every registered metric, in the order they are listed within their group. The group modules
 * contribute their descriptors here; the order of the groups themselves is `GROUP_IDS` in `score.js`.
 *
 * @type {import('./types.js').MetricDescriptor[]}
 */
export const METRICS = [...MONEY_METRICS, ...SCHOOLS_METRICS, ...WORK_METRICS];
