/**
 * resultQuality.ts — Analyzes OCR results to determine honest confidence,
 * quality classifications, and diagnostic warnings for manual user review.
 */

import type { RecognitionQuality, RecognitionWarning } from './types.ts';
import type { OcrResultData } from './mathParser.ts';
import { isTableRowPattern } from './mathParser.ts';

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

  // 2. Numeric honesty evaluation
  // Restrict to cases where the text has multiple lines with decimal-like numbers
  // or digit groups (e.g. tabular decimal ranges like 1.88 - 7.29) and confidence < 85.
  // Excludes math formulas with simple integers (x^2, 2x+1) and prose paragraphs.
  const isDecimalOrGroupedLine = (line: string): boolean => {
    return /\d+[\.,]\d+/.test(line) || /(?:^|\D)\d{3,}(?:\D|$)/.test(line) || /\d+[\.,]\d+\s*[-–]\s*\d+[\.,]\d+/.test(line);
  };
  const decimalOrGroupedLines = lines.filter(isDecimalOrGroupedLine);
  const hasMultipleNumericLines = decimalOrGroupedLines.length >= 2;

  if (hasMultipleNumericLines && confidence < 85) {
    warnings.push({
      message: 'Numbers may be misread (decimal points, 1/7, 0/O, 5/S): verify every value against the source.',
    });
  }

  // Check for missing decimal anomaly: 3+ digit number next to neighbouring lines using decimals
  let hasMissingDecimalAnomaly = false;
  for (let i = 0; i < lines.length; i++) {
    const has3PlusDigits = /(?:^|\D)\d{3,}(?:\D|$)/.test(lines[i]) && !/\d+\.\d+/.test(lines[i]);
    if (has3PlusDigits) {
      const prevHasDecimal = i > 0 && /\d+\.\d+/.test(lines[i - 1]);
      const nextHasDecimal = i < lines.length - 1 && /\d+\.\d+/.test(lines[i + 1]);
      if (prevHasDecimal || nextHasDecimal) {
        hasMissingDecimalAnomaly = true;
        break;
      }
    }
  }
  if (hasMissingDecimalAnomaly) {
    warnings.push({
      message: 'Potential missing decimal points detected: 3+ digit sequence appears adjacent to decimal values (e.g. 077 next to 0.94).',
      suggestion: 'Check numbers carefully against the source image for dropped decimal points.',
    });
  }

  // Check for table rows that were not reconstructed into a tabular grid
  const tableRowLines = lines.filter(isTableRowPattern);
  if (tableRowLines.length >= 2 && !generatedLatex.includes('\\begin{tabular}') && !generatedLatex.includes('\\begin{table}')) {
    warnings.push({
      message: 'Table structure detected but tables are not reconstructed; lines are preserved as plain text.',
      suggestion: 'You may need to manually format rows into a \\begin{tabular} environment.',
    });
  }

  // 3. 2D Math heuristic warnings
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

  // 4. Question mark / garbled character checks
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

  // 5. Quality grading
  let quality: RecognitionQuality = 'high';
  if (confidence < 60 || warnings.length >= 2) {
    quality = 'uncertain';
  } else if (confidence < 75 || warnings.length === 1) {
    quality = 'medium';
  } else {
    quality = 'high';
  }

  // Cap quality at medium if text contains multiple decimal/grouped numeric lines and confidence < 85
  if (hasMultipleNumericLines && confidence < 85 && quality === 'high') {
    quality = 'medium';
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
