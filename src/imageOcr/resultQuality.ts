/**
 * resultQuality.ts — Analyzes OCR results to determine honest confidence,
 * quality classifications, and diagnostic warnings for manual user review.
 */

import type { RecognitionQuality, RecognitionWarning } from './types.ts';
import type { OcrResultData } from './mathParser.ts';

export interface QualityAnalysis {
  quality: RecognitionQuality;
  confidence: number;
  warnings: RecognitionWarning[];
  hasMath: boolean;
}

/**
 * Assesses the quality and reliability of OCR text and mathematical structures.
 */
export function assessQuality(ocrData: OcrResultData, generatedLatex: string): QualityAnalysis {
  const confidence = Math.round(ocrData.confidence || 0);
  const warnings: RecognitionWarning[] = [];

  const text = ocrData.text || '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Check for common math symbols
  const hasMathSymbols = /[=≠<>≤≥\+\-\*\/\\^_{}\(\)\[\]√∫∑∏α-ωΑ-Ω]/.test(text);
  const hasLatexMath = generatedLatex.includes('\\[') || generatedLatex.includes('\\begin{');

  // Check for potential unhandled 2D math layouts
  const hasRadicalOrIntegral = /[√∫∑∏]/.test(text) || /\b(int|sum|prod|sqrt)\b/i.test(text);
  const hasMatrixLike = /^[\[\(].*[\]\)]$/.test(text) && lines.length >= 2;

  // Check for empty text or empty latex
  if (!text.trim() || !generatedLatex.trim()) {
    warnings.push({
      message: 'No text recognized: crop to the content, enlarge the image, and avoid screenshots with large empty margins',
    });
  }

  // 1. Confidence evaluation
  if (confidence < 50) {
    warnings.push({
      message: `Low OCR recognition confidence (${confidence}%). Image may be blurry, low-resolution, or handwritten.`,
      suggestion: 'Please verify the output carefully against your original source.',
    });
  } else if (confidence < 75) {
    warnings.push({
      message: `Moderate recognition confidence (${confidence}%). Some characters or mathematical symbols may require correction.`,
    });
  }

  // 2. 2D Math heuristic warnings
  if (hasRadicalOrIntegral) {
    warnings.push({
      message: 'Complex mathematical operators (integrals, summations, or radicals) detected.',
      suggestion: 'Tesseract 1D OCR cannot reliably reconstruct 2D limits or radical scopes; please check equation boundaries.',
    });
  }

  if (hasMatrixLike && !generatedLatex.includes('\\begin{pmatrix}') && !generatedLatex.includes('\\begin{bmatrix}')) {
    warnings.push({
      message: 'Matrix or multi-row layout detected but could not be parsed into a clean grid.',
      suggestion: 'You may need to manually format into \\begin{pmatrix} ... \\end{pmatrix}.',
    });
  }

  // 3. Question mark / garbled character checks
  const questionMarks = (text.match(/\?/g) || []).length;
  if (questionMarks >= 1) {
    warnings.push({
      message: 'Unrecognized characters detected as "?" in the OCR output.',
      suggestion: 'Check exponents, indices, or special mathematical glyphs.',
    });
  }

  // Check for isolated vertical limits/indices (e.g. single digit lines around math operators)
  const singleCharLines = lines.filter(l => l.length === 1 && /[0-9a-zA-Z]/.test(l));
  if (singleCharLines.length >= 2 && lines.length >= 3) {
    warnings.push({
      message: 'Stacked vertical characters detected. May represent integral/summation limits or matrix elements.',
      suggestion: 'Tesseract line segmentation often splits upper/lower limits onto separate lines.',
    });
  }

  // 4. Quality grading
  let quality: RecognitionQuality = 'high';
  if (confidence < 60 || warnings.length >= 2) {
    quality = 'uncertain';
  } else if (confidence < 75 || warnings.length === 1) {
    quality = 'medium';
  } else {
    quality = 'high';
  }

  return {
    quality,
    confidence,
    warnings,
    hasMath: hasMathSymbols || hasLatexMath,
  };
}

/**
 * Prepend transparent diagnostic comments to the LaTeX output if warnings exist.
 */
export function attachQualityHeaders(
  latex: string,
  quality: RecognitionQuality,
  confidence: number,
  warnings: RecognitionWarning[]
): string {
  if (warnings.length === 0 && quality === 'high') {
    return latex;
  }

  const commentLines: string[] = [
    `% === Recognition Quality: ${quality.toUpperCase()} (${confidence}%) ===`,
  ];

  for (const w of warnings) {
    commentLines.push(`% [Warning] ${w.message}`);
    if (w.suggestion) {
      commentLines.push(`%   Suggestion: ${w.suggestion}`);
    }
  }

  commentLines.push('% ==========================================\n');

  return commentLines.join('\n') + '\n' + latex;
}
