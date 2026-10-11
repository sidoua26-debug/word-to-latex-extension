/**
 * imageOcr.test.ts — Comprehensive tests for the Image to LaTeX feature.
 * Tests:
 * 1. Image validation (format, size limits)
 * 2. Math parser (Greek, operators, exponents, fractions, roots, matrices, systems)
 * 3. Table parser (markdown tables, multi-column ASCII to booktabs)
 * 4. LaTeX generator (Mode 1 fragment vs Mode 2 document, figure embedding, French babel)
 * 5. Offline Tesseract engine end-to-end OCR on real image fixtures
 * 6. Playwright UI scenario tests for Image tab
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

import {
  validateImageFile,
  MAX_IMAGE_SIZE_BYTES,
} from '../src/imageOcr/imagePreprocess.ts';
import {
  replaceMathSymbols,
  parseFractionsInLine,
  parseStackedFractions,
  parseMatrix,
  parseCases,
  parseAlignedEquations,
  parseOcrToLatex,
  reconstructStackedIntegrals,
  isMathExpression,
  classifyWordSymbols,
  applySpatialSuperSubscripts,
  escapeProseDollarSigns,
  type OcrWord,
  type OcrLine,
  type OcrResultData,
} from '../src/imageOcr/mathParser.ts';
import sharp from 'sharp';
import { detectAndParseTable } from '../src/imageOcr/tableParser.ts';
import { formatLatexOutput } from '../src/imageOcr/latexGenerator.ts';
import {
  convertImageToLatex,
  terminateTesseractWorker,
  setRecognitionEngine,
  getActiveRecognitionEngine,
} from '../src/imageOcr/ocrEngine.ts';
import type { ImageRecognitionEngine } from '../src/imageOcr/types.ts';
import { assessQuality } from '../src/imageOcr/resultQuality.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_POPUP_PATH = 'file://' + path.resolve(__dirname, '../dist/popup.html');
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const REAL_FIXTURES_DIR = path.resolve(FIXTURES_DIR, 'real');

describe('Image Preprocessing & Validation', () => {
  it('validates supported image formats (PNG, JPG, WEBP, BMP)', () => {
    const pngFile = { name: 'formula.png', type: 'image/png', size: 1024 } as unknown as File;
    const jpgFile = { name: 'scan.jpg', type: 'image/jpeg', size: 2048 } as unknown as File;
    const webpFile = { name: 'diagram.webp', type: 'image/webp', size: 4096 } as unknown as File;
    const bmpFile = { name: 'math.bmp', type: 'image/bmp', size: 8192 } as unknown as File;

    assert.equal(validateImageFile(pngFile).valid, true);
    assert.equal(validateImageFile(jpgFile).valid, true);
    assert.equal(validateImageFile(webpFile).valid, true);
    assert.equal(validateImageFile(bmpFile).valid, true);
  });

  it('rejects unsupported file formats', () => {
    const pdfFile = { name: 'doc.pdf', type: 'application/pdf', size: 1024 } as unknown as File;
    const docxFile = { name: 'doc.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1024 } as unknown as File;
    const txtFile = { name: 'note.txt', type: 'text/plain', size: 1024 } as unknown as File;

    const resPdf = validateImageFile(pdfFile);
    assert.equal(resPdf.valid, false);
    assert.ok(resPdf.error?.includes('Unsupported image format'));

    const resDocx = validateImageFile(docxFile);
    assert.equal(resDocx.valid, false);

    const resTxt = validateImageFile(txtFile);
    assert.equal(resTxt.valid, false);
  });

  it('rejects images exceeding 15MB limit', () => {
    const hugeFile = {
      name: 'large_photo.png',
      type: 'image/png',
      size: MAX_IMAGE_SIZE_BYTES + 1024,
    } as unknown as File;

    const result = validateImageFile(hugeFile);
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('15MB'));
  });
});

describe('Mathematical Expression & Symbol Parser', () => {
  it('replaces Greek letters with LaTeX commands', () => {
    const input = 'α + β = γ * θ / π + Ω';
    const output = replaceMathSymbols(input);
    assert.ok(output.includes('\\alpha'));
    assert.ok(output.includes('\\beta'));
    assert.ok(output.includes('\\gamma'));
    assert.ok(output.includes('\\theta'));
    assert.ok(output.includes('\\pi'));
    assert.ok(output.includes('\\Omega'));
  });

  it('replaces mathematical operators with LaTeX commands', () => {
    const input = 'a ≤ b and c ≥ d, x ≠ y, ± 5, ∫ f(x) dx, ∑ i, ∞';
    const output = replaceMathSymbols(input);
    assert.ok(output.includes('\\le'));
    assert.ok(output.includes('\\ge'));
    assert.ok(output.includes('\\neq'));
    assert.ok(output.includes('\\pm'));
    assert.ok(output.includes('\\int'));
    assert.ok(output.includes('\\sum'));
    assert.ok(output.includes('\\infty'));
  });

  it('replaces Unicode superscripts and subscripts', () => {
    const input = 'x² + y³ + z⁻¹ = a₀ + b₁';
    const output = replaceMathSymbols(input);
    assert.ok(output.includes('x^{2}'));
    assert.ok(output.includes('y^{3}'));
    assert.ok(output.includes('z^{-1}'));
    assert.ok(output.includes('a_{0}'));
    assert.ok(output.includes('b_{1}'));
  });

  it('classifies spatially raised and lowered symbols from OCR bounding boxes', () => {
    // 1. Spatially raised x + 2 -> x^{2}
    const raisedX2: OcrWord = {
      text: 'x2',
      confidence: 95,
      bbox: { x0: 10, y0: 35, x1: 30, y1: 70 },
      symbols: [
        { text: 'x', confidence: 95, bbox: { x0: 10, y0: 50, x1: 20, y1: 70 } },
        { text: '2', confidence: 95, bbox: { x0: 22, y0: 35, x1: 30, y1: 52 } },
      ],
    };
    assert.equal(classifyWordSymbols(raisedX2), 'x^{2}');

    // 2. Spatially lowered a + 1 -> a_{1}
    const loweredA1: OcrWord = {
      text: 'a1',
      confidence: 95,
      bbox: { x0: 10, y0: 50, x1: 30, y1: 80 },
      symbols: [
        { text: 'a', confidence: 95, bbox: { x0: 10, y0: 50, x1: 20, y1: 70 } },
        { text: '1', confidence: 95, bbox: { x0: 22, y0: 62, x1: 30, y1: 80 } },
      ],
    };
    assert.equal(classifyWordSymbols(loweredA1), 'a_{1}');

    // 3. Multi-digit raised exponent x + 1 + 0 -> x^{10}
    const raisedX10: OcrWord = {
      text: 'x10',
      confidence: 95,
      bbox: { x0: 10, y0: 35, x1: 40, y1: 70 },
      symbols: [
        { text: 'x', confidence: 95, bbox: { x0: 10, y0: 50, x1: 20, y1: 70 } },
        { text: '1', confidence: 95, bbox: { x0: 22, y0: 35, x1: 30, y1: 52 } },
        { text: '0', confidence: 95, bbox: { x0: 32, y0: 35, x1: 40, y1: 52 } },
      ],
    };
    assert.equal(classifyWordSymbols(raisedX10), 'x^{10}');

    // 4. Elevated power on number: 10 + 5 -> 10^{5}
    const raisedNumPower: OcrWord = {
      text: '105',
      confidence: 95,
      bbox: { x0: 10, y0: 35, x1: 40, y1: 70 },
      symbols: [
        { text: '1', confidence: 95, bbox: { x0: 10, y0: 50, x1: 18, y1: 70 } },
        { text: '0', confidence: 95, bbox: { x0: 19, y0: 50, x1: 28, y1: 70 } },
        { text: '5', confidence: 95, bbox: { x0: 30, y0: 35, x1: 38, y1: 52 } },
      ],
    };
    assert.equal(classifyWordSymbols(raisedNumPower), '10^{5}');

    // 5. Elevated ? on base symbol y -> y? (rejected: ? is punctuation/unrecognized, NOT math exponent)
    const elevatedQuestionY: OcrWord = {
      text: 'y?',
      confidence: 90,
      bbox: { x0: 86, y0: 33, x1: 118, y1: 75 },
      symbols: [
        { text: 'y', confidence: 96, bbox: { x0: 86, y0: 50, x1: 105, y1: 75 } },
        { text: '?', confidence: 97, bbox: { x0: 106, y0: 33, x1: 118, y1: 51 } },
      ],
    };
    assert.equal(classifyWordSymbols(elevatedQuestionY), 'y?');

    // 6. Elevated ? after number 2 -> 2? (rejected: ? is punctuation, NOT exponent)
    const elevatedQuestion2: OcrWord = {
      text: '2?',
      confidence: 90,
      bbox: { x0: 174, y0: 33, x1: 206, y1: 68 },
      symbols: [
        { text: '2', confidence: 98, bbox: { x0: 174, y0: 50, x1: 191, y1: 68 } },
        { text: '?', confidence: 96, bbox: { x0: 194, y0: 33, x1: 206, y1: 51 } },
      ],
    };
    assert.equal(classifyWordSymbols(elevatedQuestion2), '2?');

    // 7. Parenthesized expression exponent: (x+1) + 2 -> (x+1)^{2}
    const lineWithParen: OcrLine = {
      text: '(x+1)2',
      confidence: 95,
      words: [
        {
          text: '(x+1)2',
          confidence: 95,
          symbols: [
            { text: '(', confidence: 95, bbox: { x0: 10, y0: 45, x1: 15, y1: 75 } },
            { text: 'x', confidence: 95, bbox: { x0: 16, y0: 55, x1: 25, y1: 75 } },
            { text: '+', confidence: 95, bbox: { x0: 26, y0: 58, x1: 35, y1: 72 } },
            { text: '1', confidence: 95, bbox: { x0: 36, y0: 55, x1: 45, y1: 75 } },
            { text: ')', confidence: 95, bbox: { x0: 46, y0: 45, x1: 51, y1: 75 } },
            { text: '2', confidence: 95, bbox: { x0: 53, y0: 33, x1: 61, y1: 52 } },
          ],
        },
      ],
    };
    assert.equal(applySpatialSuperSubscripts(lineWithParen), '(x+1)^{2}');

    // 8. Missing or invalid bounding boxes fallback safely to original text
    const noBboxWord: OcrWord = {
      text: 'x2',
      confidence: 90,
      symbols: [
        { text: 'x', confidence: 90 },
        { text: '2', confidence: 90 },
      ],
    };
    assert.equal(classifyWordSymbols(noBboxWord), 'x2');

    const noSymbolsWord: OcrWord = {
      text: 'a1',
      confidence: 90,
    };
    assert.equal(classifyWordSymbols(noSymbolsWord), 'a1');

    const noWordsLine: OcrLine = {
      text: 'f(x) = y',
      confidence: 90,
    };
    assert.equal(applySpatialSuperSubscripts(noWordsLine), 'f(x) = y');
  });

  it('preserves normal baseline numbers, prose identifiers, and chemical formulas', () => {
    // 1. Baseline x2 (shares baseline y1=70)
    const baselineX2: OcrWord = {
      text: 'x2',
      confidence: 95,
      bbox: { x0: 10, y0: 50, x1: 30, y1: 70 },
      symbols: [
        { text: 'x', confidence: 95, bbox: { x0: 10, y0: 50, x1: 20, y1: 70 } },
        { text: '2', confidence: 95, bbox: { x0: 22, y0: 50, x1: 30, y1: 70 } },
      ],
    };
    assert.equal(classifyWordSymbols(baselineX2), 'x2');

    // 2. Baseline version2 (shares baseline y1=70)
    const baselineVersion2: OcrWord = {
      text: 'version2',
      confidence: 95,
      symbols: [
        { text: 'v', confidence: 95, bbox: { x0: 10, y0: 50, x1: 18, y1: 70 } },
        { text: 'e', confidence: 95, bbox: { x0: 19, y0: 50, x1: 26, y1: 70 } },
        { text: 'r', confidence: 95, bbox: { x0: 27, y0: 50, x1: 34, y1: 70 } },
        { text: 's', confidence: 95, bbox: { x0: 35, y0: 50, x1: 42, y1: 70 } },
        { text: 'i', confidence: 95, bbox: { x0: 43, y0: 45, x1: 47, y1: 70 } },
        { text: 'o', confidence: 95, bbox: { x0: 48, y0: 50, x1: 56, y1: 70 } },
        { text: 'n', confidence: 95, bbox: { x0: 57, y0: 50, x1: 65, y1: 70 } },
        { text: '2', confidence: 95, bbox: { x0: 66, y0: 48, x1: 75, y1: 70 } },
      ],
    };
    assert.equal(classifyWordSymbols(baselineVersion2), 'version2');

    // 3. Baseline item1
    const baselineItem1: OcrWord = {
      text: 'item1',
      confidence: 95,
      symbols: [
        { text: 'i', confidence: 95, bbox: { x0: 10, y0: 45, x1: 14, y1: 70 } },
        { text: 't', confidence: 95, bbox: { x0: 15, y0: 48, x1: 22, y1: 70 } },
        { text: 'e', confidence: 95, bbox: { x0: 23, y0: 50, x1: 30, y1: 70 } },
        { text: 'm', confidence: 95, bbox: { x0: 31, y0: 50, x1: 42, y1: 70 } },
        { text: '1', confidence: 95, bbox: { x0: 43, y0: 48, x1: 50, y1: 70 } },
      ],
    };
    assert.equal(classifyWordSymbols(baselineItem1), 'item1');

    // 4. Baseline abc123
    const baselineAbc123: OcrWord = {
      text: 'abc123',
      confidence: 95,
      symbols: [
        { text: 'a', confidence: 95, bbox: { x0: 10, y0: 50, x1: 18, y1: 70 } },
        { text: 'b', confidence: 95, bbox: { x0: 19, y0: 45, x1: 27, y1: 70 } },
        { text: 'c', confidence: 95, bbox: { x0: 28, y0: 50, x1: 36, y1: 70 } },
        { text: '1', confidence: 95, bbox: { x0: 37, y0: 48, x1: 45, y1: 70 } },
        { text: '2', confidence: 95, bbox: { x0: 46, y0: 48, x1: 54, y1: 70 } },
        { text: '3', confidence: 95, bbox: { x0: 55, y0: 48, x1: 63, y1: 70 } },
      ],
    };
    assert.equal(classifyWordSymbols(baselineAbc123), 'abc123');

    // 5. Baseline H2O (shares cap-height and baseline)
    const baselineH2O: OcrWord = {
      text: 'H2O',
      confidence: 95,
      symbols: [
        { text: 'H', confidence: 95, bbox: { x0: 10, y0: 45, x1: 22, y1: 70 } },
        { text: '2', confidence: 95, bbox: { x0: 23, y0: 45, x1: 33, y1: 70 } },
        { text: 'O', confidence: 95, bbox: { x0: 34, y0: 45, x1: 46, y1: 70 } },
      ],
    };
    assert.equal(classifyWordSymbols(baselineH2O), 'H2O');

    // 6. Baseline CO2 & SO4 & CaCl2
    const baselineCO2: OcrWord = {
      text: 'CO2',
      confidence: 95,
      symbols: [
        { text: 'C', confidence: 95, bbox: { x0: 10, y0: 45, x1: 22, y1: 70 } },
        { text: 'O', confidence: 95, bbox: { x0: 23, y0: 45, x1: 35, y1: 70 } },
        { text: '2', confidence: 95, bbox: { x0: 36, y0: 45, x1: 46, y1: 70 } },
      ],
    };
    assert.equal(classifyWordSymbols(baselineCO2), 'CO2');

    const baselineSO4: OcrWord = {
      text: 'SO4',
      confidence: 95,
      symbols: [
        { text: 'S', confidence: 95, bbox: { x0: 10, y0: 45, x1: 20, y1: 70 } },
        { text: 'O', confidence: 95, bbox: { x0: 21, y0: 45, x1: 33, y1: 70 } },
        { text: '4', confidence: 95, bbox: { x0: 34, y0: 45, x1: 44, y1: 70 } },
      ],
    };
    assert.equal(classifyWordSymbols(baselineSO4), 'SO4');
  });

  it('integrates spatial superscript detection end-to-end into parseOcrToLatex', () => {
    const ocrData: OcrResultData = {
      text: 'x2 + y2 = z2',
      confidence: 92,
      lines: [
        {
          text: 'x2 + y2 = z2',
          confidence: 92,
          words: [
            {
              text: 'x2',
              confidence: 92,
              symbols: [
                { text: 'x', confidence: 92, bbox: { x0: 10, y0: 50, x1: 20, y1: 70 } },
                { text: '2', confidence: 92, bbox: { x0: 22, y0: 35, x1: 30, y1: 52 } },
              ],
            },
            {
              text: '+',
              confidence: 95,
              symbols: [{ text: '+', confidence: 95, bbox: { x0: 35, y0: 55, x1: 45, y1: 65 } }],
            },
            {
              text: 'y2',
              confidence: 92,
              symbols: [
                { text: 'y', confidence: 92, bbox: { x0: 50, y0: 50, x1: 60, y1: 75 } },
                { text: '2', confidence: 92, bbox: { x0: 62, y0: 35, x1: 70, y1: 52 } },
              ],
            },
            {
              text: '=',
              confidence: 95,
              symbols: [{ text: '=', confidence: 95, bbox: { x0: 75, y0: 55, x1: 85, y1: 65 } }],
            },
            {
              text: 'z2',
              confidence: 92,
              symbols: [
                { text: 'z', confidence: 92, bbox: { x0: 90, y0: 50, x1: 100, y1: 70 } },
                { text: '2', confidence: 92, bbox: { x0: 102, y0: 35, x1: 110, y1: 52 } },
              ],
            },
          ],
        },
      ],
    };

    const latex = parseOcrToLatex(ocrData);
    assert.ok(latex.includes('x^{2} + y^{2} = z^{2}'), `Expected x^{2} + y^{2} = z^{2}, got: ${latex}`);
    assert.ok(latex.includes('\\['), 'Should be wrapped in display equation');
  });

  it('replaces square root symbols with \\sqrt{...}', () => {
    const input = '√(x+1) + √25';
    const output = replaceMathSymbols(input);
    assert.ok(output.includes('\\sqrt{x+1}'));
    assert.ok(output.includes('\\sqrt{25}'));
  });

  it('correctly scopes Unicode radical over superscripted tokens vs explicit parentheses', () => {
    // Unicode radical followed by superscripted token: √x² -> \sqrt{x^{2}}
    assert.equal(replaceMathSymbols('√x²'), '\\sqrt{x^{2}}');

    // Explicit parentheses: √(x)² -> \sqrt{x}^{2}
    assert.equal(replaceMathSymbols('√(x)²'), '\\sqrt{x}^{2}');

    // Parenthesized expressions with exponents or fractions
    assert.equal(replaceMathSymbols('√(x² + 1)'), '\\sqrt{x^{2} + 1}');
    assert.equal(replaceMathSymbols('√(a/b)'), '\\sqrt{a/b}');
    assert.equal(parseFractionsInLine(replaceMathSymbols('√(a/b)')), '\\sqrt{\\frac{a}{b}}');

    // Multiple radicals and simple tokens
    assert.equal(replaceMathSymbols('√25 + √100'), '\\sqrt{25} + \\sqrt{100}');
    assert.equal(replaceMathSymbols('√x'), '\\sqrt{x}');
    assert.equal(replaceMathSymbols('√(x+1)'), '\\sqrt{x+1}');

    // Existing scope rule: unparenthesized multi-term expression only scopes leading token
    // √2x + 3y -> \sqrt{2x} + 3y
    assert.equal(replaceMathSymbols('√2x + 3y'), '\\sqrt{2x} + 3y');

    // Additional radical exponent edge cases
    assert.equal(replaceMathSymbols('√x⁻¹'), '\\sqrt{x^{-1}}');
    assert.equal(replaceMathSymbols('√2x²'), '\\sqrt{2x^{2}}');
    assert.equal(replaceMathSymbols('√x^{2}'), '\\sqrt{x^{2}}');
    // Known scope limitation: unparenthesized multi-factor expression only scopes the base + exponent token, not trailing factors
    assert.equal(replaceMathSymbols('√x²y'), '\\sqrt{x^{2}}y');

    // End-to-end parseOcrToLatex verification
    const resPow = parseOcrToLatex({ text: '√x²', confidence: 90 });
    assert.ok(resPow.includes('\\sqrt{x^{2}}'), `Expected \\sqrt{x^{2}}, got ${resPow}`);

    const resParenPow = parseOcrToLatex({ text: '√(x)²', confidence: 90 });
    assert.ok(resParenPow.includes('\\sqrt{x}^{2}'), `Expected \\sqrt{x}^{2}, got ${resParenPow}`);

    const resFrac = parseOcrToLatex({ text: '√(a/b)', confidence: 90 });
    assert.ok(resFrac.includes('\\sqrt{\\frac{a}{b}}'), `Expected \\sqrt{\\frac{a}{b}}, got ${resFrac}`);
  });

  it('replaces Unicode vulgar fractions with \\frac{...}{...}', () => {
    assert.equal(replaceMathSymbols('½'), '\\frac{1}{2}');
    assert.equal(replaceMathSymbols('⅓'), '\\frac{1}{3}');
    assert.equal(replaceMathSymbols('¼'), '\\frac{1}{4}');
    assert.equal(replaceMathSymbols('¾'), '\\frac{3}{4}');
    assert.equal(replaceMathSymbols('x = ½'), 'x = \\frac{1}{2}');
    assert.equal(replaceMathSymbols('The value is ¾.'), 'The value is \\frac{3}{4}.');

    // In end-to-end math parser
    const resHalf = parseOcrToLatex({ text: '½', confidence: 90 });
    assert.ok(resHalf.includes('\\frac{1}{2}'));

    const resEq = parseOcrToLatex({ text: 'x = ½', confidence: 90 });
    assert.ok(resEq.includes('x = \\frac{1}{2}'));
  });

  it('parses inline fractions with contextual numeric fraction support and date protection', () => {
    // Non-numeric algebraic fractions
    assert.equal(parseFractionsInLine('(x + 1) / (y - 1)'), '\\frac{x + 1}{y - 1}');
    assert.equal(parseFractionsInLine('(a+b)/(c+d)'), '\\frac{a+b}{c+d}');
    assert.equal(parseFractionsInLine('(x-1)/(x+1)'), '\\frac{x-1}{x+1}');
    assert.equal(parseFractionsInLine('a / b'), '\\frac{a}{b}');
    assert.equal(parseFractionsInLine('a/b'), '\\frac{a}{b}');
    assert.equal(parseFractionsInLine('x/y'), '\\frac{x}{y}');
    assert.equal(parseFractionsInLine('x^2/y^2'), '\\frac{x^2}{y^2}');
    assert.equal(parseFractionsInLine('2x/3'), '\\frac{2x}{3}');
    assert.equal(parseFractionsInLine('2x/y'), '\\frac{2x}{y}');
    assert.equal(parseFractionsInLine('a_1/b_2'), '\\frac{a_1}{b_2}');
    assert.equal(parseFractionsInLine('x = a/b'), 'x = \\frac{a}{b}');

    // Parenthesized fractions
    assert.equal(parseFractionsInLine('(1/2)'), '\\frac{1}{2}');
    assert.equal(parseFractionsInLine('(3/4)'), '\\frac{3}{4}');

    // Contextual numeric fractions (equations & operations)
    assert.equal(parseFractionsInLine('x = 1/2'), 'x = \\frac{1}{2}');
    assert.equal(parseFractionsInLine('1/2 + 3/4'), '\\frac{1}{2} + \\frac{3}{4}');
    assert.equal(parseFractionsInLine('y = 10/20'), 'y = \\frac{10}{20}');
    assert.equal(parseFractionsInLine('x = 1234/5'), 'x = \\frac{1234}{5}');
    assert.equal(parseFractionsInLine('x = 3600/60'), 'x = \\frac{3600}{60}');
    assert.equal(parseFractionsInLine('1234/5 + 1/2'), '\\frac{1234}{5} + \\frac{1}{2}');

    // Ambiguous standalone numeric fractions remain unchanged
    assert.equal(parseFractionsInLine('1/2'), '1/2');
    assert.equal(parseFractionsInLine('3/4'), '3/4');
    assert.equal(parseFractionsInLine('10/20'), '10/20');
    assert.equal(parseFractionsInLine('1234/5'), '1234/5');
    assert.equal(parseFractionsInLine('3600/60'), '3600/60');
    assert.equal(parseFractionsInLine('12/05'), '12/05');
    assert.equal(parseFractionsInLine('01/02'), '01/02');
    assert.equal(parseFractionsInLine('31/12'), '31/12');

    // Dates remain protected and intact (including year/month dates in math context)
    assert.equal(parseFractionsInLine('2026/10'), '2026/10');
    assert.equal(parseFractionsInLine('2026/1'), '2026/1');
    assert.equal(parseFractionsInLine('2026/12'), '2026/12');
    assert.equal(parseFractionsInLine('x = 2026/10'), 'x = 2026/10');
    assert.equal(parseFractionsInLine('x = 2026/1'), 'x = 2026/1');
    assert.equal(parseFractionsInLine('x = 2026/12'), 'x = 2026/12');
    assert.equal(parseFractionsInLine('The value is x = 2026/10'), 'The value is x = 2026/10');
    assert.equal(parseFractionsInLine('Published in 2026/10'), 'Published in 2026/10');
    assert.equal(parseFractionsInLine('2026/13'), '2026/13');
    assert.equal(parseFractionsInLine('x = 2026/13'), 'x = \\frac{2026}{13}');
    assert.equal(parseFractionsInLine('2026/10/08'), '2026/10/08');
    assert.equal(parseFractionsInLine('12/05/2026'), '12/05/2026');
    assert.equal(parseFractionsInLine('Published on 12/05/2026'), 'Published on 12/05/2026');

    // Ordinary prose and technical unit expressions remain unchanged
    assert.equal(parseFractionsInLine('and/or'), 'and/or');
    assert.equal(parseFractionsInLine('input/output'), 'input/output');
    assert.equal(parseFractionsInLine('true/false'), 'true/false');
    assert.equal(parseFractionsInLine('yes/no'), 'yes/no');
    assert.equal(parseFractionsInLine('male/female'), 'male/female');
    assert.equal(parseFractionsInLine('w/o'), 'w/o');
    assert.equal(parseFractionsInLine('n/a'), 'n/a');
    assert.equal(parseFractionsInLine('km/h'), 'km/h');
    assert.equal(parseFractionsInLine('m/s'), 'm/s');
    assert.equal(parseFractionsInLine('m/min'), 'm/min');
    assert.equal(parseFractionsInLine('kg/m3'), 'kg/m3');
    assert.equal(parseFractionsInLine('mg/mL'), 'mg/mL');
    assert.equal(parseFractionsInLine('L/min'), 'L/min');
    assert.equal(parseFractionsInLine('N/m2'), 'N/m2');
    assert.equal(parseFractionsInLine('J/mol'), 'J/mol');
    assert.equal(parseFractionsInLine('W/m2'), 'W/m2');
    assert.equal(parseFractionsInLine('The speed is km/h.'), 'The speed is km/h.');
    assert.equal(parseFractionsInLine('Use input/output format.'), 'Use input/output format.');
    assert.equal(parseFractionsInLine('y = km/h'), 'y = km/h');
    assert.equal(parseFractionsInLine('v = 10 m/s'), 'v = 10 m/s');

    // Greek fractions and symbolic algebra
    assert.equal(parseFractionsInLine('π/2'), '\\frac{\\pi}{2}');
    assert.equal(parseFractionsInLine('2π/3'), '\\frac{2\\pi}{3}');
    assert.equal(parseFractionsInLine('α/β'), '\\frac{\\alpha}{\\beta}');
    assert.equal(parseFractionsInLine('β/γ'), '\\frac{\\beta}{\\gamma}');
    assert.equal(parseFractionsInLine('π/λ'), '\\frac{\\pi}{\\lambda}');
    assert.equal(parseFractionsInLine('θ/2'), '\\frac{\\theta}{2}');
    assert.equal(parseFractionsInLine('2α/3'), '\\frac{2\\alpha}{3}');
    assert.equal(parseFractionsInLine('α^2/β^2'), '\\frac{\\alpha^2}{\\beta^2}');
    assert.equal(parseFractionsInLine('x = α/β'), 'x = \\frac{\\alpha}{\\beta}');
    assert.equal(parseFractionsInLine('y = 2π/3'), 'y = \\frac{2\\pi}{3}');
    assert.equal(parseFractionsInLine('z = θ/2'), 'z = \\frac{\\theta}{2}');

    // LaTeX Greek command fractions
    assert.equal(parseFractionsInLine('\\pi/2'), '\\frac{\\pi}{2}');
    assert.equal(parseFractionsInLine('\\alpha/\\beta'), '\\frac{\\alpha}{\\beta}');
    assert.equal(parseFractionsInLine('\\theta/2'), '\\frac{\\theta}{2}');
    assert.equal(parseFractionsInLine('2\\pi/3'), '\\frac{2\\pi}{3}');

    // Regression checks
    assert.equal(parseFractionsInLine('a-b'), 'a-b');
  });

  it('parses stacked fractions across 3 lines', () => {
    const lines = [
      'x + 1',
      '------',
      'y - 1',
    ];
    const parsed = parseStackedFractions(lines);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0], '\\frac{x + 1}{y - 1}');
  });

  it('parses matrices into bmatrix / pmatrix', () => {
    // Bracketed square matrix
    const matrixLines = [
      '[ 1  2 ]',
      '[ 3  4 ]',
    ];
    const parsed = parseMatrix(matrixLines);
    assert.equal(parsed.isMatrix, true);
    assert.ok(parsed.latex?.includes('\\begin{bmatrix}'));
    assert.ok(parsed.latex?.includes('1 & 2'));
    assert.ok(parsed.latex?.includes('3 & 4'));
    assert.ok(parsed.latex?.includes('\\end{bmatrix}'));

    // Parenthesized matrix
    const parenMatrix = [
      '( 1  0 )',
      '( 0  1 )',
    ];
    const parsedParen = parseMatrix(parenMatrix);
    assert.equal(parsedParen.isMatrix, true);
    assert.ok(parsedParen.latex?.includes('\\begin{pmatrix}'));
    assert.ok(parsedParen.latex?.includes('1 & 0'));
    assert.ok(parsedParen.latex?.includes('0 & 1'));
    assert.ok(parsedParen.latex?.includes('\\end{pmatrix}'));

    // Strict unbracketed numeric grid
    const numGrid = [
      '1  2',
      '3  4',
    ];
    const parsedGrid = parseMatrix(numGrid);
    assert.equal(parsedGrid.isMatrix, true);
    assert.ok(parsedGrid.latex?.includes('\\begin{pmatrix}'));
    assert.ok(parsedGrid.latex?.includes('1 & 2'));
    assert.ok(parsedGrid.latex?.includes('3 & 4'));

    // Rejects equations from being classified as matrices
    assert.equal(parseMatrix(['x + y = 1', '2x - y = 3']).isMatrix, false);
    assert.equal(parseMatrix(['x + y = 10', '2x - y = 5']).isMatrix, false);

    // Rejects ordinary multi-line text with equal word counts
    assert.equal(parseMatrix(['The quick brown fox', 'Jumps over lazy dog']).isMatrix, false);

    // Rejects inconsistent row column counts
    assert.equal(parseMatrix(['[ 1  2  3 ]', '[ 4  5 ]']).isMatrix, false);
  });

  it('parses system of equations into cases environment', () => {
    const caseLines = [
      '{ 2x + y = 5',
      '  x - 3y = 2',
    ];
    const parsed = parseCases(caseLines);
    assert.equal(parsed.isCases, true);
    assert.ok(parsed.latex?.includes('\\begin{cases}'));
    assert.ok(parsed.latex?.includes('2x + y = 5'));
    assert.ok(parsed.latex?.includes('x - 3y = 2'));
    assert.ok(parsed.latex?.includes('\\end{cases}'));

    // In end-to-end math parser, equations with leading brace become cases without matrix hijacking
    const resEq1 = parseOcrToLatex({ text: '{ x + y = 1\n  2x - y = 3', confidence: 90 });
    assert.ok(resEq1.includes('\\begin{cases}'));
    assert.ok(!resEq1.includes('\\begin{pmatrix}'));
    assert.ok(!resEq1.includes('\\begin{bmatrix}'));

    const resEq2 = parseOcrToLatex({ text: '{ x + y = 10\n  2x - y = 5', confidence: 90 });
    assert.ok(resEq2.includes('\\begin{cases}'));
    assert.ok(!resEq2.includes('\\begin{pmatrix}'));
    assert.ok(!resEq2.includes('\\begin{bmatrix}'));
  });

  it('preserves stacked independent equations as separate display equations without cases wrapping', () => {
    // 1. E = mc^2 and f(x) = x^2 + 2x + 1
    const res1 = parseOcrToLatex({ text: 'E = mc^2\nf(x) = x^2 + 2x + 1', confidence: 90 });
    assert.ok(!res1.includes('\\begin{cases}'), 'Independent equations must not be wrapped in cases');
    assert.ok(res1.includes('E = mc^2'));
    assert.ok(res1.includes('f(x) = x^2 + 2x + 1'));

    // 2. x = 1 and y = 2
    const res2 = parseOcrToLatex({ text: 'x = 1\ny = 2', confidence: 90 });
    assert.ok(!res2.includes('\\begin{cases}'));
    assert.ok(res2.includes('x = 1'));
    assert.ok(res2.includes('y = 2'));

    // 3. a + b = c and c = d
    const res3 = parseOcrToLatex({ text: 'a + b = c\nc = d', confidence: 90 });
    assert.ok(!res3.includes('\\begin{cases}'));
    assert.ok(res3.includes('a + b = c'));
    assert.ok(res3.includes('c = d'));
  });

  it('preserves ascender + x-height letters on same baseline without false subscripting', () => {
    // Pairs: dx, dy, bx, hy, fx, kx
    const pairs = ['dx', 'dy', 'bx', 'hy', 'fx', 'kx'];
    for (const pair of pairs) {
      const c1 = pair[0];
      const c2 = pair[1];
      const word: OcrWord = {
        text: pair,
        confidence: 95,
        bbox: { x0: 10, y0: 10, x1: 30, y1: 25 },
        symbols: [
          { text: c1, confidence: 95, bbox: { x0: 10, y0: 10, x1: 20, y1: 25 } }, // ascender (h=15, baseline y1=25)
          { text: c2, confidence: 95, bbox: { x0: 20, y0: 15, x1: 30, y1: 25 } }, // x-height (h=10, baseline y1=25, same baseline!)
        ],
      };
      const classified = classifyWordSymbols(word);
      assert.equal(classified, pair, `Expected ${pair} to remain baseline text, got: ${classified}`);
    }

    // A clearly lowered digit after a variable (a1 lowered) must still be a subscript
    const loweredWord: OcrWord = {
      text: 'a1',
      confidence: 95,
      bbox: { x0: 10, y0: 10, x1: 30, y1: 28 },
      symbols: [
        { text: 'a', confidence: 95, bbox: { x0: 10, y0: 10, x1: 20, y1: 20 } }, // base (y0=10, y1=20, h=10)
        { text: '1', confidence: 95, bbox: { x0: 20, y0: 15, x1: 28, y1: 24 } }, // lowered (y0=15, y1=24, baseline shift +4 >= 2.5)
      ],
    };
    assert.equal(classifyWordSymbols(loweredWord), 'a_{1}');

    // A clearly raised digit must still be a superscript
    const raisedWord: OcrWord = {
      text: 'x2',
      confidence: 95,
      bbox: { x0: 10, y0: 5, x1: 30, y1: 20 },
      symbols: [
        { text: 'x', confidence: 95, bbox: { x0: 10, y0: 10, x1: 20, y1: 20 } }, // base (y0=10, y1=20, h=10)
        { text: '2', confidence: 95, bbox: { x0: 20, y0: 5, x1: 28, y1: 13 } },  // raised (y0=5, y1=13, baseline shift -7)
      ],
    };
    assert.equal(classifyWordSymbols(raisedWord), 'x^{2}');
  });

  it('parses multi-line aligned equations into align* environment', () => {
    const alignLines = [
      'f(x) = x^2 + 2x + 1',
      '     = (x + 1)^2',
    ];
    const parsed = parseAlignedEquations(alignLines);
    assert.equal(parsed.isAlign, true);
    assert.ok(parsed.latex?.includes('\\begin{align*}'));
    assert.ok(parsed.latex?.includes('&='));
    assert.ok(parsed.latex?.includes('\\end{align*}'));
  });

  it('preserves stacked equations with for/where/pour/ou as separate display equations', () => {
    const testCases = [
      'a = b\nc = d for all c',
      'x = 5 where y = 3\nz = 1',
      'x = 1 pour tout x\ny = 2',
      'x = 0 ou x = 1\ny = 2',
    ];

    for (const input of testCases) {
      const lines = input.split('\n');
      const casesCheck = parseCases(lines);
      assert.equal(casesCheck.isCases, false, `Expected no cases for: ${input}`);

      const res = parseOcrToLatex({ text: input, confidence: 90 });
      assert.ok(!res.includes('\\begin{cases}'), `Must not wrap in cases: ${input}`);
    }
  });

  it('preserves "x = 1 for n ≥ 1\\ny = 2" as separate display equations', () => {
    const input = 'x = 1 for n ≥ 1\ny = 2';
    const lines = input.split('\n');
    const casesCheck = parseCases(lines);
    assert.equal(casesCheck.isCases, false);

    const res = parseOcrToLatex({ text: input, confidence: 90 });
    assert.ok(!res.includes('\\begin{cases}'), 'Must not wrap in cases');
    assert.ok(res.includes('x = 1'));
    assert.ok(res.includes('y = 2'));
  });

  it('parses "f(x) = 1 if x > 0\\nf(x) = 0 otherwise" as cases', () => {
    const input = 'f(x) = 1 if x > 0\nf(x) = 0 otherwise';
    const lines = input.split('\n');
    const casesCheck = parseCases(lines);
    assert.equal(casesCheck.isCases, true);
    assert.ok(casesCheck.latex?.includes('\\begin{cases}'));

    const res = parseOcrToLatex({ text: input, confidence: 90 });
    assert.ok(res.includes('\\begin{cases}'));
    assert.ok(res.includes('\\end{cases}'));
  });

  it('parses "{ 2x + y = 5\\n x - 3y = 2" as cases', () => {
    const input = '{ 2x + y = 5\n x - 3y = 2';
    const lines = input.split('\n');
    const casesCheck = parseCases(lines);
    assert.equal(casesCheck.isCases, true);
    assert.ok(casesCheck.latex?.includes('\\begin{cases}'));

    const res = parseOcrToLatex({ text: input, confidence: 90 });
    assert.ok(res.includes('\\begin{cases}'));
    assert.ok(res.includes('\\end{cases}'));
  });

  it('rejects "R&D = 5\\nQ&A = 3" from align* environment', () => {
    const input = 'R&D = 5\nQ&A = 3';
    const lines = input.split('\n');
    const alignCheck = parseAlignedEquations(lines);
    assert.equal(alignCheck.isAlign, false);

    const res = parseOcrToLatex({ text: input, confidence: 90 });
    assert.ok(!res.includes('\\begin{align*}'), 'Must not wrap in align*');
  });

  it('verifies display math delimiters \\[ \\] wrap matrix and cases environments', () => {
    // 1. Bracketed matrix
    const bracketRes = parseMatrix(['[ 1  2 ]', '[ 3  4 ]']);
    assert.equal(bracketRes.isMatrix, true);
    assert.ok(bracketRes.latex?.startsWith('\\['), 'Matrix must start with \\[');
    assert.ok(bracketRes.latex?.endsWith('\\]'), 'Matrix must end with \\]');
    assert.ok(bracketRes.latex?.includes('\\begin{bmatrix}'));

    // 2. Parenthesized matrix
    const parenRes = parseMatrix(['( 5  6 )', '( 7  8 )']);
    assert.equal(parenRes.isMatrix, true);
    assert.ok(parenRes.latex?.startsWith('\\['), 'Paren matrix must start with \\[');
    assert.ok(parenRes.latex?.endsWith('\\]'), 'Paren matrix must end with \\]');
    assert.ok(parenRes.latex?.includes('\\begin{pmatrix}'));

    // 3. System of equations with leading brace
    const casesRes = parseCases(['{ 2x + y = 5', '  x - 3y = 2']);
    assert.equal(casesRes.isCases, true);
    assert.ok(casesRes.latex?.startsWith('\\['), 'Cases must start with \\[');
    assert.ok(casesRes.latex?.endsWith('\\]'), 'Cases must end with \\]');
    assert.ok(casesRes.latex?.includes('\\begin{cases}'));
  });

  it('distinguishes math expressions from natural language text', () => {
    assert.equal(isMathExpression('f(x) = x^2 + 1'), true);
    assert.equal(isMathExpression('\\alpha + \\beta = 10'), true);
    assert.equal(isMathExpression('Bonjour à tous, voici un exercice pour calculer la dérivée.'), false);
  });

  it('parses natural language prose lines without display equation wrapping (parseOcrToLatex)', () => {
    const proseInputs = [
      'The function sqrt(x) is continuous.',
      'The speed is km/h.',
      'Let x be a real number.',
      'We have x = 5 and y = 3.',
      'The value of x is 5.',
      'This is a test, not an equation.',
      'Use and/or for choices.',
      'Set a = b + c in the code.',
      'Use input/output format.',
      'input/output',
      'and/or',
      'km/h',
      'Voici la vitesse v = 10 m/s',
      'Calculer sqrt(x+1) pour x > 0',
      'Soit x un réel positif.',
      'déjà défini.',
    ];

    for (const input of proseInputs) {
      assert.equal(isMathExpression(input), false, `Expected isMathExpression=false for: ${input}`);
      const output = parseOcrToLatex({ text: input, confidence: 90 });
      assert.ok(!output.includes('\\['), `Prose line must not be wrapped in display math: ${input} -> ${output}`);
    }
  });

  it('wraps standalone mathematical formulas in display equation environments (parseOcrToLatex)', () => {
    const wrappedInputs = [
      { input: '∫ f(x) dx', contains: '\\int' },
      { input: 'α/β', contains: '\\frac{\\alpha}{\\beta}' },
      { input: '2π/3', contains: '\\frac{2\\pi}{3}' },
      { input: '√(x² + 1)', contains: '\\sqrt{x^{2} + 1}' },
      { input: '\\sqrt{x} + 1', contains: '\\sqrt{x} + 1' },
      { input: 'y = sqrt(x)', contains: 'y = ' },
      { input: 'x_n = 1/n', contains: '\\frac{1}{n}' },
      { input: 'Speed = 5 m/s', contains: 'Speed = 5 m/s' },
      { input: 'value = 3', contains: 'value = 3' },
      { input: 'a = b + c', contains: 'a = b + c' },
      { input: 'f(x) = x^2 + 2x + 1', contains: 'f(x) = x^2 + 2x + 1' },
      { input: '\\frac{a}{b} = \\sqrt{c}', contains: '\\frac{a}{b} = \\sqrt{c}' },
      { input: 'x + y = z', contains: 'x + y = z' },
      { input: 'f(x)', contains: 'f(x)' },
      { input: 'a/b', contains: '\\frac{a}{b}' },
      { input: 'x/y', contains: '\\frac{x}{y}' },
      { input: '(x+1)(x-1)', contains: '(x+1)(x-1)' },
      { input: '(x-1)(x-2)', contains: '(x-1)(x-2)' },
    ];

    for (const { input, contains } of wrappedInputs) {
      assert.equal(isMathExpression(input), true, `Expected isMathExpression=true for: ${input}`);
      const output = parseOcrToLatex({ text: input, confidence: 90 });
      assert.ok(output.includes('\\['), `Standalone math must be wrapped in display equation: ${input} -> ${output}`);
      assert.ok(output.includes(contains), `Output must contain expected snippet: ${contains}`);
    }
  });

  it('evaluates mixed math-prose and conditional statements in parseOcrToLatex', () => {
    // English conditional with 2+ stopwords -> unwrapped prose
    const ifStmt = parseOcrToLatex({ text: 'If x > 0 then y = sqrt(x)', confidence: 90 });
    assert.ok(!ifStmt.includes('\\['), 'Conditional with stopwords should remain unwrapped');

    // Code instruction with 2+ stopwords -> unwrapped prose
    const setStmt = parseOcrToLatex({ text: 'Set a = b + c in the code.', confidence: 90 });
    assert.ok(!setStmt.includes('\\['), 'Code instruction with stopwords should remain unwrapped');

    // French action verb instruction -> unwrapped prose
    const calcStmt = parseOcrToLatex({ text: 'Calculer f(x) = 2x pour x > 0', confidence: 90 });
    assert.ok(!calcStmt.includes('\\['), 'French math instruction should remain unwrapped');

    // French theorem statement -> unwrapped prose
    const pourToutStmt = parseOcrToLatex({ text: 'Pour tout x ≥ 0, √x existe.', confidence: 90 });
    assert.ok(!pourToutStmt.includes('\\['), 'French theorem statement should remain unwrapped');

    // Annotated constraint equation (single stopword 'for') -> wrapped display equation
    const constraintEq = parseOcrToLatex({ text: 'x_n = 1/n for n ≥ 1', confidence: 90 });
    assert.ok(constraintEq.includes('\\['), 'Annotated formula constraint should be wrapped in display equation');

    // Short definition equation (single stopword 'Let') -> wrapped display equation
    const defEq = parseOcrToLatex({ text: 'Let f(x) = x^2.', confidence: 90 });
    assert.ok(defEq.includes('\\['), 'Short definition equation should be wrapped in display equation');
  });

  it('correctly maps math/Greek symbols without \\text{} and wraps genuine non-ASCII words in \\text{}', () => {
    const symbolCases = [
      { input: 'α + β = γ', expected: '\\alpha', expected2: '\\beta', expected3: '\\gamma', noText: true },
      { input: 'x ≤ y', expected: '\\le', noText: true },
      { input: 'a ≥ b', expected: '\\ge', noText: true },
      { input: '5 ± 2', expected: '\\pm', noText: true },
      { input: '∫ f(x) dx', expected: '\\int', noText: true },
      { input: '∑ n', expected: '\\sum', noText: true },
      { input: '√x', expected: '\\sqrt{x}', noText: true },
      { input: 'a · b', expected: '\\cdot', noText: true },
      { input: 'θ = 90°', expected: '\\theta', expected2: '90 ^\\circ', noText: true },
      { input: 'π r²', expected: '\\pi', expected2: 'r^{2}', noText: true },
    ];

    for (const c of symbolCases) {
      const res = parseOcrToLatex({ text: c.input, confidence: 95 });
      assert.ok(res.includes('\\['), `Should be wrapped in display math: ${c.input}`);
      assert.ok(res.includes(c.expected), `Expected ${c.expected} in output: ${res}`);
      if (c.expected2) assert.ok(res.includes(c.expected2), `Expected ${c.expected2} in output: ${res}`);
      if (c.expected3) assert.ok(res.includes(c.expected3), `Expected ${c.expected3} in output: ${res}`);
      if (c.noText) {
        assert.ok(!res.includes('\\text{'), `Math symbols must not have \\text{} wrapping: ${res}`);
      }
    }

    // Diameter spec line -> clean prose without display math or \\text
    const diamRes = parseOcrToLatex({ text: 'Ø 20 mm', confidence: 95 });
    assert.equal(diamRes, 'Ø 20 mm', 'Prose spec should not be wrapped in display math or \\text{}');

    // Genuine non-math Unicode words in math expressions -> wrapped in \\text{...}
    const dejaRes = parseOcrToLatex({ text: 'f(x) = déjà', confidence: 95 });
    assert.ok(dejaRes.includes('\\text{déjà}'), `Expected \\text{déjà} in: ${dejaRes}`);

    const energyRes = parseOcrToLatex({ text: 'Énergie = mc²', confidence: 95 });
    assert.ok(energyRes.includes('\\text{Énergie} = mc^{2}'), `Expected \\text{Énergie} = mc^{2} in: ${energyRes}`);
  });

  it('proves idempotence when input contains already-converted LaTeX macros', () => {
    // replaceMathSymbols idempotence
    const convertedStr = 'x \\le y + \\alpha \\pm \\sqrt{z}';
    assert.equal(replaceMathSymbols(convertedStr), convertedStr, 'Already converted macros must not change');

    // Double replacement idempotence: replaceMathSymbols(replaceMathSymbols(x)) === replaceMathSymbols(x)
    const unicodeInputs = ['α', '≤', '±', '√x²', '∫', '∑', '°', '²', 'Ø'];
    for (const u of unicodeInputs) {
      const once = replaceMathSymbols(u);
      const twice = replaceMathSymbols(once);
      assert.equal(twice, once, `replaceMathSymbols must be strictly idempotent for "${u}"`);
    }

    // parseCases idempotence
    const casesInput = [
      '{ x \\le 0',
      'y \\ge 1',
    ];
    const casesRes = parseCases(casesInput);
    assert.equal(casesRes.isCases, true);
    assert.ok(casesRes.latex?.includes('x \\le 0 \\\\\ny \\ge 1'));
    assert.ok(casesRes.latex?.startsWith('\\['), 'Cases should start with \\[');
    assert.ok(casesRes.latex?.endsWith('\\]'), 'Cases should end with \\]');

    // parseAlignedEquations idempotence
    const alignedInput = [
      'a + \\alpha &= b',
      'c + \\beta &= d',
    ];
    const alignedRes = parseAlignedEquations(alignedInput);
    assert.equal(alignedRes.isAlign, true);
    assert.ok(alignedRes.latex?.includes('a + \\alpha &= b'));
    assert.ok(alignedRes.latex?.includes('c + \\beta &= d'));
  });

  it('isMathExpression correctly identifies MUST-be-prose list and stays unwrapped', () => {
    const proseList = [
      'This is a simple test document.',
      'Figure 1 shows the relationship between temperature and pressure.',
      'Notice that the continuous function approaches zero.',
      'The value of x increases as y decreases.',
      'Choose one of the following choices:',
      'Format the text according to the standard code.',
      'The speed of the particle is constant.',
      'Equation 4 represents the general case.',
      'Une valeur approchee de la vitesse est donnee par:',
    ];

    for (const prose of proseList) {
      assert.equal(isMathExpression(prose), false, `Expected false for prose: ${prose}`);
      const out = parseOcrToLatex({ lines: [{ text: prose, confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } }] });
      assert.equal(out.includes('\\['), false, `Expected prose to stay unwrapped: ${prose}`);
      assert.equal(out, prose);
    }
  });

  it('isMathExpression correctly identifies MUST-be-wrapped math list and wraps in display math', () => {
    const mathList = [
      'x^2 + y^2 = r^2',
      '\\int_0^\\infty e^{-x} dx = 1',
      '\\frac{a}{b} + \\frac{c}{d}',
      'E = mc^2',
      '\\alpha + \\beta = \\gamma',
      'f(x) = \\sin(x) + \\cos(x)',
      '\\sum_{i=1}^n i = \\frac{n(n+1)}{2}',
      '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1',
      'A \\times B = C',
      'x \\in [0, 1]',
    ];

    for (const math of mathList) {
      assert.equal(isMathExpression(math), true, `Expected true for math: ${math}`);
      const out = parseOcrToLatex({ lines: [{ text: math, confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } }] });
      assert.ok(out.startsWith('\\['), `Expected display math \\[ for: ${math}`);
      assert.ok(out.endsWith('\\]'), `Expected display math \\] for: ${math}`);
    }
  });

  it('evaluates edge cases and wraps English condition words in \\text', () => {
    // 1. "x_n = 1/n for n ≥ 1" -> math: true, "for" wrapped in \text{ for }
    const expr1 = 'x_n = 1/n for n ≥ 1';
    assert.equal(isMathExpression(expr1), true);
    const out1 = parseOcrToLatex({ lines: [{ text: expr1, confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } }] });
    assert.ok(out1.includes('\\text{ for }'), 'Condition word "for" must be wrapped in \\text{ for }');
    assert.ok(out1.startsWith('\\['), 'Must be wrapped in display math');

    // 2. "If x > 0 then y = sqrt(x)" -> math: false (2 stopwords "If", "then") -> prose
    const expr2 = 'If x > 0 then y = sqrt(x)';
    assert.equal(isMathExpression(expr2), false);
    const out2 = parseOcrToLatex({ lines: [{ text: expr2, confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } }] });
    assert.equal(out2, expr2);

    // 3. "Speed = 5 m/s" -> math: true (speed removed from stopwords)
    const expr3 = 'Speed = 5 m/s';
    assert.equal(isMathExpression(expr3), true);
    const out3 = parseOcrToLatex({ lines: [{ text: expr3, confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } }] });
    assert.ok(out3.startsWith('\\['), 'Must be wrapped in display math');

    // 4. "value = 3" -> math: true (value removed from stopwords)
    const expr4 = 'value = 3';
    assert.equal(isMathExpression(expr4), true);
    const out4 = parseOcrToLatex({ lines: [{ text: expr4, confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } }] });
    assert.ok(out4.startsWith('\\['), 'Must be wrapped in display math');

    // 5. "Calculer f(x) = 2x pour x > 0" -> math: false (2 stopwords "Calculer", "pour") -> prose
    const expr5 = 'Calculer f(x) = 2x pour x > 0';
    assert.equal(isMathExpression(expr5), false);
    const out5 = parseOcrToLatex({ lines: [{ text: expr5, confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } }] });
    assert.equal(out5, expr5);

    // 6. "Let f(x) = x^2." -> math: true (single stopword "Let", strong math "=")
    const expr6 = 'Let f(x) = x^2.';
    assert.equal(isMathExpression(expr6), true);
    const out6 = parseOcrToLatex({ lines: [{ text: expr6, confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } }] });
    assert.ok(out6.startsWith('\\['), 'Must be wrapped in display math');

    // 7. "Set a = b + c in the code." -> math: false (3 stopwords "Set", "in", "the") -> prose
    const expr7 = 'Set a = b + c in the code.';
    assert.equal(isMathExpression(expr7), false);
    const out7 = parseOcrToLatex({ lines: [{ text: expr7, confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } }] });
    assert.equal(out7, expr7);
  });

  it('asserts exact formatted LaTeX strings for condition words and preserved symbols', () => {
    const parse = (text: string) => {
      const lines = text.split('\n').map((l, i) => ({
        text: l,
        confidence: 90,
        bbox: { x0: 0, y0: i * 30, x1: 100, y1: (i + 1) * 30 },
      }));
      return parseOcrToLatex({ lines });
    };

    // 1. "x_n = 1/n for n ≥ 1" -> separates "for" with space padding inside \text{ for }
    assert.equal(
      parse('x_n = 1/n for n ≥ 1'),
      '\\[\nx_n = \\frac{1}{n} \\text{ for } n  \\ge  1\n\\]'
    );

    // 2. "f(x) = 1 if x > 0\nf(x) = 0 otherwise" -> piecewise cases with spaces inside condition \text{ if } and \text{ otherwise }
    assert.equal(
      parse('f(x) = 1 if x > 0\nf(x) = 0 otherwise'),
      '\\[\n\\begin{cases}\nf(x) = 1 \\text{ if } x > 0 \\\\\nf(x) = 0 \\text{ otherwise }\n\\end{cases}\n\\]'
    );

    // 3. "x \forall y" -> LaTeX macro \forall left completely untouched
    assert.equal(parse('x \\forall y'), '\\[\nx \\forall y\n\\]');

    // 4. "\iff" -> LaTeX macro \iff left completely untouched
    assert.equal(parse('\\iff'), '\\[\n\\iff\n\\]');

    // 5. "\text{if} x" -> pre-existing \text{...} argument left completely untouched
    assert.equal(parse('\\text{if} x'), '\\[\n\\text{if} x\n\\]');

    // 6. "diff = 3" -> word containing "if" substring left completely untouched
    assert.equal(parse('diff = 3'), '\\[\ndiff = 3\n\\]');
  });

  describe('Definite Integral Reconstruction from OCR Geometry', () => {
    it('reconstructs valid 3-line definite integral with explicit differential from OCR geometry', () => {
      const ocrLines: OcrLine[] = [
        {
          text: '1',
          confidence: 85,
          bbox: { x0: 41, y0: 31, x1: 51, y1: 49 },
          words: [{ text: '1', confidence: 85, bbox: { x0: 41, y0: 31, x1: 51, y1: 49 } }],
        },
        {
          text: '[ x?dx',
          confidence: 80,
          bbox: { x0: 2, y0: 40, x1: 139, y1: 127 },
          words: [
            { text: '[', confidence: 80, bbox: { x0: 2, y0: 40, x1: 37, y1: 127 } },
            { text: 'x?dx', confidence: 80, bbox: { x0: 63, y0: 59, x1: 139, y1: 93 } },
          ],
        },
        {
          text: '0',
          confidence: 90,
          bbox: { x0: 23, y0: 110, x1: 35, y1: 129 },
          words: [{ text: '0', confidence: 90, bbox: { x0: 23, y0: 110, x1: 35, y1: 129 } }],
        },
      ];

      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 1);
      assert.equal(reconstructed[0].text, '\\int_{0}^{1} x?dx');

      const latex = parseOcrToLatex({ text: '1\n[ x?dx\n0\n', confidence: 80, lines: ocrLines });
      assert.ok(latex.includes('\\int_{0}^{1} x?dx'), `Expected \\int_{0}^{1} x?dx, got:\n${latex}`);
      assert.ok(latex.startsWith('\\['), 'Display equation must start with \\[');
      assert.ok(latex.endsWith('\\]'), 'Display equation must end with \\]');
    });

    it('preserves unreadable ? in integrand without guessing', () => {
      const ocrLines: OcrLine[] = [
        { text: 'b', confidence: 90, bbox: { x0: 30, y0: 20, x1: 40, y1: 35 }, words: [{ text: 'b', confidence: 90, bbox: { x0: 30, y0: 20, x1: 40, y1: 35 } }] },
        {
          text: '∫ f(?)+g(x)dx',
          confidence: 85,
          bbox: { x0: 10, y0: 30, x1: 150, y1: 110 },
          words: [
            { text: '∫', confidence: 85, bbox: { x0: 10, y0: 30, x1: 30, y1: 110 } },
            { text: 'f(?)+g(x)dx', confidence: 85, bbox: { x0: 35, y0: 50, x1: 150, y1: 90 } },
          ],
        },
        { text: 'a', confidence: 90, bbox: { x0: 25, y0: 95, x1: 35, y1: 110 }, words: [{ text: 'a', confidence: 90, bbox: { x0: 25, y0: 95, x1: 35, y1: 110 } }] },
      ];

      const latex = parseOcrToLatex({ text: 'b\n∫ f(?)+g(x)dx\na', confidence: 85, lines: ocrLines });
      assert.ok(latex.includes('\\int_{a}^{b} f(?)+g(x)dx'));
      assert.ok(!latex.includes('f(x)+g(x)'), 'Must not guess unreadable character');
    });

    it('reconstructs definite integral with Greek bounds and multi-token integrand', () => {
      const ocrLines: OcrLine[] = [
        { text: 'π', confidence: 92, bbox: { x0: 35, y0: 25, x1: 45, y1: 38 }, words: [{ text: 'π', confidence: 92, bbox: { x0: 35, y0: 25, x1: 45, y1: 38 } }] },
        {
          text: '∫ sin(t) dt',
          confidence: 90,
          bbox: { x0: 10, y0: 30, x1: 160, y1: 100 },
          words: [
            { text: '∫', confidence: 90, bbox: { x0: 10, y0: 30, x1: 30, y1: 100 } },
            { text: 'sin(t)', confidence: 90, bbox: { x0: 40, y0: 55, x1: 90, y1: 80 } },
            { text: 'dt', confidence: 90, bbox: { x0: 95, y0: 55, x1: 115, y1: 80 } },
          ],
        },
        { text: '0', confidence: 95, bbox: { x0: 25, y0: 90, x1: 35, y1: 105 }, words: [{ text: '0', confidence: 95, bbox: { x0: 25, y0: 90, x1: 35, y1: 105 } }] },
      ];

      const latex = parseOcrToLatex({ text: 'π\n∫ sin(t) dt\n0', confidence: 90, lines: ocrLines });
      assert.ok(latex.includes('\\int_{0}^{\\pi}'));
      assert.ok(latex.includes('dt'));
    });

    it('negative: rejects 2-line input missing upper or lower limit', () => {
      const ocrLines: OcrLine[] = [
        {
          text: '[ x^2 dx',
          confidence: 80,
          bbox: { x0: 2, y0: 40, x1: 139, y1: 127 },
          words: [
            { text: '[', confidence: 80, bbox: { x0: 2, y0: 40, x1: 37, y1: 127 } },
            { text: 'x^2 dx', confidence: 80, bbox: { x0: 63, y0: 59, x1: 139, y1: 93 } },
          ],
        },
        { text: '0', confidence: 90, bbox: { x0: 23, y0: 110, x1: 35, y1: 129 }, words: [{ text: '0', confidence: 90, bbox: { x0: 23, y0: 110, x1: 35, y1: 129 } }] },
      ];

      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 2, 'Must not reconstruct with only 2 lines');
    });

    it('negative: rejects 3-line input when middle line lacks differential anchor', () => {
      const ocrLines: OcrLine[] = [
        { text: '1', confidence: 85, bbox: { x0: 41, y0: 31, x1: 51, y1: 49 }, words: [{ text: '1', confidence: 85, bbox: { x0: 41, y0: 31, x1: 51, y1: 49 } }] },
        {
          text: '[ x + 1',
          confidence: 80,
          bbox: { x0: 2, y0: 40, x1: 139, y1: 127 },
          words: [
            { text: '[', confidence: 80, bbox: { x0: 2, y0: 40, x1: 37, y1: 127 } },
            { text: 'x + 1', confidence: 80, bbox: { x0: 63, y0: 59, x1: 139, y1: 93 } },
          ],
        },
        { text: '0', confidence: 90, bbox: { x0: 23, y0: 110, x1: 35, y1: 129 }, words: [{ text: '0', confidence: 90, bbox: { x0: 23, y0: 110, x1: 35, y1: 129 } }] },
      ];

      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 3, 'Must reject line without dx/dy/dt differential');
    });

    it('negative: rejects short bracket not meeting tall-operator height ratio', () => {
      const ocrLines: OcrLine[] = [
        { text: '1', confidence: 85, bbox: { x0: 41, y0: 31, x1: 51, y1: 49 }, words: [{ text: '1', confidence: 85, bbox: { x0: 41, y0: 31, x1: 51, y1: 49 } }] },
        {
          text: '[ x dx',
          confidence: 80,
          bbox: { x0: 2, y0: 50, x1: 100, y1: 70 }, // height 20px (not tall)
          words: [
            { text: '[', confidence: 80, bbox: { x0: 2, y0: 50, x1: 15, y1: 70 } },
            { text: 'x dx', confidence: 80, bbox: { x0: 20, y0: 50, x1: 100, y1: 70 } },
          ],
        },
        { text: '0', confidence: 90, bbox: { x0: 23, y0: 80, x1: 35, y1: 98 }, words: [{ text: '0', confidence: 90, bbox: { x0: 23, y0: 80, x1: 35, y1: 98 } }] },
      ];

      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 3, 'Must reject bracket that is not tall');
    });

    it('negative: preserves ordinary prose or expressions containing J, V, [, >', () => {
      assert.equal(isMathExpression('The energy was 50 J in total.'), false);
      assert.equal(isMathExpression('The voltage V = 220 V is nominal.'), false);
      assert.equal(isMathExpression('Note: [Review required]'), false);
      assert.equal(isMathExpression('If we have x > 0 and y > 0 then we proceed.'), false);
    });

    it('negative: rejects short ordinary f followed by f(x) dx', () => {
      const ocrLines: OcrLine[] = [
        { text: '1', confidence: 85, bbox: { x0: 10, y0: 10, x1: 20, y1: 25 }, words: [{ text: '1', confidence: 85, bbox: { x0: 10, y0: 10, x1: 20, y1: 25 } }] },
        {
          text: 'f (x) dx',
          confidence: 80,
          bbox: { x0: 10, y0: 30, x1: 80, y1: 45 },
          words: [
            { text: 'f', confidence: 80, bbox: { x0: 10, y0: 30, x1: 20, y1: 45 } }, // height 15px (< 30px, < 1.6x)
            { text: '(x)', confidence: 80, bbox: { x0: 25, y0: 30, x1: 50, y1: 45 } },
            { text: 'dx', confidence: 80, bbox: { x0: 55, y0: 30, x1: 80, y1: 45 } },
          ],
        },
        { text: '0', confidence: 90, bbox: { x0: 10, y0: 50, x1: 20, y1: 65 }, words: [{ text: '0', confidence: 90, bbox: { x0: 10, y0: 50, x1: 20, y1: 65 } }] },
      ];
      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 3, 'Must reject short f');
    });

    it('negative: rejects ordinary bracketed expression with differential elsewhere in the line', () => {
      const ocrLines: OcrLine[] = [
        { text: '1', confidence: 85, bbox: { x0: 10, y0: 10, x1: 20, y1: 25 }, words: [{ text: '1', confidence: 85, bbox: { x0: 10, y0: 10, x1: 20, y1: 25 } }] },
        {
          text: '[ a + b ] dx',
          confidence: 80,
          bbox: { x0: 10, y0: 30, x1: 100, y1: 48 },
          words: [
            { text: '[', confidence: 80, bbox: { x0: 10, y0: 30, x1: 18, y1: 48 } }, // height 18px (< 30px)
            { text: 'a', confidence: 80, bbox: { x0: 22, y0: 30, x1: 32, y1: 48 } },
            { text: '+', confidence: 80, bbox: { x0: 36, y0: 30, x1: 46, y1: 48 } },
            { text: 'b', confidence: 80, bbox: { x0: 50, y0: 30, x1: 60, y1: 48 } },
            { text: ']', confidence: 80, bbox: { x0: 64, y0: 30, x1: 72, y1: 48 } },
            { text: 'dx', confidence: 80, bbox: { x0: 76, y0: 30, x1: 96, y1: 48 } },
          ],
        },
        { text: '0', confidence: 90, bbox: { x0: 10, y0: 52, x1: 20, y1: 67 }, words: [{ text: '0', confidence: 90, bbox: { x0: 10, y0: 52, x1: 20, y1: 67 } }] },
      ];
      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 3, 'Must reject ordinary bracketed line');
    });

    it('negative: rejects 3-line prose with J, I, l, f, V, [, > and realistic bounding boxes', () => {
      const ocrLines: OcrLine[] = [
        { text: 'In Physics', confidence: 85, bbox: { x0: 10, y0: 10, x1: 90, y1: 25 }, words: [{ text: 'In', confidence: 85, bbox: { x0: 10, y0: 10, x1: 30, y1: 25 } }, { text: 'Physics', confidence: 85, bbox: { x0: 35, y0: 10, x1: 90, y1: 25 } }] },
        {
          text: 'J denotes Joules dx',
          confidence: 80,
          bbox: { x0: 10, y0: 30, x1: 150, y1: 48 },
          words: [
            { text: 'J', confidence: 80, bbox: { x0: 10, y0: 30, x1: 20, y1: 48 } }, // not an allowed tall op candidate and height 18px
            { text: 'denotes', confidence: 80, bbox: { x0: 25, y0: 30, x1: 80, y1: 48 } },
            { text: 'Joules', confidence: 80, bbox: { x0: 85, y0: 30, x1: 125, y1: 48 } },
            { text: 'dx', confidence: 80, bbox: { x0: 130, y0: 30, x1: 150, y1: 48 } },
          ],
        },
        { text: 'per second', confidence: 90, bbox: { x0: 10, y0: 52, x1: 90, y1: 67 }, words: [{ text: 'per', confidence: 90, bbox: { x0: 10, y0: 52, x1: 35, y1: 67 } }, { text: 'second', confidence: 90, bbox: { x0: 40, y0: 52, x1: 90, y1: 67 } }] },
      ];
      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 3, 'Must reject prose with J/I/l/f/V');
    });

    it('negative: rejects bounds whose horizontal positions do not correspond to the operator', () => {
      const ocrLines: OcrLine[] = [
        { text: '1', confidence: 85, bbox: { x0: 150, y0: 10, x1: 160, y1: 25 }, words: [{ text: '1', confidence: 85, bbox: { x0: 150, y0: 10, x1: 160, y1: 25 } }] }, // offset > 60px to right
        {
          text: '∫ x dx',
          confidence: 90,
          bbox: { x0: 10, y0: 15, x1: 80, y1: 65 },
          words: [
            { text: '∫', confidence: 90, bbox: { x0: 10, y0: 15, x1: 25, y1: 65 } }, // tall op
            { text: 'x', confidence: 90, bbox: { x0: 30, y0: 30, x1: 45, y1: 50 } },
            { text: 'dx', confidence: 90, bbox: { x0: 50, y0: 30, x1: 75, y1: 50 } },
          ],
        },
        { text: '0', confidence: 90, bbox: { x0: 15, y0: 55, x1: 25, y1: 70 }, words: [{ text: '0', confidence: 90, bbox: { x0: 15, y0: 55, x1: 25, y1: 70 } }] },
      ];
      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 3, 'Must reject bounds misaligned horizontally');
    });

    it('negative: rejects unrelated three-line layout with long sentences that happen to contain dx', () => {
      const ocrLines: OcrLine[] = [
        {
          text: 'Chapter 4 Introduction to Differential Equations',
          confidence: 85,
          bbox: { x0: 10, y0: 10, x1: 350, y1: 25 },
          words: [
            { text: 'Chapter', confidence: 85, bbox: { x0: 10, y0: 10, x1: 50, y1: 25 } },
            { text: '4', confidence: 85, bbox: { x0: 55, y0: 10, x1: 65, y1: 25 } },
            { text: 'Introduction', confidence: 85, bbox: { x0: 70, y0: 10, x1: 150, y1: 25 } },
            { text: 'to', confidence: 85, bbox: { x0: 155, y0: 10, x1: 170, y1: 25 } },
            { text: 'Differential', confidence: 85, bbox: { x0: 175, y0: 10, x1: 250, y1: 25 } },
            { text: 'Equations', confidence: 85, bbox: { x0: 255, y0: 10, x1: 350, y1: 25 } },
          ],
        },
        {
          text: '∫ x dx',
          confidence: 90,
          bbox: { x0: 10, y0: 15, x1: 80, y1: 65 },
          words: [
            { text: '∫', confidence: 90, bbox: { x0: 10, y0: 15, x1: 25, y1: 65 } },
            { text: 'x', confidence: 90, bbox: { x0: 30, y0: 30, x1: 45, y1: 50 } },
            { text: 'dx', confidence: 90, bbox: { x0: 50, y0: 30, x1: 75, y1: 50 } },
          ],
        },
        {
          text: 'We now integrate both sides with respect to x',
          confidence: 90,
          bbox: { x0: 10, y0: 55, x1: 380, y1: 70 },
          words: [
            { text: 'We', confidence: 90, bbox: { x0: 10, y0: 55, x1: 30, y1: 70 } },
            { text: 'now', confidence: 90, bbox: { x0: 35, y0: 55, x1: 60, y1: 70 } },
            { text: 'integrate', confidence: 90, bbox: { x0: 65, y0: 55, x1: 120, y1: 70 } },
            { text: 'both', confidence: 90, bbox: { x0: 125, y0: 55, x1: 155, y1: 70 } },
            { text: 'sides', confidence: 90, bbox: { x0: 160, y0: 55, x1: 195, y1: 70 } },
            { text: 'with', confidence: 90, bbox: { x0: 200, y0: 55, x1: 230, y1: 70 } },
            { text: 'respect', confidence: 90, bbox: { x0: 235, y0: 55, x1: 280, y1: 70 } },
            { text: 'to', confidence: 90, bbox: { x0: 285, y0: 55, x1: 300, y1: 70 } },
            { text: 'x', confidence: 90, bbox: { x0: 305, y0: 55, x1: 315, y1: 70 } },
          ],
        },
      ];
      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 3, 'Must reject long prose paragraphs around operator');
    });

    it('negative: rejects input with missing bounding boxes', () => {
      const ocrLines: OcrLine[] = [
        { text: '1', confidence: 80 },
        { text: '[ x dx', confidence: 80 },
        { text: '0', confidence: 80 },
      ];
      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 3, 'Must not reconstruct without bounding boxes');
    });

    it('synthetic geometry (a): real case_04 geometry reconstructs definite integral', () => {
      const ocrLines: OcrLine[] = [
        {
          text: '1',
          confidence: 85,
          bbox: { x0: 41, y0: 31, x1: 51, y1: 49 },
          words: [{ text: '1', confidence: 85, bbox: { x0: 41, y0: 31, x1: 51, y1: 49 } }],
        },
        {
          text: '[ x?dx',
          confidence: 80,
          bbox: { x0: 2, y0: 40, x1: 139, y1: 127 },
          words: [
            { text: '[', confidence: 80, bbox: { x0: 2, y0: 40, x1: 37, y1: 127 } },
            { text: 'x?dx', confidence: 80, bbox: { x0: 63, y0: 59, x1: 139, y1: 93 } },
          ],
        },
        {
          text: '0',
          confidence: 90,
          bbox: { x0: 23, y0: 110, x1: 35, y1: 129 },
          words: [{ text: '0', confidence: 90, bbox: { x0: 23, y0: 110, x1: 35, y1: 129 } }],
        },
      ];

      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 1);
      assert.equal(reconstructed[0].text, '\\int_{0}^{1} x?dx');
    });

    it('synthetic geometry (b): three prose lines ("de la fonction", "Calculer", "du produit") never reconstruct', () => {
      const ocrLines: OcrLine[] = [
        {
          text: 'de la fonction',
          confidence: 90,
          bbox: { x0: 10, y0: 10, x1: 120, y1: 28 },
          words: [
            { text: 'de', confidence: 90, bbox: { x0: 10, y0: 10, x1: 30, y1: 28 } },
            { text: 'la', confidence: 90, bbox: { x0: 35, y0: 10, x1: 55, y1: 28 } },
            { text: 'fonction', confidence: 90, bbox: { x0: 60, y0: 10, x1: 120, y1: 28 } },
          ],
        },
        {
          text: 'Calculer',
          confidence: 88,
          bbox: { x0: 10, y0: 35, x1: 85, y1: 75 },
          words: [{ text: 'Calculer', confidence: 88, bbox: { x0: 10, y0: 35, x1: 85, y1: 75 } }],
        },
        {
          text: 'du produit',
          confidence: 90,
          bbox: { x0: 10, y0: 80, x1: 100, y1: 98 },
          words: [
            { text: 'du', confidence: 90, bbox: { x0: 10, y0: 80, x1: 30, y1: 98 } },
            { text: 'produit', confidence: 90, bbox: { x0: 35, y0: 80, x1: 100, y1: 98 } },
          ],
        },
      ];

      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 3, 'Must never reconstruct prose lines containing French de/du');
    });

    it('synthetic geometry (c): tall letter "l" with digit lines above/below and no differential does not reconstruct', () => {
      const ocrLines: OcrLine[] = [
        {
          text: '1',
          confidence: 90,
          bbox: { x0: 10, y0: 10, x1: 20, y1: 25 },
          words: [{ text: '1', confidence: 90, bbox: { x0: 10, y0: 10, x1: 20, y1: 25 } }],
        },
        {
          text: 'l x + 1',
          confidence: 85,
          bbox: { x0: 10, y0: 30, x1: 80, y1: 80 },
          words: [
            { text: 'l', confidence: 85, bbox: { x0: 10, y0: 30, x1: 20, y1: 80 } },
            { text: 'x + 1', confidence: 85, bbox: { x0: 25, y0: 45, x1: 80, y1: 65 } },
          ],
        },
        {
          text: '0',
          confidence: 90,
          bbox: { x0: 10, y0: 85, x1: 20, y1: 100 },
          words: [{ text: '0', confidence: 90, bbox: { x0: 10, y0: 85, x1: 20, y1: 100 } }],
        },
      ];

      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 3, 'Must reject tall l without differential anchor');
    });

    it('synthetic geometry (d): limits far to the right of the operator do not reconstruct', () => {
      const ocrLines: OcrLine[] = [
        {
          text: '1',
          confidence: 90,
          bbox: { x0: 70, y0: 10, x1: 85, y1: 25 },
          words: [{ text: '1', confidence: 90, bbox: { x0: 70, y0: 10, x1: 85, y1: 25 } }],
        },
        {
          text: '∫ x dx',
          confidence: 90,
          bbox: { x0: 10, y0: 30, x1: 90, y1: 90 },
          words: [
            { text: '∫', confidence: 90, bbox: { x0: 10, y0: 30, x1: 25, y1: 90 } },
            { text: 'x dx', confidence: 90, bbox: { x0: 30, y0: 45, x1: 90, y1: 75 } },
          ],
        },
        {
          text: '0',
          confidence: 90,
          bbox: { x0: 15, y0: 95, x1: 25, y1: 110 },
          words: [{ text: '0', confidence: 90, bbox: { x0: 15, y0: 95, x1: 25, y1: 110 } }],
        },
      ];

      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 3, 'Must reject limits violating horizontal proximity');
    });

    it('synthetic geometry (e): differential-less "∫ x" body does not reconstruct', () => {
      const ocrLines: OcrLine[] = [
        {
          text: '1',
          confidence: 90,
          bbox: { x0: 25, y0: 10, x1: 35, y1: 25 },
          words: [{ text: '1', confidence: 90, bbox: { x0: 25, y0: 10, x1: 35, y1: 25 } }],
        },
        {
          text: '∫ x',
          confidence: 90,
          bbox: { x0: 10, y0: 30, x1: 50, y1: 90 },
          words: [
            { text: '∫', confidence: 90, bbox: { x0: 10, y0: 30, x1: 25, y1: 90 } },
            { text: 'x', confidence: 90, bbox: { x0: 30, y0: 45, x1: 50, y1: 75 } },
          ],
        },
        {
          text: '0',
          confidence: 90,
          bbox: { x0: 15, y0: 95, x1: 25, y1: 110 },
          words: [{ text: '0', confidence: 90, bbox: { x0: 15, y0: 95, x1: 25, y1: 110 } }],
        },
      ];

      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 3, 'Must reject body lacking differential anchor');
    });

    it('negative: French prose lines surrounding a tall "[" with limit-like digits but body without differential stay unreconstructed', () => {
      const ocrLines: OcrLine[] = [
        {
          text: 'Soit n = 1',
          confidence: 90,
          bbox: { x0: 20, y0: 10, x1: 60, y1: 25 },
          words: [
            { text: 'Soit', confidence: 90, bbox: { x0: 20, y0: 10, x1: 35, y1: 25 } },
            { text: 'n', confidence: 90, bbox: { x0: 38, y0: 10, x1: 45, y1: 25 } },
            { text: '=', confidence: 90, bbox: { x0: 48, y0: 10, x1: 52, y1: 25 } },
            { text: '1', confidence: 90, bbox: { x0: 55, y0: 10, x1: 60, y1: 25 } },
          ],
        },
        {
          text: '[ fonction continue',
          confidence: 85,
          bbox: { x0: 10, y0: 30, x1: 150, y1: 90 },
          words: [
            { text: '[', confidence: 85, bbox: { x0: 10, y0: 30, x1: 25, y1: 90 } },
            { text: 'fonction', confidence: 85, bbox: { x0: 30, y0: 45, x1: 90, y1: 75 } },
            { text: 'continue', confidence: 85, bbox: { x0: 95, y0: 45, x1: 150, y1: 75 } },
          ],
        },
        {
          text: 'pour k = 0',
          confidence: 90,
          bbox: { x0: 20, y0: 95, x1: 60, y1: 110 },
          words: [
            { text: 'pour', confidence: 90, bbox: { x0: 20, y0: 95, x1: 40, y1: 110 } },
            { text: 'k', confidence: 90, bbox: { x0: 43, y0: 95, x1: 48, y1: 110 } },
            { text: '=', confidence: 90, bbox: { x0: 50, y0: 95, x1: 54, y1: 110 } },
            { text: '0', confidence: 90, bbox: { x0: 56, y0: 95, x1: 60, y1: 110 } },
          ],
        },
      ];

      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 3, 'Must not reconstruct French prose around tall [');
    });

    it('negative: matrix-like "[" block with dx-free body stays unreconstructed', () => {
      const ocrLines: OcrLine[] = [
        {
          text: '1 2',
          confidence: 90,
          bbox: { x0: 20, y0: 10, x1: 50, y1: 25 },
          words: [{ text: '1', confidence: 90, bbox: { x0: 20, y0: 10, x1: 30, y1: 25 } }, { text: '2', confidence: 90, bbox: { x0: 35, y0: 10, x1: 50, y1: 25 } }],
        },
        {
          text: '[ 3 4',
          confidence: 85,
          bbox: { x0: 10, y0: 30, x1: 70, y1: 90 },
          words: [
            { text: '[', confidence: 85, bbox: { x0: 10, y0: 30, x1: 25, y1: 90 } },
            { text: '3', confidence: 85, bbox: { x0: 30, y0: 45, x1: 45, y1: 75 } },
            { text: '4', confidence: 85, bbox: { x0: 50, y0: 45, x1: 70, y1: 75 } },
          ],
        },
        {
          text: '5 6',
          confidence: 90,
          bbox: { x0: 20, y0: 95, x1: 50, y1: 110 },
          words: [{ text: '5', confidence: 90, bbox: { x0: 20, y0: 95, x1: 30, y1: 110 } }, { text: '6', confidence: 90, bbox: { x0: 35, y0: 95, x1: 50, y1: 110 } }],
        },
      ];

      const reconstructed = reconstructStackedIntegrals(ocrLines);
      assert.equal(reconstructed.length, 3, 'Must not reconstruct matrix row block as integral');
    });

    it('end-to-end: converts case_04_integral.png to \\int_{0}^{1} in production pipeline', async () => {
      const imgPath = path.join(REAL_FIXTURES_DIR, 'case_04_integral.png');
      const buffer = fs.readFileSync(imgPath);

      const result = await convertImageToLatex(buffer, { mode: 'fragment' });
      assert.ok(result.latex.includes('\\int_{0}^{1}'), `Expected \\int_{0}^{1}, got:\n${result.latex}`);
      assert.ok(result.latex.includes('dx'), `Expected dx in integrand, got:\n${result.latex}`);
      assert.ok(result.hasMath, 'Must detect mathematical content');
    });
  });
});

describe('Tabular Structure Detection & Booktabs Conversion', () => {
  it('converts pipe-delimited markdown table to LaTeX table with booktabs', () => {
    const ocrData = {
      text: [
        '| Metric | Value | Units |',
        '| --- | --- | --- |',
        '| Speed | 120 | km/h |',
        '| Mass | 45 | kg |',
      ].join('\n'),
      confidence: 95,
    };

    const result = detectAndParseTable(ocrData);
    assert.equal(result.isTable, true);
    assert.ok(result.latex?.includes('\\begin{table}[htbp]'));
    assert.ok(result.latex?.includes('\\begin{tabular}{lll}'));
    assert.ok(result.latex?.includes('\\toprule'));
    assert.ok(result.latex?.includes('Metric & Value & Units'));
    assert.ok(result.latex?.includes('\\midrule'));
    assert.ok(result.latex?.includes('Speed & 120 & $km/h$') || result.latex?.includes('Speed & 120 & km/h'));
    assert.ok(result.latex?.includes('\\bottomrule'));
    assert.ok(result.latex?.includes('\\end{tabular}'));
  });

  it('preserves empty cells in pipe-delimited tables without column shifting', () => {
    const ocrData = {
      text: [
        '| Item | Price | Stock |',
        '| --- | --- | --- |',
        '| Apple | | 50 |',
        '| | 0.99 | 100 |',
        '| Orange | 1.25 | |',
      ].join('\n'),
      confidence: 92,
    };

    const result = detectAndParseTable(ocrData);
    assert.equal(result.isTable, true);
    assert.ok(result.latex?.includes('Item & Price & Stock \\\\'));
    // Apple has empty Price, Stock (50) is in 3rd column
    assert.ok(result.latex?.includes('Apple &  & 50 \\\\') || result.latex?.includes('Apple & & 50 \\\\'));
    // Leading empty cell, Price (0.99) in 2nd column, Stock (100) in 3rd column
    assert.ok(result.latex?.includes('& 0.99 & 100 \\\\') || result.latex?.includes(' & 0.99 & 100 \\\\'));
    // Trailing empty cell
    assert.ok(result.latex?.includes('Orange & 1.25 &  \\\\') || result.latex?.includes('Orange & 1.25 & \\\\'));
  });

  it('preserves empty cells in space-aligned tables without column shifting', () => {
    const ocrData = {
      text: [
        'Product     Price     Qty',
        'Apple       1.50      10',
        'Banana                20',
        '            2.50      15',
        'Orange      3.00',
      ].join('\n'),
      confidence: 90,
    };

    const result = detectAndParseTable(ocrData);
    assert.equal(result.isTable, true);
    assert.ok(result.latex?.includes('Product & Price & Qty \\\\'));
    assert.ok(result.latex?.includes('Apple & 1.50 & 10 \\\\'));
    // Banana has empty price, Qty (20) must be in 3rd column
    assert.ok(result.latex?.includes('Banana &  & 20 \\\\') || result.latex?.includes('Banana & & 20 \\\\'));
    // Empty product column
    assert.ok(result.latex?.includes('& 2.50 & 15 \\\\') || result.latex?.includes(' & 2.50 & 15 \\\\'));
    // Empty trailing qty column
    assert.ok(result.latex?.includes('Orange & 3.00 &  \\\\') || result.latex?.includes('Orange & 3.00 & \\\\'));
  });

  it('preserves empty cells in pipe tables without outer border pipes', () => {
    const ocrData = {
      text: [
        'A | B | C',
        '1 |   | 3',
        '  | 2 | 3',
        '1 | 2 |  ',
      ].join('\n'),
      confidence: 90,
    };

    const result = detectAndParseTable(ocrData);
    assert.equal(result.isTable, true);
    assert.ok(result.latex?.includes('A & B & C \\\\'));
    assert.ok(result.latex?.includes('1 &  & 3 \\\\') || result.latex?.includes('1 & & 3 \\\\'));
    assert.ok(result.latex?.includes('& 2 & 3 \\\\') || result.latex?.includes(' & 2 & 3 \\\\'));
    assert.ok(result.latex?.includes('1 & 2 &  \\\\') || result.latex?.includes('1 & 2 & \\\\'));
  });

  it('rejects ambiguous unstructured text as not a table', () => {
    const ocrData = {
      text: [
        'This is a regular paragraph of text.',
        'It contains words separated by single spaces.',
        'There are no consistent column boundaries.',
      ].join('\n'),
      confidence: 90,
    };

    const result = detectAndParseTable(ocrData);
    assert.equal(result.isTable, false);
  });

  it('detects token-aligned grid from OCR words and escapes currency dollar signs', () => {
    const ocrData = {
      text: 'Item Quantity Price\nApples 10 $5.00\nOranges 8 $4.50',
      confidence: 90,
      lines: [
        { text: 'Item Quantity Price', confidence: 95, words: [{ text: 'Item' }, { text: 'Quantity' }, { text: 'Price' }] },
        { text: 'Apples 10 $5.00', confidence: 95, words: [{ text: 'Apples' }, { text: '10' }, { text: '$5.00' }] },
        { text: 'Oranges 8 $4.50', confidence: 95, words: [{ text: 'Oranges' }, { text: '8' }, { text: '$4.50' }] },
      ],
    };

    const result = detectAndParseTable(ocrData);
    assert.equal(result.isTable, true);
    assert.ok(result.latex?.includes('\\begin{table}[htbp]'));
    assert.ok(result.latex?.includes('Item & Quantity & Price \\\\'));
    assert.ok(result.latex?.includes('Apples & 10 & \\$5.00 \\\\'));
    assert.ok(result.latex?.includes('Oranges & 8 & \\$4.50 \\\\'));
  });

  it('negative: rejects prose lines with uniform word count as not a table', () => {
    const ocrData = {
      text: 'The quick brown fox jumps\nA second five word line\nAnother five word text line',
      confidence: 90,
      lines: [
        { text: 'The quick brown fox jumps', confidence: 90, words: [{ text: 'The' }, { text: 'quick' }, { text: 'brown' }, { text: 'fox' }, { text: 'jumps' }] },
        { text: 'A second five word line', confidence: 90, words: [{ text: 'A' }, { text: 'second' }, { text: 'five' }, { text: 'word' }, { text: 'line' }] },
        { text: 'Another five word text line', confidence: 90, words: [{ text: 'Another' }, { text: 'five' }, { text: 'word' }, { text: 'text' }, { text: 'line' }] },
      ],
    };

    const result = detectAndParseTable(ocrData);
    assert.equal(result.isTable, false, 'Prose with stopwords should not become a table');
  });

  it('negative: rejects equation lines with uniform word count as not a table', () => {
    const ocrData = {
      text: 'a = b + c\nx = y + z\np = q + r',
      confidence: 90,
      lines: [
        { text: 'a = b + c', confidence: 90, words: [{ text: 'a' }, { text: '=' }, { text: 'b' }, { text: '+' }, { text: 'c' }] },
        { text: 'x = y + z', confidence: 90, words: [{ text: 'x' }, { text: '=' }, { text: 'y' }, { text: '+' }, { text: 'z' }] },
        { text: 'p = q + r', confidence: 90, words: [{ text: 'p' }, { text: '=' }, { text: 'q' }, { text: '+' }, { text: 'r' }] },
      ],
    };

    const result = detectAndParseTable(ocrData);
    assert.equal(result.isTable, false, 'Equation lines should not become a table');
  });

  it('negative: rejects French instructional sentences with uniform word count as not a table', () => {
    const ocrData = {
      text: 'Calculer la valeur de x\nMontrer le résultat du test\nVérifier la réponse finale ici',
      confidence: 90,
      lines: [
        { text: 'Calculer la valeur de x', confidence: 90, words: [{ text: 'Calculer' }, { text: 'la' }, { text: 'valeur' }, { text: 'de' }, { text: 'x' }] },
        { text: 'Montrer le résultat du test', confidence: 90, words: [{ text: 'Montrer' }, { text: 'le' }, { text: 'résultat' }, { text: 'du' }, { text: 'test' }] },
        { text: 'Vérifier la réponse finale ici', confidence: 90, words: [{ text: 'Vérifier' }, { text: 'la' }, { text: 'réponse' }, { text: 'finale' }, { text: 'ici' }] },
      ],
    };

    const result = detectAndParseTable(ocrData);
    assert.equal(result.isTable, false, 'French instructional action verbs should not become a table');
  });

  it('negative: rejects French prose with equal word counts and a number as not a table', () => {
    const ocrData = {
      text: 'Le prix est de 5 euros\nIl a payé 7 euros ici',
      confidence: 90,
      lines: [
        { text: 'Le prix est de 5 euros', confidence: 90, words: [{ text: 'Le' }, { text: 'prix' }, { text: 'est' }, { text: 'de' }, { text: '5' }, { text: 'euros' }] },
        { text: 'Il a payé 7 euros ici', confidence: 90, words: [{ text: 'Il' }, { text: 'a' }, { text: 'payé' }, { text: '7' }, { text: 'euros' }, { text: 'ici' }] },
      ],
    };
    const result = detectAndParseTable(ocrData);
    assert.equal(result.isTable, false, 'French prose with numbers should not become a table');
  });

  it('negative: rejects English instruction list with numbers as not a table', () => {
    const ocrData = {
      text: 'Compute the first 5 values\nSelect the next 5 options',
      confidence: 90,
      lines: [
        { text: 'Compute the first 5 values', confidence: 90, words: [{ text: 'Compute' }, { text: 'the' }, { text: 'first' }, { text: '5' }, { text: 'values' }] },
        { text: 'Select the next 5 options', confidence: 90, words: [{ text: 'Select' }, { text: 'the' }, { text: 'next' }, { text: '5' }, { text: 'options' }] },
      ],
    };
    const result = detectAndParseTable(ocrData);
    assert.equal(result.isTable, false, 'Instruction list with numbers should not become a table');
  });

  it('negative: rejects numbered list as not a table', () => {
    const ocrData = {
      text: '1. Compute x\n2. Compute y',
      confidence: 90,
      lines: [
        { text: '1. Compute x', confidence: 90, words: [{ text: '1.' }, { text: 'Compute' }, { text: 'x' }] },
        { text: '2. Compute y', confidence: 90, words: [{ text: '2.' }, { text: 'Compute' }, { text: 'y' }] },
      ],
    };
    const result = detectAndParseTable(ocrData);
    assert.equal(result.isTable, false, 'Numbered list should not become a table');
  });

  it('negative: rejects short equations without equal sign as not a table', () => {
    const ocrData = {
      text: 'x + 1\ny + 2',
      confidence: 90,
      lines: [
        { text: 'x + 1', confidence: 90, words: [{ text: 'x' }, { text: '+' }, { text: '1' }] },
        { text: 'y + 2', confidence: 90, words: [{ text: 'y' }, { text: '+' }, { text: '2' }] },
      ],
    };
    const result = detectAndParseTable(ocrData);
    assert.equal(result.isTable, false, 'Short equations without equal sign should not become a table');
  });

  it('positive: correctly detects real table fixtures, 2-row header+data, and 3-row numeric table', async () => {
    // 1. 2-row header + data case
    const twoRowData = {
      text: 'Product Price\nKeyboard $49.99',
      confidence: 92,
      lines: [
        { text: 'Product Price', confidence: 95, words: [{ text: 'Product' }, { text: 'Price' }] },
        { text: 'Keyboard $49.99', confidence: 95, words: [{ text: 'Keyboard' }, { text: '$49.99' }] },
      ],
    };
    const twoRowRes = detectAndParseTable(twoRowData);
    assert.equal(twoRowRes.isTable, true, '2-row header + data must be recognized as a table');
    assert.ok(twoRowRes.latex?.includes('Product & Price \\\\'));
    assert.ok(twoRowRes.latex?.includes('Keyboard & \\$49.99 \\\\'));

    // 2. 3-row numeric data case
    const threeRowData = {
      text: '10.5 20.0 30.5\n40.2 50.1 60.3\n70.8 80.4 90.9',
      confidence: 90,
      lines: [
        { text: '10.5 20.0 30.5', confidence: 90, words: [{ text: '10.5' }, { text: '20.0' }, { text: '30.5' }] },
        { text: '40.2 50.1 60.3', confidence: 90, words: [{ text: '40.2' }, { text: '50.1' }, { text: '60.3' }] },
        { text: '70.8 80.4 90.9', confidence: 90, words: [{ text: '70.8' }, { text: '80.4' }, { text: '90.9' }] },
      ],
    };
    const threeRowRes = detectAndParseTable(threeRowData);
    assert.equal(threeRowRes.isTable, true, '3-row numeric grid must be recognized as a table');
    assert.ok(threeRowRes.latex?.includes('10.5 & 20.0 & 30.5 \\\\'));

    // 3. table_sample.png fixture
    const sampleImg = fs.readFileSync(path.join(FIXTURES_DIR, 'table_sample.png'));
    const sampleRes = await convertImageToLatex(sampleImg, { mode: 'fragment' });
    assert.ok(sampleRes.latex.includes('\\begin{tabular}') || sampleRes.latex.includes('\\begin{table}'), 'table_sample.png must be detected as a table');

    // 4. Multi-column table with mathematical expressions
    const mathTableData = {
      text: '| Function | Derivative | Integral |\n| f(x) = x^2 | f\'(x) = 2x | F(x) = x^3/3 |\n| g(x) = sin(x) | g\'(x) = cos(x) | G(x) = -cos(x) |',
      confidence: 90,
    };
    const mathTableRes = detectAndParseTable(mathTableData);
    assert.equal(mathTableRes.isTable, true, 'Markdown table containing math expressions must be detected as a table');
    assert.ok(mathTableRes.latex?.includes('Function & Derivative & Integral'));
  });
});

describe('LaTeX Output Formatting (Fragment vs Document & Figure Embedding)', () => {
  it('formats Mode 1 (Fragment) without document preamble', () => {
    const content = '\\[\nE = mc^{2}\n\\]';
    const output = formatLatexOutput(content, { mode: 'fragment' });
    assert.equal(output, content);
    assert.ok(!output.includes('\\documentclass'));
  });

  it('formats Mode 2 (Complete Document) with article class and amsmath', () => {
    const content = '\\[\nE = mc^{2}\n\\]';
    const output = formatLatexOutput(content, { mode: 'document' });
    assert.ok(output.includes('\\documentclass[11pt,a4paper]{article}'));
    assert.ok(output.includes('\\usepackage{amsmath,amssymb,amsfonts}'));
    assert.ok(output.includes('\\begin{document}'));
    assert.ok(output.includes(content));
    assert.ok(output.includes('\\end{document}'));
  });

  it('configures French babel when hasFrench is true in document mode', () => {
    const content = 'Soit f une fonction continue.';
    const output = formatLatexOutput(content, { mode: 'document', hasFrench: true });
    assert.ok(output.includes('\\usepackage[french,english]{babel}'));
  });

  it('embeds \\begin{figure} when embedFigure option is enabled', () => {
    const content = '\\[\nE = mc^{2}\n\\]';
    const output = formatLatexOutput(content, {
      mode: 'fragment',
      embedFigure: true,
      imageFileName: 'formula.png',
    });
    assert.ok(output.includes('\\begin{figure}[htbp]'));
    assert.ok(output.includes('\\includegraphics[width=0.8\\linewidth]{formula.png}'));
    assert.ok(output.includes('\\caption{Image: formula.png}'));
    assert.ok(output.includes('\\label{fig:recognized-image}'));
    assert.ok(output.includes('\\end{figure}'));
    assert.ok(output.includes(content));
  });
});

describe('Offline Tesseract OCR Engine (End-to-End on Fixtures)', () => {
  it('converts math_equation.png fixture to LaTeX', async () => {
    const imgPath = path.resolve(__dirname, 'fixtures/math_equation.png');
    const imgBuffer = fs.readFileSync(imgPath);

    const result = await convertImageToLatex(imgBuffer, {
      mode: 'fragment',
    });

    assert.ok(result.latex.length > 0, 'Latex output should not be empty');
    assert.ok(
      result.latex.includes('E =') || result.latex.includes('mc') || result.latex.includes('f(x)') || result.latex.includes('x^'),
      `Expected math components in OCR output, got:\n${result.latex}`
    );
    assert.ok(result.confidence > 0, 'Confidence should be positive');
  });

  it('converts french_sample.png fixture and preserves accented characters', async () => {
    const imgPath = path.resolve(__dirname, 'fixtures/french_sample.png');
    const imgBuffer = fs.readFileSync(imgPath);

    const result = await convertImageToLatex(imgBuffer, {
      mode: 'fragment',
      hasFrench: true,
    });

    assert.ok(result.latex.length > 0, 'Latex output should not be empty');
    // Accented French characters: é, è, à, ç, etc.
    const hasAccents = /[éèàçùœThéorème]/i.test(result.latex);
    assert.ok(
      hasAccents || result.latex.toLowerCase().includes('caract') || result.latex.toLowerCase().includes('fonction'),
      `Expected French text/accents in output, got:\n${result.latex}`
    );
  });

  it('converts synthetic_table_ref.png without dropping rows or returning header alone', async () => {
    const imgPath = path.resolve(__dirname, 'fixtures/synthetic_table_ref.png');
    const imgBuffer = fs.readFileSync(imgPath);

    const result = await convertImageToLatex(imgBuffer, {
      mode: 'fragment',
    });

    assert.ok(result.rawText.trim().length > 0, 'Recognized text must not be empty');
    assert.ok(result.rawText.includes('Age'), 'Output must contain header "Age"');

    const ageRowPatterns = [
      /20-29/,
      /30-39/,
      /40-49/,
      /50-59/,
      /60-69/,
      /70-79/,
      /80/,
    ];
    const matchedRows = ageRowPatterns.filter((p) => p.test(result.rawText));
    assert.ok(
      matchedRows.length >= 5,
      `Expected at least 5 of 7 age rows to be recognized, matched ${matchedRows.length}:\n${result.rawText}`
    );

    // Output must not be just a header alone
    const bodyLines = result.latex
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('%'));
    assert.ok(
      bodyLines.length >= 5,
      `Output must contain content rows beyond headers alone, got:\n${bodyLines.join('\n')}`
    );
  });
});

describe('OCR Retry Logic (convertImageToLatex & Stub Engine)', () => {
  it('triggers retry with PSM 3 and PSM 4 when first pass confidence < 60', async () => {
    const calls: Array<{ image: any; options: any }> = [];
    const stubEngine: ImageRecognitionEngine = {
      id: 'stub-retry-test',
      name: 'Stub Engine for Retry Test',
      async recognize(image, options) {
        calls.push({ image, options });
        if (calls.length === 1) {
          return {
            engine: 'stub',
            rawText: 'uncertain text',
            latex: 'uncertain latex',
            confidence: 25,
            quality: 'uncertain',
            warnings: [],
            isTable: false,
            hasMath: false,
          };
        }
        if (options.psm === '3') {
          return {
            engine: 'stub',
            rawText: 'Age 20-29 ans',
            latex: 'Age 20-29 ans',
            confidence: 75,
            quality: 'medium',
            warnings: [],
            isTable: false,
            hasMath: false,
          };
        }
        return {
          engine: 'stub',
          rawText: 'Age 20-29 ans | 0.45 - 2.10',
          latex: 'Age 20-29 ans | 0.45 - 2.10',
          confidence: 85,
          quality: 'medium',
          warnings: [],
          isTable: false,
          hasMath: false,
        };
      },
    };

    const origEngine = getActiveRecognitionEngine();
    try {
      setRecognitionEngine(stubEngine);
      const dummyBuffer = Buffer.from('fake-image-bytes');
      const result = await convertImageToLatex(dummyBuffer, { mode: 'fragment' });

      assert.equal(calls.length, 3, 'convertImageToLatex must retry with both PSM 3 and PSM 4 when confidence < 60');
      assert.equal(calls[1].options.psm, '3', 'Retry call 1 must request PSM 3');
      assert.equal(calls[2].options.psm, '4', 'Retry call 2 must request PSM 4');
      assert.equal(result.confidence, 85, 'Result should adopt higher retry confidence');
      assert.equal(result.rawText, 'Age 20-29 ans | 0.45 - 2.10');
    } finally {
      setRecognitionEngine(origEngine);
    }
  });

  it('does not trigger retry when first pass confidence >= 60', async () => {
    const calls: Array<{ image: any; options: any }> = [];
    const stubEngine: ImageRecognitionEngine = {
      id: 'stub-no-retry-test',
      name: 'Stub Engine No Retry',
      async recognize(image, options) {
        calls.push({ image, options });
        return {
          engine: 'stub',
          rawText: 'High confidence content',
          latex: 'High confidence content',
          confidence: 80,
          quality: 'high',
          warnings: [],
          isTable: false,
          hasMath: false,
        };
      },
    };

    const origEngine = getActiveRecognitionEngine();
    try {
      setRecognitionEngine(stubEngine);
      const dummyBuffer = Buffer.from('fake-image-bytes');
      const result = await convertImageToLatex(dummyBuffer, { mode: 'fragment' });

      assert.equal(calls.length, 1, 'convertImageToLatex must not retry when confidence >= 60');
      assert.equal(result.confidence, 80);
    } finally {
      setRecognitionEngine(origEngine);
    }
  });

  it('retains first pass result if retry pass yields lower confidence', async () => {
    const calls: Array<{ image: any; options: any }> = [];
    const stubEngine: ImageRecognitionEngine = {
      id: 'stub-retry-lower-conf',
      name: 'Stub Engine Lower Conf Retry',
      async recognize(image, options) {
        calls.push({ image, options });
        if (calls.length === 1) {
          return {
            engine: 'stub',
            rawText: 'First pass text',
            latex: 'First pass text',
            confidence: 45,
            quality: 'uncertain',
            warnings: [],
            isTable: false,
            hasMath: false,
          };
        }
        return {
          engine: 'stub',
          rawText: 'Worse text',
          latex: 'Worse text',
          confidence: 15,
          quality: 'uncertain',
          warnings: [],
          isTable: false,
          hasMath: false,
        };
      },
    };

    const origEngine = getActiveRecognitionEngine();
    try {
      setRecognitionEngine(stubEngine);
      const dummyBuffer = Buffer.from('fake-image-bytes');
      const result = await convertImageToLatex(dummyBuffer, { mode: 'fragment' });

      assert.equal(calls.length, 3, 'Retry should run PSM 3 and PSM 4');
      assert.equal(result.confidence, 45, 'Should keep first pass when retry confidence is lower');
      assert.equal(result.rawText, 'First pass text');
    } finally {
      setRecognitionEngine(origEngine);
    }
  });

  it('rejects retry if retry text is shorter than first pass by more than 30%', async () => {
    const calls: Array<{ image: any; options: any }> = [];
    const stubEngine: ImageRecognitionEngine = {
      id: 'stub-shorter-retry',
      name: 'Stub Engine Shorter Text Retry',
      async recognize(image, options) {
        calls.push({ image, options });
        if (calls.length === 1) {
          return {
            engine: 'stub',
            rawText: 'This is a long first pass text with many characters here.',
            latex: 'This is a long first pass text with many characters here.',
            confidence: 40,
            quality: 'uncertain',
            warnings: [],
            isTable: false,
            hasMath: false,
          };
        }
        return {
          engine: 'stub',
          rawText: 'Short text',
          latex: 'Short text',
          confidence: 85,
          quality: 'high',
          warnings: [],
          isTable: false,
          hasMath: false,
        };
      },
    };

    const origEngine = getActiveRecognitionEngine();
    try {
      setRecognitionEngine(stubEngine);
      const dummyBuffer = Buffer.from('fake-image-bytes');
      const result = await convertImageToLatex(dummyBuffer, { mode: 'fragment' });

      assert.equal(calls.length, 3, 'Retry should run PSM 3 and PSM 4');
      assert.equal(result.confidence, 40, 'Should reject retry because character count dropped by > 30%');
      assert.equal(result.rawText, 'This is a long first pass text with many characters here.');
    } finally {
      setRecognitionEngine(origEngine);
    }
  });
});

describe('Currency Dollar Escaping vs Inline Math', () => {
  it('escapes a prose line with "$300" to "\\$300"', () => {
    const input = 'The monthly subscription is $300 per user.';
    const output = parseOcrToLatex({ text: input, confidence: 90 });
    assert.ok(output.includes('\\$300'), `Expected \\$300 in output, got: ${output}`);
    assert.ok(!output.includes('$$300'), `Should not double dollar: ${output}`);
    assert.equal(escapeProseDollarSigns(input), 'The monthly subscription is \\$300 per user.');
  });

  it('keeps a line already containing "\\$" as "\\$" without double escaping', () => {
    const input = 'The price was reduced from \\$300 to \\$150.';
    const output = parseOcrToLatex({ text: input, confidence: 90 });
    assert.ok(output.includes('\\$300'), `Expected \\$300 in output, got: ${output}`);
    assert.ok(!output.includes('\\\\$300'), `Should not double escape: ${output}`);
    assert.equal(escapeProseDollarSigns(input), 'The price was reduced from \\$300 to \\$150.');
  });

  it('preserves an inline math line with $x$ without breaking math mode', () => {
    const input = 'Let $x$ be an arbitrary element of the set.';
    const output = parseOcrToLatex({ text: input, confidence: 90 });
    assert.ok(output.includes('$x$'), `Expected inline math $x$ preserved, got: ${output}`);
    assert.ok(!output.includes('\\$x\\$'), `Should not escape inline math: ${output}`);
    assert.equal(escapeProseDollarSigns(input), 'Let $x$ be an arbitrary element of the set.');
  });
});

describe('Blank Image Recognition Handling', () => {
  it('returns "No text recognized" message and no empty header-only output on blank 100x100 white image', async () => {
    const blankBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    }).png().toBuffer();

    const result = await convertImageToLatex(blankBuffer, { mode: 'fragment' });

    assert.equal(result.rawText.trim(), '', 'Raw text should be empty for blank image');
    assert.equal(result.quality, 'uncertain');
    assert.ok(
      result.warnings.some((w) =>
        w.message.includes('No text recognized: crop to the content, enlarge the image, and avoid screenshots with large empty margins')
      ),
      'Must contain warning about no text recognized'
    );
    assert.ok(
      result.latex.includes('% No text recognized: crop to the content, enlarge the image, and avoid screenshots with large empty margins'),
      'Must include diagnostic comment in body'
    );
    const bodyCommentFound = result.latex.includes('% No text recognized: crop to the content, enlarge the image, and avoid screenshots with large empty margins');
    assert.ok(bodyCommentFound, 'Latex output must contain explanatory body');
  });
});

describe('Playwright UI Interactivity: Image to LaTeX Tab', () => {
  let browser: Browser;
  let page: Page;

  before(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.goto(DIST_POPUP_PATH);
  });

  after(async () => {
    await browser?.close();
    await terminateTesseractWorker();
  });

  it('displays three tabs including Image to LaTeX', async () => {
    const tabUpload = page.locator('#tab-upload');
    const tabPaste = page.locator('#tab-paste');
    const tabImage = page.locator('#tab-image');

    assert.equal(await tabUpload.isVisible(), true);
    assert.equal(await tabPaste.isVisible(), true);
    assert.equal(await tabImage.isVisible(), true);
    assert.equal(await tabImage.innerText(), 'Image to LaTeX');
  });

  it('switches to Image tab and verifies initial idle state', async () => {
    await page.click('#tab-image');

    const panelImage = page.locator('#panel-image');
    assert.equal(await panelImage.isVisible(), true);

    const panelUpload = page.locator('#panel-upload');
    assert.equal(await panelUpload.isVisible(), false);

    const panelPaste = page.locator('#panel-paste');
    assert.equal(await panelPaste.isVisible(), false);

    // Convert button idle and disabled
    const convertBtn = page.locator('#convert-image-btn');
    assert.equal(await convertBtn.isDisabled(), true, 'Convert button should be disabled without image');

    const spinner = page.locator('#convert-image-btn .btn-spinner');
    assert.equal(await spinner.isVisible(), false, 'Spinner must not be visible on idle');

    // Preview card hidden initially
    const previewCard = page.locator('#image-preview-card');
    assert.equal(await previewCard.isVisible(), false, 'Preview card should be hidden initially');
  });

  it('selects an image file and displays preview card', async () => {
    const fixturePath = path.resolve(__dirname, 'fixtures/math_fraction.png');
    const imageInput = page.locator('#image-file');
    await imageInput.setInputFiles(fixturePath);

    // Preview card should become visible
    const previewCard = page.locator('#image-preview-card');
    await previewCard.waitFor({ state: 'visible', timeout: 5000 });

    const imageName = await page.locator('#image-name').innerText();
    assert.equal(imageName, 'math_fraction.png');

    const imageSize = await page.locator('#image-info').innerText();
    assert.ok(imageSize.includes('KB') || imageSize.includes('B'));

    // Convert button should become enabled
    const convertBtn = page.locator('#convert-image-btn');
    assert.equal(await convertBtn.isDisabled(), false, 'Convert button should be enabled after image selection');
  });

  it('toggles output mode between Fragment and Document', async () => {
    const fragmentBtn = page.locator('#btn-mode-fragment');
    const docBtn = page.locator('#btn-mode-document');

    assert.ok((await fragmentBtn.getAttribute('class'))?.includes('active'));
    assert.ok(!(await docBtn.getAttribute('class'))?.includes('active'));

    await docBtn.click();
    assert.ok((await docBtn.getAttribute('class'))?.includes('active'));
    assert.ok(!(await fragmentBtn.getAttribute('class'))?.includes('active'));

    // Switch back
    await fragmentBtn.click();
    assert.ok((await fragmentBtn.getAttribute('class'))?.includes('active'));
  });

  it('clears selected image when Remove button is clicked', async () => {
    const clearBtn = page.locator('#clear-image-btn');
    await clearBtn.click({ force: true });

    const previewCard = page.locator('#image-preview-card');
    assert.equal(await previewCard.isVisible(), false, 'Preview card should be hidden after clear');

    const convertBtn = page.locator('#convert-image-btn');
    assert.equal(await convertBtn.isDisabled(), true, 'Convert button should be disabled after clear');
  });
});

describe('Numeric Quality Honesty & Misread Warnings', () => {
  it('caps quality at medium and warns when text contains multiple lines of decimal/grouped numbers and confidence < 85', () => {
    const ocrData = {
      text: 'Measurement A: 1.88\nMeasurement B: 7.29',
      confidence: 77,
    };
    const latex = 'Measurement A: 1.88\n\nMeasurement B: 7.29';
    const analysis = assessQuality(ocrData, latex);

    assert.equal(analysis.quality, 'medium', 'Quality must be capped at medium when confidence < 85 with multiple decimal lines');
    assert.ok(
      analysis.warnings.some(w =>
        w.message.includes('Numbers may be misread (decimal points, 1/7, 0/O, 5/S): verify every value against the source.')
      ),
      'Must contain numbers misread warning'
    );
  });

  it('does not warn on simple integer math formulas (x^2, 2x+1) or prose paragraphs even when confidence < 85', () => {
    const eqData = {
      text: 'f(x) = x^2 + 2x + 1',
      confidence: 80,
    };
    const eqAnalysis = assessQuality(eqData, '\\[ f(x) = x^2 + 2x + 1 \\]');
    assert.ok(
      !eqAnalysis.warnings.some(w => w.message.includes('Numbers may be misread')),
      'Should not warn about numbers on simple integer math'
    );

    const paraData = {
      text: "Soit f une fonction continue sur l'intervalle [0, 1]. Calculer la moyenne.",
      confidence: 82,
    };
    const paraAnalysis = assessQuality(paraData, "Soit f une fonction continue sur l'intervalle [0, 1]. Calculer la moyenne.");
    assert.ok(
      !paraAnalysis.warnings.some(w => w.message.includes('Numbers may be misread')),
      'Should not warn about numbers on prose paragraph with simple integers'
    );
  });

  it('permits high quality when confidence >= 85 and numeric tokens look clean', () => {
    const ocrData = {
      text: 'Measurement A: 1.88\nMeasurement B: 7.29',
      confidence: 90,
    };
    const latex = 'Measurement A: 1.88\n\nMeasurement B: 7.29';
    const analysis = assessQuality(ocrData, latex);

    assert.equal(analysis.quality, 'high', 'Clean numbers with high confidence should remain high');
    assert.ok(
      !analysis.warnings.some(w => w.message.includes('Numbers may be misread')),
      'Should not warn when confidence >= 85'
    );
  });

  it('warns when a 3+ digit sequence appears adjacent to lines using decimals', () => {
    const ocrData = {
      text: '30-34 ans 0.94 - 6.7\n35-39 ans 077-524\n40-44ans 0.097 - 2.96',
      confidence: 80,
    };
    const latex = '30-34 ans 0.94 - 6.7\n\n35-39 ans 077-524\n\n40-44ans 0.097 - 2.96';
    const analysis = assessQuality(ocrData, latex);

    assert.ok(
      analysis.warnings.some(w =>
        w.message.includes('Potential missing decimal points detected: 3+ digit sequence appears adjacent to decimal values')
      ),
      'Must warn about dropped decimal points'
    );
    assert.notEqual(analysis.quality, 'high', 'Must not report high quality with missing decimal anomaly');
  });
});

describe('Table Rows as Display Math vs Plain Text Preservation', () => {
  it('does not wrap synthetic table rows in display math and preserves plain text', () => {
    const ocrData = {
      text: 'Age ng/ml (sexe féminin)\n20-29 ans 0.45-2.10\n30-39 ans 0.55-2.80\n40-49 ans 0.70-3.40',
      confidence: 88,
    };
    const latex = parseOcrToLatex(ocrData);

    assert.ok(!latex.includes('\\['), `Synthetic table rows must not be wrapped in display math: ${latex}`);
    assert.ok(!latex.includes('\\]'), `Synthetic table rows must not have display math closing: ${latex}`);
    assert.ok(latex.includes('20-29 ans 0.45-2.10'), `Row 1 preserved: ${latex}`);
    assert.ok(latex.includes('30-39 ans 0.55-2.80'), `Row 2 preserved: ${latex}`);

    const quality = assessQuality(ocrData, latex);
    assert.ok(
      quality.warnings.some(w =>
        w.message.includes('Table structure detected but tables are not reconstructed; lines are preserved as plain text.')
      ),
      'Must emit warning that table is not reconstructed'
    );
  });

  it('does not wrap real lookalike table rows in display math', () => {
    const ocrData = {
      text: 'Age ng/ml (sexe féminin)\n20-24 ans 1.88 - 7.29\n25-29 ans 1.83 - 7.53\n30-34 ans 0.94 - 6.7\n35-39 ans 0.77 - 5.24',
      confidence: 82,
    };
    const latex = parseOcrToLatex(ocrData);

    assert.ok(!latex.includes('\\['), `Real lookalike rows must not be wrapped in display math: ${latex}`);
    assert.ok(!latex.includes('\\]'), `Real lookalike rows must not have closing display math: ${latex}`);
    assert.ok(latex.includes('20-24 ans 1.88 - 7.29'));
    assert.ok(latex.includes('25-29 ans 1.83 - 7.53'));

    const quality = assessQuality(ocrData, latex);
    assert.ok(
      quality.warnings.some(w =>
        w.message.includes('Table structure detected but tables are not reconstructed; lines are preserved as plain text.')
      ),
      'Must emit warning for real lookalike table rows'
    );
  });

  it('still wraps a real equation line in display math', () => {
    const eqData = {
      text: 'f(x) = x^2 + 2x + 1',
      confidence: 95,
    };
    const eqLatex = parseOcrToLatex(eqData);
    assert.ok(eqLatex.includes('\\['), `Real equation must be wrapped in display math: ${eqLatex}`);
    assert.ok(eqLatex.includes('\\]'), `Real equation must have closing delimiter: ${eqLatex}`);
  });

  it('preserves table rows as plain text while wrapping real equation in mixed input', () => {
    const mixedData = {
      text: '20-24 ans 1.88 - 7.29\n25-29 ans 1.83 - 7.53\nf(x) = x^2 + 1',
      confidence: 88,
    };
    const mixedLatex = parseOcrToLatex(mixedData);

    // Table rows should not be wrapped
    assert.ok(mixedLatex.includes('20-24 ans 1.88 - 7.29'));
    assert.ok(mixedLatex.includes('25-29 ans 1.83 - 7.53'));
    // Equation must be wrapped
    assert.ok(mixedLatex.includes('\\[\nf(x) = x^2 + 1\n\\]'), `Equation should be wrapped: ${mixedLatex}`);
  });
});

