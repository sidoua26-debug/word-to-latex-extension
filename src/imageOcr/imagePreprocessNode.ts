/**
 * imagePreprocessNode.ts — Node.js-only image preprocessing using Sharp.
 * Kept in a separate file and loaded via variable dynamic import so that esbuild
 * never bundles Sharp or its C++ native dependencies into browser extension builds.
 */

import sharp from 'sharp';

export async function preprocessWithSharp(
  imageSource: string | Uint8Array
): Promise<Uint8Array> {
  return sharp(imageSource as any)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .trim({ threshold: 10 })
    .extend({ top: 20, bottom: 20, left: 20, right: 20, background: { r: 255, g: 255, b: 255 } })
    .toBuffer();
}
