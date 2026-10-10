/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Switch, Typography } from '@douyinfe/semi-ui-19';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import SchoolPanel from './SchoolPanel.jsx';
import GroceryPanel from './GroceryPanel.jsx';
import JobsPanel from './JobsPanel.jsx';

const { Text } = Typography;

/**
 * The Denmark-only map layers in one box, in the same named groups the listings map's own panel
 * uses (MAP, LISTINGS): SCHOOLS with its switch and filters, KOMMUNE with the tax choropleth and
 * GROCERIES with the supermarkets and JOBS with the ernæringsassistent adverts.
 *
 * `groceries` is handed to {@link GroceryPanel} and `jobs` to {@link JobsPanel}; everything else but
 * the tax switch goes straight to {@link SchoolPanel}.
 *
 * @param {Object} props
 * @param {boolean} props.taxLayer - Whether the kommune tax layer is on.
 * @param {(enabled: boolean) => void} props.onTaxLayerChange
 * @param {Object} props.groceries - The props of {@link GroceryPanel}, minus `bare`.
 * @param {Object} props.jobs - The props of {@link JobsPanel}, minus `bare`.
 * @returns {React.ReactElement}
 */
export default function DenmarkPanel({ taxLayer, onTaxLayerChange, groceries, jobs, ...schoolProps }) {
  const t = useTranslation();

  return (
    <div className="map-panel">
      <div className="map-panel__groupTitle">{t('map.groupSchools')}</div>
      <SchoolPanel bare {...schoolProps} />

      <div className="map-panel__divider" />

      <div className="map-panel__groupTitle">{t('map.groupKommune')}</div>
      <div className="map-panel__row">
        <Text size="small" strong className="map-panel__label">
          {t('map.filterTaxLayer')}
        </Text>
        <Switch size="small" aria-label={t('map.filterTaxLayer')} checked={taxLayer} onChange={onTaxLayerChange} />
      </div>

      <div className="map-panel__divider" />

      <div className="map-panel__groupTitle">{t('map.groupGroceries')}</div>
      <GroceryPanel bare {...groceries} />

      <div className="map-panel__divider" />

      <div className="map-panel__groupTitle">{t('map.groupJobs')}</div>
      <JobsPanel bare {...jobs} />
    </div>
  );
}
