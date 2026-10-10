/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import proj4 from 'proj4';

/**
 * ETRS89 / UTM zone 32N (EPSG:25832), the grid Danish registers publish coordinates in: metres east
 * and north, so distances are plain Pythagoras. ETRS89 and WGS84 differ by well under a metre in
 * Denmark, so no datum shift is applied.
 */
const EPSG_25832 = '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

const converter = proj4(EPSG_25832, 'WGS84');

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {{east: number, north: number}} Metres in EPSG:25832.
 */
export function toEtrs89(lat, lng) {
  const [east, north] = converter.inverse([lng, lat]);
  return { east, north };
}

/**
 * @param {number} east Metres in EPSG:25832.
 * @param {number} north
 * @returns {{lat: number, lng: number}}
 */
export function fromEtrs89(east, north) {
  const [lng, lat] = converter.forward([east, north]);
  return { lat, lng };
}
