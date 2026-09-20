/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Select, Switch, Tooltip, Typography } from '@douyinfe/semi-ui-19';
import { useTranslation } from '../../services/i18n/i18n.jsx';

const { Text } = Typography;

/** The tooltip for each state the school switch can be disabled in; `ready` and `loading` have none. */
const SCHOOL_STATUS_HINT = {
  'no-key': (t) => t('map.filterSchoolLayerUnavailable'),
  error: (t) => t('map.filterSchoolLayerError'),
};

/**
 * The basemap and overlay switches every map shares, plus the two Denmark-only regional layers
 * (kommune tax choropleth, school grades/inclusion) when the map is showing a Danish context.
 *
 * Presentational on purpose: it owns no state and reports changes as a patch object, so the map can
 * forward one update per user action to a parent that keeps the state somewhere else (the map
 * view's URL, for instance) without the two disagreeing in between.
 *
 * @param {Object} props
 * @param {'STANDARD'|'SATELLITE'} props.style
 * @param {boolean} props.show3dBuildings
 * @param {boolean} props.showTransit
 * @param {(patch: {style?: string, show3dBuildings?: boolean, showTransit?: boolean, taxLayer?: boolean, schoolLayer?: boolean}) => void} props.onChange
 * @param {import('react').ReactNode} [props.transitExtra] - Rendered indented below the transit row
 *   while transit is on, for settings that only mean something once the layer is there.
 * @param {boolean} [props.showRegionalLayers] - Whether the map is showing a Danish context at all;
 *   the two switches below are not offered otherwise. Computed by the caller from the same
 *   `countries` prop `Map.jsx` already takes, the same way DK-only behaviour is scoped elsewhere
 *   (see `lib/types/providerConfig.js`'s `countries` field).
 * @param {boolean} [props.taxLayer]
 * @param {boolean} [props.schoolLayer]
 * @param {'loading'|'ready'|'no-key'|'error'} [props.schoolLayerStatus] - What the school data is
 *   doing. Anything but `ready` disables the switch rather than hiding it, and each says why in its
 *   own words: a missing key and a failed request need different things from the person reading the
 *   tooltip, and `loading` needs nothing at all.
 *   The switch used to take one boolean, which showed "set the API key" for a request that had
 *   merely failed.
 */
export default function MapControls({
  style,
  show3dBuildings,
  showTransit,
  onChange,
  transitExtra = null,
  showRegionalLayers = false,
  taxLayer = false,
  schoolLayer = false,
  schoolLayerStatus = 'ready',
}) {
  const t = useTranslation();

  return (
    <div className="map-panel map-shell__controls">
      <div className="map-panel__row">
        <Text size="small" strong className="map-panel__label">
          {t('map.filterStyleLabel')}
        </Text>
        <Select size="small" value={style} onChange={(value) => onChange({ style: value })} style={{ width: 110 }}>
          <Select.Option value="STANDARD">{t('map.filterStyleStandard')}</Select.Option>
          <Select.Option value="SATELLITE">{t('map.filterStyleSatellite')}</Select.Option>
        </Select>
      </div>

      <div className="map-panel__row">
        <Text size="small" strong className="map-panel__label">
          {t('map.filter3dBuildings')}
        </Text>
        {/* Satellite is raster imagery: there is no building geometry underneath it to extrude. */}
        <Switch
          size="small"
          checked={show3dBuildings}
          onChange={(value) => onChange({ show3dBuildings: value })}
          disabled={style === 'SATELLITE'}
        />
      </div>

      <div className="map-panel__row">
        <Text size="small" strong className="map-panel__label">
          {t('map.filterTransit')}
        </Text>
        <Switch size="small" checked={showTransit} onChange={(value) => onChange({ showTransit: value })} />
      </div>

      {showTransit && transitExtra}

      {showRegionalLayers && (
        <>
          <div className="map-panel__row">
            <Text size="small" strong className="map-panel__label">
              {t('map.filterTaxLayer')}
            </Text>
            <Switch size="small" checked={taxLayer} onChange={(value) => onChange({ taxLayer: value })} />
          </div>

          <div className="map-panel__row">
            <Text size="small" strong className="map-panel__label">
              {t('map.filterSchoolLayer')}
            </Text>
            <Tooltip content={SCHOOL_STATUS_HINT[schoolLayerStatus]?.(t) ?? null} position="left">
              <Switch
                size="small"
                checked={schoolLayer}
                disabled={schoolLayerStatus !== 'ready'}
                onChange={(value) => onChange({ schoolLayer: value })}
              />
            </Tooltip>
          </div>
        </>
      )}
    </div>
  );
}
