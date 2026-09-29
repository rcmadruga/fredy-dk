/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import grocerySvg from '../../assets/map-icons/grocery.svg?raw';
import shopSvg from '../../assets/map-icons/shop.svg?raw';
import { GROCERY_CHAINS } from './groceryFilters.js';

/**
 * The supermarket badges: the chain's logo on a small square chip with a ring in the chain's colour,
 * drawn once per chain and handed to MapLibre as an image so a symbol
 * layer can draw two thousand of them cheaply.
 *
 * Logos live in `assets/map-logos/` (see the README there for where each came from). A chain without
 * a file - Netto, at the moment - gets a badge in its colour with a Maki cart instead (Maki is CC0,
 * `assets/map-icons/`), and the independents a storefront. So the layer always draws something for
 * every chain, and adding a logo is only a matter of adding a file.
 *
 * The rules (which file belongs to which chain, how an SVG is given a size) are plain functions and
 * are tested; drawing needs a browser.
 */

/**
 * Pixel ratio the badges are drawn at. High, because the badge is tiny and a logo in it is a few
 * pixels across: drawn larger and scaled down, it stays legible on a high-density screen and when the
 * map is zoomed in.
 */
export const ICON_PIXEL_RATIO = 4;

/** The badge's size in CSS pixels at full zoom: a square, centred on the store. */
export const CHIP_SIZE = 18;
export const ICON_WIDTH = CHIP_SIZE;
export const ICON_HEIGHT = CHIP_SIZE;

const LOGO_PADDING = 1.5;

/** What a logo sits on unless its chain says otherwise, in the badge and in the legend: white, whatever the theme. */
export const LOGO_TILE_BACKGROUND = '#ffffff';

/** The name a chain's badge is registered under on the map. */
export const iconNameOf = (chainId) => `dk-grocery-${chainId}`;

/** @param {string} svg @returns {string} The `d` of the first path in an SVG document. */
export const pathOf = (svg) => svg.match(/<path[^>]*\sd="([^"]+)"/)?.[1] ?? '';

/** @param {string} filePath @returns {string} `assets/map-logos/rema.svg` -> `rema`. */
export const chainIdOfLogoPath = (filePath) =>
  filePath
    .split('/')
    .pop()
    .replace(/\.[^.]+$/, '');

/**
 * Give an SVG explicit dimensions taken from its viewBox.
 *
 * Several of the logos carry only a viewBox, and an image element loading one of those reports a
 * default size (300 x 150) that has nothing to do with the drawing - which would squash it when it
 * is fitted into the badge.
 *
 * @param {string} svg
 * @returns {string} The same document with `width`/`height` on the root element.
 */
export function withExplicitSize(svg) {
  const root = svg.match(/<svg\b[^>]*>/)?.[0];
  const viewBox = root?.match(/viewBox="\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)\s*"/);
  if (root == null || viewBox == null) return svg;

  const cleaned = root.replace(/\s(width|height)="[^"]*"/g, '');
  return svg.replace(root, cleaned.replace(/<svg\b/, `<svg width="${viewBox[1]}" height="${viewBox[2]}"`));
}

/**
 * The logo files that exist, by chain id. Text for SVGs (so they can be sized), a URL for the rest.
 *
 * @type {Record<string, {svg: string}|{url: string}>}
 */
const LOGOS = (() => {
  const svgs = import.meta.glob('../../assets/map-logos/*.svg', { eager: true, query: '?raw', import: 'default' });
  const rasters = import.meta.glob('../../assets/map-logos/*.png', { eager: true, query: '?url', import: 'default' });
  return {
    ...Object.fromEntries(Object.entries(svgs).map(([file, svg]) => [chainIdOfLogoPath(file), { svg }])),
    ...Object.fromEntries(Object.entries(rasters).map(([file, url]) => [chainIdOfLogoPath(file), { url }])),
  };
})();

/** @param {string} chainId @returns {boolean} Whether this chain has a logo file. */
export const hasLogo = (chainId) => chainId in LOGOS;

/**
 * A URL the browser can show the chain's logo from, for the panel's legend.
 *
 * @param {string} chainId
 * @returns {string|null} Null for a chain without a logo file.
 */
