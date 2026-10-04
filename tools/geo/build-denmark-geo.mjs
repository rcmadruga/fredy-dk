/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/* eslint-disable no-console */

/**
 * Generates the bundled Danish geography in `lib/services/geo/data/`:
 *
 *   kommuner.geojson  the 98 kommuner, WGS84, simplified for a browser
 *   postnumre.json    every postcode: name, centroid, and the kommune(r) it lies in
 *
 * Why a build step and not a service: DAWA, which the app used to ask for both, was shut down in
 * October 2026. The boundaries change a few times a year at most, so they are generated here once,
 * committed, and read from disk at run time - there is no request that can fail.
 *
 * Source: DAGI (Danmarks Administrative Geografiske Inddeling, Klimadatastyrelsen), read from the
 * datagrundlag.dk mirror, which publishes dated GeoParquet / FlatGeobuf snapshots of the Datafordeler
 * registers in a public bucket. The mirror is unofficial and has no guarantee, which is exactly why
 * the app never reads it: only this script does, and the snapshot is pinned below. If the mirror is
 * gone, the same registers are on Datafordeler (https://datafordeler.dk), and `loadFeatures` is the
 * only function that would need to change.
 *
 *   node tools/geo/build-denmark-geo.mjs            # fetch (cached), build, write
 *   node tools/geo/build-denmark-geo.mjs --inspect  # print the properties of each source and stop
 *   --snapshot=YYYY-MM-DD   use another DAGI snapshot   --cache=DIR   where downloads are kept
 *
 * Dev dependencies: flatgeobuf (reader), proj4 (EPSG:25832 -> WGS84), @turf/centroid.
 */

import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geojson } from 'flatgeobuf';
import proj4 from 'proj4';
import simplify from '@turf/simplify';
import centroid from '@turf/centroid';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { KOMMUNE_SIMPLIFY_TOLERANCE } from '../../lib/services/regionalData/constants.js';

const BUCKET = 'https://datagrundlag.s3.eu-west-1.amazonaws.com/filer/dk/schema=dagi';
const DEFAULT_SNAPSHOT = '2026-09-27';
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../lib/services/geo/data');

/** The only kommune DAGI carries that has no council and no tax rate; it is not a kommune for our purposes. */
const EXCLUDED_KOMMUNER = new Set(['0411']);

/** Coordinates are written to 5 decimals (about a metre), which is far finer than the simplification. */
const DECIMALS = 5;

/**
 * Points tried per axis when deciding which kommune(r) a postcode belongs to. A postcode polygon can
 * reach out over water (harbours, Fanø's Wadden Sea side), so one that finds no land at the coarse
 * density is tried again at the fine one.
 */
const SAMPLES_PER_AXIS = [12, 48];

proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const snapshot = args.snapshot || DEFAULT_SNAPSHOT;
const cacheDir = args.cache || path.join(os.tmpdir(), 'fredy-geo');

/**
 * Finds the FlatGeobuf asset of a relation's snapshot through its STAC item, downloads it into the
 * cache (once), and returns the local path.
 *
 * @param {string} relation e.g. `kommuneinddeling`
 * @returns {Promise<string>}
 */
