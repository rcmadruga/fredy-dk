/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useMemo } from 'react';

import ListingsFilterPanel from './ListingsFilterPanel.jsx';
import { useActions, useSelector } from '../../services/state/store.js';
import { useTranslation, useLocale } from '../../services/i18n/i18n.jsx';
import { useFinanceProfile } from '../../hooks/useFinanceProfile.js';
import { measuredPlaces } from '../../utils';
import { formatEuro } from '../cards/chartTheme.js';
import { affordabilityFilterHelp } from '../../services/finance/rentBasis.js';

/**
 * The listing filters, wired to what they need from the app: the jobs and providers to choose from,
 * whether there is a finance profile and a home address to measure against, and the tracking calls.
 *
 * Both the overview and the map render this, which is the point: the two used to keep their own
 * filter controls, and their own idea of which filters exist, so the same URL showed different
 * listings on each. One component and one filter object (`toListingsQuery`) is what stops that
 * coming back.
 *
 * @param {Object} props
 * @param {boolean} props.visible
 * @param {() => void} props.onClose
 * @param {Object} props.values The full URL state.
 * @param {(patch: Object) => void} props.onChange Applies a URL patch.
 * @param {string[]|null} [props.availableProviders] Providers that have results, to narrow the list.
 * @returns {React.ReactElement}
 */
export default function ListingFiltersDrawer({ visible, onClose, values, onChange, availableProviders = null }) {
  const t = useTranslation();
  const locale = useLocale();
  const actions = useActions();
  const providers = useSelector((state) => state.provider);
  const pois = useSelector((state) => state.tracking.pois);
  const jobs = useSelector((state) => state.jobsData.jobs);
  const userSettings = useSelector((state) => state.userSettings.settings);
  const generalSettings = useSelector((state) => state.generalSettings.settings);
  const { anyComplete: financeComplete, thresholds: financeThresholds } = useFinanceProfile();

  // A commute filter without a reference address would return an empty page and look broken, so the
  // control is not offered until there is something to measure from. Place types count: somebody whose
  // only entry is "a supermarket" still has travel times to filter by.
  const hasAddresses = measuredPlaces(userSettings).length > 0;

  // The filter says nothing about *why* a listing lands in a band, so its tooltip names the ceilings
  // it is measured against.
  const affordabilityHelp = useMemo(
    () => affordabilityFilterHelp(financeThresholds, { t, locale, formatEuro }),
    [financeThresholds, locale, t],
  );

  return (
    <ListingsFilterPanel
      visible={visible}
      onClose={onClose}
      values={values}
      onChange={onChange}
      jobs={jobs}
      providers={providers}
      availableProviders={availableProviders}
      financeComplete={financeComplete}
      affordabilityHelp={affordabilityHelp}
      hasAddresses={hasAddresses}
      connectivityEnabled={generalSettings?.connectivityEnabled === true}
      onAffordabilityUsed={() => actions.tracking.trackPoi(pois.FINANCE_AFFORDABILITY_FILTER_USED)}
      onConnectivityFilterUsed={(kind) =>
        actions.tracking.trackPoi(
          {
            downstream: pois.CONNECTIVITY_FILTER_DOWNSTREAM,
            fiber: pois.CONNECTIVITY_FILTER_FIBER,
            mobile: pois.CONNECTIVITY_FILTER_MOBILE,
          }[kind],
        )
      }
    />
  );
}

ListingFiltersDrawer.displayName = 'ListingFiltersDrawer';
