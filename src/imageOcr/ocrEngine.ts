/**
 * ocrEngine.ts — Modular Offline Image Recognition Engine.
 * Implements ImageRecognitionEngine interface to decouple Tesseract from
 * mathematical structure parsing and LaTeX generation.
 *
 * Runs 100% offline using bundled local WebAssembly and language models.
 * Fault-isolated: errors never propagate to DOCX or text conversions.
 */

import { createWorker, type Worker } from 'tesseract.js';
import { parseOcrToLatex } from './mathParser.ts';
import type { OcrResultData } from './mathParser.ts';
import { detectAndParseTable } from './tableParser.ts';
import { formatLatexOutput } from './latexGenerator.ts';
import type {
  ImageRecognitionEngine,
  RecognitionResult,
  RecognitionOptions,
} from './types.ts';
import { assessQuality, attachQualityHeaders } from './resultQuality.ts';

let tesseractWorkerPromise: Promise<Worker> | null = null;

export type ProgressCallback = (statusText: string, progress: number) => void;

/**
 * Lazily creates and initializes an offline Tesseract worker instance.
 */
export async function getTesseractWorker(onProgress?: ProgressCallback): Promise<Worker> {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      try {
        const isExtension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.getURL);

        let options: Record<string, unknown> = {
          cacheMethod: 'none',
          gzip: true,
        };

        if (isExtension) {
          options = {
            ...options,
            workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
            corePath: chrome.runtime.getURL('vendor/tesseract/tesseract-core-lstm.wasm.js'),
            langPath: chrome.runtime.getURL('tessdata'),
            workerBlobURL: false, // Disallow blob worker in Manifest V3
          };
        } else {
          // Node.js test environment
          options = {
            ...options,
            langPath: 'assets/tessdata',
          };
        }

        const worker = await createWorker(['eng', 'fra'], 1, options);
        return worker;
      } catch (err) {
        tesseractWorkerPromise = null; // Allow retry on failure
        throw new Error(`Failed to initialize offline OCR engine: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }

  return tesseractWorkerPromise;
}

/**
 * Terminates the active worker instance (crucial for cleaning up Node worker threads).
 */
export async function terminateTesseractWorker(): Promise<void> {
  if (tesseractWorkerPromise) {
    const worker = await tesseractWorkerPromise;
    tesseractWorkerPromise = null;
    await worker.terminate();
  }
}

/**
 * Default offline implementation using Tesseract.js (eng+fra).
 * Pluggable: can be replaced by an ONNX/WASM math transformer engine in the future.
 */
function extractLines(data: any): any[] {
  const lines: any[] = [];
  if (data.blocks && data.blocks.length > 0) {
    for (const block of data.blocks) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) {
          lines.push({
            text: line.text,
            confidence: line.confidence,
            bbox: line.bbox,
            words: line.words?.map((w: any) => ({
              text: w.text,
              confidence: w.confidence,
              bbox: w.bbox,
              symbols: w.symbols?.map((s: any) => ({
                text: s.text,
                confidence: s.confidence,
                bbox: s.bbox,
              })),
            })),
          });
        }
      }
    }
  } else if (data.lines && data.lines.length > 0) {
    for (const line of data.lines) {
      lines.push({
        text: line.text,
        confidence: line.confidence,
        bbox: line.bbox,
        words: line.words?.map((w: any) => ({
          text: w.text,
          confidence: w.confidence,
          bbox: w.bbox,
          symbols: w.symbols?.map((s: any) => ({
            text: s.text,
            confidence: s.confidence,
            bbox: s.bbox,
          })),
        })),
      });
    }
  }
  return lines;
}

function cropAndPadCanvas(srcCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = srcCanvas.getContext('2d');
  if (!ctx) return srcCanvas;
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  if (w === 0 || h === 0) return srcCanvas;

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      const alphaFactor = a / 255;
      const effectiveR = r * alphaFactor + 255 * (1 - alphaFactor);
      const effectiveG = g * alphaFactor + 255 * (1 - alphaFactor);
      const effectiveB = b * alphaFactor + 255 * (1 - alphaFactor);

      if (effectiveR < 240 || effectiveG < 240 || effectiveB < 240) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return srcCanvas;
  }

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const scale = 1.5;
  const pad = 20;

  const scaledW = Math.round(cropW * scale);
  const scaledH = Math.round(cropH * scale);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = scaledW + pad * 2;
  outCanvas.height = scaledH + pad * 2;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return srcCanvas;

  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.fillStyle = '#ffffff';
  outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);
  outCtx.drawImage(srcCanvas, minX, minY, cropW, cropH, pad, pad, scaledW, scaledH);

  return outCanvas;
}

/**
 * Preprocesses an image for retry when initial recognition confidence is low.
 * Flattens alpha onto white, crops margins to the content bounding box, scales 1.5x, and adds 20px padding.
 */
export async function preprocessRetryImage(
  imageSource: string | HTMLCanvasElement | Uint8Array
): Promise<string | HTMLCanvasElement | Uint8Array> {
  if (typeof window === 'undefined') {
    try {
      const helperMod = './imagePreprocessNode.js';
      const helper = await import(helperMod);
      return await helper.preprocessWithSharp(imageSource);
    } catch {
      try {
        const helperModTs = './imagePreprocessNode.ts';
        const helper = await import(helperModTs);
        return await helper.preprocessWithSharp(imageSource);
      } catch {
        return imageSource;
      }
    }
  }

  if (typeof document === 'undefined') return imageSource;

  try {
    let canvas: HTMLCanvasElement;
    if (typeof HTMLCanvasElement !== 'undefined' && imageSource instanceof HTMLCanvasElement) {
      canvas = imageSource;
    } else {
      let srcUrl: string;
      let revoke = false;
      if (typeof imageSource === 'string') {
        srcUrl = imageSource;
      } else if (imageSource instanceof Uint8Array) {
        const blob = new Blob([imageSource as any], { type: 'image/png' });
        srcUrl = URL.createObjectURL(blob);
        revoke = true;
      } else {
        return imageSource;
      }

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = srcUrl;
      });

      if (revoke) {
        URL.revokeObjectURL(srcUrl);
      }

      canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return imageSource;
      ctx.drawImage(img, 0, 0);
    }

    return cropAndPadCanvas(canvas);
  } catch {
    return imageSource;
  }
}

/**
 * Default offline implementation using Tesseract.js (eng+fra).
 * Pluggable: can be replaced by an ONNX/WASM math transformer engine in the future.
 */
export class TesseractRecognitionEngine implements ImageRecognitionEngine {
  readonly id = 'tesseract-v7';
  readonly name = 'Tesseract.js OCR (eng + fra)';

  async recognize(
    imageSource: string | HTMLCanvasElement | Uint8Array,
    options: RecognitionOptions
  ): Promise<RecognitionResult> {
    const { onProgress } = options;

    onProgress?.('Initializing recognition engine...', 0.1);
    const worker = await getTesseractWorker(onProgress);

    onProgress?.('Recognizing text and characters...', 0.3);
    const recognizeParams: Record<string, string> = {};
    if (options.psm) {
      recognizeParams.tessedit_pageseg_mode = options.psm;
    }
    const result = await worker.recognize(imageSource as any, recognizeParams, { blocks: true });

    onProgress?.('Analyzing structure and equations...', 0.8);

    let rawText = result.data.text || '';
    const lines = extractLines(result.data);

    const ocrData: OcrResultData = {
      text: rawText,
      confidence: result.data.confidence || 0,
      lines: lines.length > 0 ? lines : undefined,
    };

    // 1. Table structure detection
    const tableCheck = detectAndParseTable(ocrData);
    let bodyContent = '';
    const isTable = tableCheck.isTable && Boolean(tableCheck.latex);

    if (isTable && tableCheck.latex) {
      bodyContent = tableCheck.latex;
    } else {
      // 2. Math expression & text parsing
      bodyContent = parseOcrToLatex(ocrData);
    }

    const emptyWarningMsg = 'No text recognized: crop to the content, enlarge the image, and avoid screenshots with large empty margins';
    if (!rawText.trim() || !bodyContent.trim()) {
      bodyContent = `% ${emptyWarningMsg}`;
    }

    // 3. Quality & honesty assessment
    const qualityAnalysis = assessQuality(ocrData, bodyContent);

    // 4. Attach diagnostic headers if uncertainty or warnings exist
    const annotatedBody = attachQualityHeaders(
      bodyContent,
      qualityAnalysis.quality,
      qualityAnalysis.confidence,
      qualityAnalysis.warnings
    );

    // 5. Format into Fragment or Complete Document
    const formattedLatex = formatLatexOutput(annotatedBody, options);

    onProgress?.('Complete', 1.0);

    return {
      engine: this.id,
      rawText,
      latex: formattedLatex,
      confidence: qualityAnalysis.confidence,
      quality: qualityAnalysis.quality,
      warnings: qualityAnalysis.warnings,
      isTable,
      hasMath: qualityAnalysis.hasMath,
    };
  }
}

// Active singleton engine instance
let activeEngine: ImageRecognitionEngine = new TesseractRecognitionEngine();

export function setRecognitionEngine(engine: ImageRecognitionEngine) {
  activeEngine = engine;
}

export function getActiveRecognitionEngine(): ImageRecognitionEngine {
  return activeEngine;
}

/**
 * Combined selection rule: keeps the candidate if it has higher confidence
 * AND is not shorter by more than 30% compared to baseline.
 * If one has text and the other is empty, keeps the non-empty result.
 */
export function pickBestRecognition(
  resA: RecognitionResult,
  resB: RecognitionResult
): RecognitionResult {
  const lenA = resA.rawText?.trim().length || 0;
  const lenB = resB.rawText?.trim().length || 0;

  if (lenA === 0 && lenB > 0) return resB;
  if (lenB === 0 && lenA > 0) return resA;
  if (lenA === 0 && lenB === 0) return resA.confidence >= resB.confidence ? resA : resB;

  if (resA.confidence > resB.confidence) {
    if (lenA >= lenB * 0.7) {
      return resA;
    }
    return resB;
  } else if (resB.confidence > resA.confidence) {
    if (lenB >= lenA * 0.7) {
      return resB;
    }
    return resA;
  } else {
    return lenB > lenA ? resB : resA;
  }
}

/**
 * Top-level conversion helper delegating to active ImageRecognitionEngine.
 * If first pass returns empty text or confidence < 60 ("uncertain" threshold),
 * retries on a flattened, cropped, 1.5x scaled, padded image with BOTH PSM 3 and PSM 4,
 * keeping the best result by the combined rule.
 */
export async function convertImageToLatex(
  imageSource: string | HTMLCanvasElement | Uint8Array,
  options: RecognitionOptions
): Promise<RecognitionResult> {
  const firstResult = await activeEngine.recognize(imageSource, options);

  // If first pass returns empty text or confidence < 60 ("uncertain" threshold),
  // retry with auto PSM 3 and PSM 4 on a flattened, cropped, padded, scaled image
  if (!firstResult.rawText?.trim() || firstResult.confidence < 60) {
    try {
      options.onProgress?.('Retrying with auto segmentation and cropped padding...', 0.5);
      const retrySource = await preprocessRetryImage(imageSource);

      const retry3 = await activeEngine.recognize(retrySource, { ...options, psm: '3' });
      const retry4 = await activeEngine.recognize(retrySource, { ...options, psm: '4' });

      const bestRetry = pickBestRecognition(retry3, retry4);
      return pickBestRecognition(firstResult, bestRetry);
    } catch {
      // Keep firstResult if retry fails
    }
  }

  return firstResult;
}