async function download(relation) {
  const base = `${BUCKET}/relation=${relation}/_gc2_snapshot_date=${snapshot}`;
  const itemRes = await fetch(`${base}/item.json`);
  if (!itemRes.ok) throw new Error(`No ${relation} snapshot for ${snapshot} (${itemRes.status}) at ${base}/item.json`);
  const item = await itemRes.json();
  const asset = item.assets.flatgeobuf;
  if (!asset) throw new Error(`${relation} snapshot ${snapshot} has no FlatGeobuf asset`);
  const file = path.join(cacheDir, `${relation}-${snapshot}-${path.basename(asset.href)}`);
  if (existsSync(file)) return file;
  await mkdir(cacheDir, { recursive: true });
  console.log(`downloading ${relation} ...`);
  const res = await fetch(new URL(asset.href, `${base}/`));
  if (!res.ok) throw new Error(`Download of ${relation} failed with ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  return file;
}

/**
 * Reads every feature of a FlatGeobuf file as GeoJSON, still in the source projection.
 *
 * @param {string} relation
 * @returns {Promise<Array<import('geojson').Feature>>}
 */
async function loadFeatures(relation) {
  const file = await download(relation);
  const stream = Readable.toWeb(createReadStream(file));
  const features = [];
  for await (const feature of geojson.deserialize(stream)) features.push(feature);
  return features;
}

/** Maps a ring/line/polygon coordinate tree from EPSG:25832 to WGS84, rounded. */
function toWgs84(coords) {
  if (typeof coords[0] === 'number') {
    const [lng, lat] = proj4('EPSG:25832', 'WGS84', [coords[0], coords[1]]);
    return [Number(lng.toFixed(DECIMALS)), Number(lat.toFixed(DECIMALS))];
  }
  return coords.map(toWgs84);
}

function reproject(feature) {
  return { ...feature, geometry: { ...feature.geometry, coordinates: toWgs84(feature.geometry.coordinates) } };
}

/** Pads a kommune code to the 4 digits the rest of the app uses. */
const kode = (v) => String(v).padStart(4, '0');

/** @returns {Array<[number, number, number, number]>} bbox of a (Multi)Polygon's outer rings */
function bboxOf(geometry) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      minX = Math.min(minX, c[0]);
      maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]);
      maxY = Math.max(maxY, c[1]);
    } else c.forEach(visit);
  };
  visit(geometry.coordinates);
  return [minX, minY, maxX, maxY];
}

/**
 * Which kommuner a postcode area lies in, and how much of it each: a lattice of points over its
 * bounding box, kept where they fall inside the postcode, each assigned to the kommune containing it.
 * Exact intersection areas would say the same to within a few percent, and a kommune that holds a
 * sliver of a postcode is not interesting either way.
 */
function kommunerOfPostcode(postcode, kommuner) {
  const [minX, minY, maxX, maxY] = bboxOf(postcode.geometry);
  let result = { inside: 0, shares: [] };
  for (const n of SAMPLES_PER_AXIS) {
    const tally = new Map();
    let inside = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const point = [minX + ((i + 0.5) / n) * (maxX - minX), minY + ((j + 0.5) / n) * (maxY - minY)];
        if (!booleanPointInPolygon(point, postcode)) continue;
        inside++;
        const hit = kommuner.find((k) => inBox(point, k.bbox) && booleanPointInPolygon(point, k.feature));
        if (hit) tally.set(hit.code, (tally.get(hit.code) || 0) + 1);
      }
    }
    // Share is of the land found, so a postcode that is mostly sea still adds up to 1.
    const landed = [...tally.values()].reduce((a, b) => a + b, 0);
    result = {
      inside,
      shares: [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, share: Number((count / landed).toFixed(2)) })),
    };
    if (result.shares.length) break;
  }
  return result;
}

/**
 * Last resort for a postcode area that holds no land at all (Hvide Sande's is the harbour and sea
 * off it): the kommune with a boundary vertex closest to the area's centre. Marked `nearest` in the
 * output so it is never mistaken for a measured membership.
 */
function nearestKommune(point, kommuner) {
  let best = null;
  for (const k of kommuner) {
    const visit = (c) => {
      if (typeof c[0] === 'number') {
        const d = (c[0] - point[0]) ** 2 + (c[1] - point[1]) ** 2;
        if (!best || d < best.d) best = { d, code: k.code };
      } else c.forEach(visit);
    };
    visit(k.feature.geometry.coordinates);
  }
  return best.code;
}

const inBox = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

async function main() {
  const rawKommuner = await loadFeatures('kommuneinddeling');
  const rawPostnumre = await loadFeatures('postnummerinddeling');

  if (args.inspect) {
    for (const [name, list] of [['kommuneinddeling', rawKommuner], ['postnummerinddeling', rawPostnumre]]) {
      console.log(`\n${name}: ${list.length} features, geometry ${list[0].geometry.type}`);
      console.log(JSON.stringify(list[0].properties, null, 1));
    }
    return;
  }

  // --- kommuner -------------------------------------------------------------------------------
  const kommuner = rawKommuner
    .filter((f) => !f.properties.udenforkommuneinddeling)
    .map((f) => ({ code: kode(f.properties.kommunekode), name: f.properties.navn, feature: reproject(f) }))
    .filter((k) => !EXCLUDED_KOMMUNER.has(k.code) && /^\d{4}$/.test(k.code));
  console.log(`kommuner: ${kommuner.length} (of ${rawKommuner.length} rows)`);
  if (kommuner.length !== 98) throw new Error(`expected 98 kommuner, got ${kommuner.length} - check the exclusion and the source`);
  for (const k of kommuner) k.bbox = bboxOf(k.feature.geometry);

  const kommunerOut = {
    type: 'FeatureCollection',
    attribution: 'Contains data from Klimadatastyrelsen, DAGI (Danmarks Administrative Geografiske Inddeling)',
    snapshot,
    features: kommuner
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((k) => {
        const s = simplify(k.feature, { tolerance: KOMMUNE_SIMPLIFY_TOLERANCE, highQuality: false });
        return { type: 'Feature', properties: { code: k.code, name: k.name }, geometry: s.geometry };
      }),
  };

  // --- postnumre ------------------------------------------------------------------------------
  const postnumre = {};
  const skipped = [];
  for (const raw of rawPostnumre) {
    const zip = String(raw.properties.postnummer).padStart(4, '0');
    const feature = reproject(raw);
    const { inside, shares } = kommunerOfPostcode(feature, kommuner);
    const [lng, lat] = centroid(feature).geometry.coordinates;
    const nearest = !shares.length;
    if (nearest) skipped.push(`${zip} ${raw.properties.navn} (${inside} samples inside, none on land)`);
    postnumre[zip] = {
      name: raw.properties.navn,
      lat: Number(lat.toFixed(DECIMALS)),
      lng: Number(lng.toFixed(DECIMALS)),
      kommuner: nearest ? [{ code: nearestKommune([lng, lat], kommuner), share: 1 }] : shares,
      ...(nearest ? { nearest: true } : {}),
      ...(raw.properties.ergadepostnummer ? { street: true } : {}),
    };
  }
  console.log(`postnumre: ${Object.keys(postnumre).length} written, ${skipped.length} placed by nearest kommune`);
  if (skipped.length) console.log('  nearest-kommune fallback for:', skipped.join('; '));

  await mkdir(OUT_DIR, { recursive: true });
  const kPath = path.join(OUT_DIR, 'kommuner.geojson');
  const pPath = path.join(OUT_DIR, 'postnumre.json');
  await writeFile(kPath, JSON.stringify(kommunerOut));
  await writeFile(pPath, JSON.stringify({ snapshot, attribution: kommunerOut.attribution, postnumre }));
  for (const p of [kPath, pPath]) console.log(p, ((await stat(p)).size / 1024).toFixed(0), 'KB');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
