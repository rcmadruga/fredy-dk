/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Switch, Typography } from '@douyinfe/semi-ui-19';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import SchoolPanel from './SchoolPanel.jsx';

const { Text } = Typography;

/**
 * The Denmark-only map layers in one box, in the same named groups the listings map's own panel
 * uses (MAP, LISTINGS): SCHOOLS with its switch and filters, and KOMMUNE with the tax choropleth.
 *
 * Everything but the tax switch is handed straight to {@link SchoolPanel}.
 *
 * @param {Object} props
 * @param {boolean} props.taxLayer - Whether the kommune tax layer is on.
 * @param {(enabled: boolean) => void} props.onTaxLayerChange
 * @returns {React.ReactElement}
 */
export default function DenmarkPanel({ taxLayer, onTaxLayerChange, ...schoolProps }) {
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
    </div>
  );
}
