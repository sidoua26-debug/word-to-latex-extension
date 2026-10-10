/**
 * pandocWasm.ts — Thin wrapper around the pandoc-wasm core module.
 * Loads the WASM module once and exposes conversion functions.
 */

// Import createPandocInstance directly from pandoc-wasm core
// This bundles the WASI shim and conversion logic cleanly without bundler issues
// @ts-ignore — types are not provided by pandoc-wasm
import { createPandocInstance } from 'pandoc-wasm/src/core.js';
import {
  PandocInstance,
  ConvertInput,
  runPandocConvert,
  type DocxPreprocessOptions,
  type DocxPreprocessMetadata,
  lastDocxPreprocessMetadata,
} from './pandocCore.js';

export {
  PandocInstance,
  ConvertInput,
  runPandocConvert,
  type DocxPreprocessOptions,
  type DocxPreprocessMetadata,
  lastDocxPreprocessMetadata,
};

let pandocInstancePromise: Promise<PandocInstance> | null = null;

/**
 * Lazily initialize and instantiate the pandoc WASM instance once.
 * The wasm binary is bundled in the extension package at `wasm/pandoc.wasm`.
 */
export async function getPandocInstance(): Promise<PandocInstance> {
  if (!pandocInstancePromise) {
    pandocInstancePromise = (async () => {
      try {
        // Resolve extension-relative URL for the bundled wasm binary
        const wasmUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
          ? chrome.runtime.getURL('wasm/pandoc.wasm')
          : 'wasm/pandoc.wasm';

        const response = await fetch(wasmUrl);
        if (!response.ok) {
          throw new Error(`Failed to load pandoc.wasm: HTTP ${response.status} ${response.statusText}`);
        }
        const wasmBuffer = await response.arrayBuffer();
        const instance = await createPandocInstance(wasmBuffer);
        return instance as PandocInstance;
      } catch (err) {
        pandocInstancePromise = null; // Reset so subsequent conversions can retry
        throw err;
      }
    })();
  }
  return pandocInstancePromise;
}

/**
 * General conversion function supporting docx, html, and markdown.
 * Produces a LaTeX fragment (no \documentclass wrapper).
 */
export async function convertToLatex(input: ConvertInput): Promise<string> {
  const pandoc = await getPandocInstance();
  return runPandocConvert(pandoc, input);
}

/**
 * Backwards-compatible wrapper for converting .docx files.
 *
 * @param fileBytes — The raw bytes of the .docx file.
 * @returns The LaTeX output string.
 */
export async function convertDocxToLatex(
  fileBytes: ArrayBuffer,
  options?: DocxPreprocessOptions
): Promise<string> {
  return convertToLatex({ format: 'docx', bytes: fileBytes, options });
}
