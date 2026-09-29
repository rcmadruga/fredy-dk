/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Button, Checkbox, Spin, Switch, Typography } from '@douyinfe/semi-ui-19';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import { GROCERY_CHAINS, hasActiveGroceryFilters } from './groceryFilters.js';
import { LOGO_TILE_BACKGROUND, logoUrlOf } from './groceryIcons.js';
import './SchoolPanel.less';

const { Text } = Typography;

/**
 * Everything about the Denmark supermarket layer: the switch, which chains are shown, and how many
 * stores that leaves. The chain rows double as the legend - each carries the colour its markers have.
 *
 * Shares `SchoolPanel.less`: the rows and the colour dot are the same thing there and here.
 *
 * Unlike the schools, nothing is fetched until the layer is switched on, so the switch is offered
 * from the start. After a failed fetch it stays usable: switching it off and on again retries.
 *
 * @param {Object} props
 * @param {'idle'|'loading'|'ready'|'error'} props.status - What the store data is doing.
 * @param {boolean} props.enabled - Whether the layer is on.
 * @param {(enabled: boolean) => void} props.onEnabledChange
 * @param {import('./groceryFilters.js').GroceryFilters} props.filters
 * @param {(patch: Partial<import('./groceryFilters.js').GroceryFilters>) => void} props.onFiltersChange
 * @param {Record<string, number>} props.counts - Stores per chain, unfiltered.
 * @param {number} props.total - Everything loaded, unfiltered.
 * @param {number} props.shownCount - How many of them the filters leave.
 * @param {() => void} props.onReset
 * @param {boolean} [props.bare=false] - Render without the panel box, for a parent that supplies its own.
 */
export default function GroceryPanel({
  status,
  enabled,
  onEnabledChange,
  filters,
  onFiltersChange,
  counts,
  total,
  shownCount,
  onReset,
  bare = false,
}) {
  const t = useTranslation();
  const ready = status === 'ready';

  const setChain = (id, checked) => onFiltersChange({ chains: { ...filters.chains, [id]: checked } });

  return (
    <div className={bare ? 'map-panel__group school-panel' : 'map-panel school-panel'}>
      <div className="map-panel__row">
        <Text size="small" strong className="map-panel__label">
          {t('map.filterGroceryLayer')}
        </Text>
        <Switch size="small" aria-label={t('map.filterGroceryLayer')} checked={enabled} onChange={onEnabledChange} />
      </div>

      {enabled && status === 'error' && (
        <div className="map-panel__row school-panel__summary">
          <Text size="small" type="danger">
            {t('map.filterGroceryLayerError')}
          </Text>
        </div>
      )}

      {enabled && status === 'loading' && (
        <div className="map-panel__row school-panel__summary">
          <Text size="small" type="tertiary">
            {t('map.groceryLoading')}
          </Text>
          <Spin size="small" />
        </div>
      )}

      {enabled && ready && (
        <>
          <div className="map-panel__row school-panel__summary">
            <Text size="small" type="tertiary">
              {t('map.groceryShowing', { shown: shownCount, total })}
            </Text>
            {hasActiveGroceryFilters(filters) && (
              <Button size="small" theme="borderless" onClick={onReset}>
                {t('map.groceryResetFilters')}
              </Button>
            )}
          </div>

          <div className="school-panel__section">
            <Text size="small" strong className="map-panel__label">
              {t('map.groceryChainTitle')}
            </Text>
            {GROCERY_CHAINS.filter((chain) => (counts?.[chain.id] ?? 0) > 0).map((chain) => (
              <Checkbox
                key={chain.id}
                checked={filters.chains[chain.id] !== false}
                onChange={(event) => setChain(chain.id, event.target.checked)}
              >
                <span className="school-panel__kind">
                  {/* The chain's logo where there is one, else the colour of its pins. */}
                  {logoUrlOf(chain.id) ? (
                    <img
                      className="school-panel__logo"
                      src={logoUrlOf(chain.id)}
                      alt=""
                      style={{ borderColor: chain.color, background: chain.tile ?? LOGO_TILE_BACKGROUND }}
                    />
                  ) : (
                    <span className="school-panel__dot" style={{ background: chain.color }} aria-hidden="true" />
                  )}
                  {t(`map.groceryChain.${chain.id}`)} ({counts[chain.id]})
                </span>
              </Checkbox>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

GroceryPanel.displayName = 'GroceryPanel';