export function logoUrlOf(chainId) {
  const logo = LOGOS[chainId];
  if (logo == null) return null;
  return 'url' in logo
    ? logo.url
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withExplicitSize(logo.svg))}`;
}

/**
 * Which glyph a chain without a logo gets: the storefront for independents, the cart for the rest.
 *
 * @param {string} chainId
 * @returns {string} A path in Maki's 15 x 15 box.
 */
export const glyphFor = (chainId) => pathOf(chainId === 'other' ? shopSvg : grocerySvg);

/**
 * Whether white or near-black reads better on a colour.
 *
 * @param {string} hex `#rrggbb`
 * @returns {string}
 */
export function glyphColorOn(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1f2937' : '#ffffff';
}

/** @param {string} src @returns {Promise<HTMLImageElement>} */
async function loadImage(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

/**
 * The badge outline: a square with slightly rounded corners.
 *
 * @returns {Path2D}
 */
function badgePath() {
  const r = 3;
  const size = CHIP_SIZE;
  const path = new Path2D();
  path.moveTo(r, 0);
  path.lineTo(size - r, 0);
  path.quadraticCurveTo(size, 0, size, r);
  path.lineTo(size, size - r);
  path.quadraticCurveTo(size, size, size - r, size);
  path.lineTo(r, size);
  path.quadraticCurveTo(0, size, 0, size - r);
  path.lineTo(0, r);
  path.quadraticCurveTo(0, 0, r, 0);
  path.closePath();
  return path;
}

/**
 * Draw one chain's badge.
 *
 * @param {{id: string, color: string}} chain
 * @returns {Promise<ImageData>}
 */
async function drawBadge(chain) {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_WIDTH * ICON_PIXEL_RATIO;
  canvas.height = ICON_HEIGHT * ICON_PIXEL_RATIO;
  const context = canvas.getContext('2d');
  context.scale(ICON_PIXEL_RATIO, ICON_PIXEL_RATIO);

  const outline = badgePath();
  const logo = logoUrlOf(chain.id);

  // A logo sits on white, so any of them reads whatever its own colours; the ring carries the chain's
  // colour. Without one the whole badge is in the chain's colour and carries a glyph.
  context.fillStyle = logo == null ? chain.color : (chain.tile ?? LOGO_TILE_BACKGROUND);
  context.fill(outline);
  context.lineJoin = 'round';
  context.lineWidth = 1.5;
  context.strokeStyle = chain.color;
  context.stroke(outline);

  if (logo != null) {
    const image = await loadImage(logo);
    const room = { w: CHIP_SIZE - 2 * LOGO_PADDING, h: CHIP_SIZE - 2 * LOGO_PADDING };
    const scale = Math.min(room.w / image.naturalWidth, room.h / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    context.drawImage(image, (CHIP_SIZE - w) / 2, (CHIP_SIZE - h) / 2, w, h);
  } else {
    const size = 11;
    context.translate((CHIP_SIZE - size) / 2, (CHIP_SIZE - size) / 2);
    context.scale(size / 15, size / 15);
    context.fillStyle = glyphColorOn(chain.color);
    context.fill(new Path2D(glyphFor(chain.id)));
  }

  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** @type {Promise<Map<string, ImageData>>|null} */
let drawn = null;

/**
 * Draw the badges, once. Browser only.
 *
 * @returns {Promise<Map<string, ImageData>>} Badge pixels by icon name.
 */
export function loadGroceryIcons() {
  if (drawn == null) {
    drawn = Promise.all(GROCERY_CHAINS.map(async (chain) => [iconNameOf(chain.id), await drawBadge(chain)]))
      .then((entries) => new Map(entries))
      // A failed attempt must not be remembered: the next call should try again.
      .catch((error) => {
        drawn = null;
        throw error;
      });
  }
  return drawn;
}

/**
 * Register the badges on a map. Idempotent, and needed again after every style change: MapLibre
 * drops custom images along with the sources and layers when the basemap is switched.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {Map<string, ImageData>} icons
 */
export function addGroceryIcons(map, icons) {
  for (const [name, data] of icons) {
    if (!map.hasImage(name)) map.addImage(name, data, { pixelRatio: ICON_PIXEL_RATIO });
  }
}
