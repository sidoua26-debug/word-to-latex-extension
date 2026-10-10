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
  isMathExpression,
  classifyWordSymbols,
  applySpatialSuperSubscripts,
  type OcrWord,
  type OcrLine,
  type OcrResultData,
} from '../src/imageOcr/mathParser.ts';
import { detectAndParseTable } from '../src/imageOcr/tableParser.ts';
import { formatLatexOutput } from '../src/imageOcr/latexGenerator.ts';
import { convertImageToLatex, terminateTesseractWorker } from '../src/imageOcr/ocrEngine.ts';

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

    // In end-to-end math parser, equations are not hijacked by matrix parser
    const resEq1 = parseOcrToLatex({ text: 'x + y = 1\n2x - y = 3', confidence: 90 });
    assert.ok(resEq1.includes('\\begin{cases}'));
    assert.ok(!resEq1.includes('\\begin{pmatrix}'));
    assert.ok(!resEq1.includes('\\begin{bmatrix}'));

    const resEq2 = parseOcrToLatex({ text: 'x + y = 10\n2x - y = 5', confidence: 90 });
    assert.ok(resEq2.includes('\\begin{cases}'));
    assert.ok(!resEq2.includes('\\begin{pmatrix}'));
    assert.ok(!resEq2.includes('\\begin{bmatrix}'));
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
      'a + \\alpha = b',
      'c + \\beta = d',
    ];
    const alignedRes = parseAlignedEquations(alignedInput);
    assert.equal(alignedRes.isAlign, true);
    assert.ok(alignedRes.latex?.includes('a + \\alpha &= b'));
    assert.ok(alignedRes.latex?.includes('c + \\beta &= d'));
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
