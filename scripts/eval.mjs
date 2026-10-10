/**
 * eval.mjs — Comprehensive Golden Corpus Evaluator.
 *
 * Measures:
 * 1. OCR CER (raw-text character error rate, NFC Unicode, whitespace collapsed)
 * 2. LaTeX-level CER & token-F1 (normalized LaTeX comparison for math samples)
 * 3. Line classification confusion matrix (prose, math, table, matrix, cases) + misclassification rate
 * 4. Per-structure precision and recall (superscript, subscript, fraction, matrix, cases, table, radical)
 * 5. Hallucination counter (strict 0 gate on supported and known_limitation samples)
 * 6. Expected LaTeX contains/forbids assertion pass rate & missing substrings list
 * 7. Compile success rate via local Tectonic engine (Fragment and Complete Document modes)
 * 8. Cold-start OCR time (first sample worker load) vs warm median runtime
 * 9. Slice analysis: overall, dev vs holdout vs stress, per language, per degradation tag
 * 10. Double-run variance measurement
 * 11. Baseline compare mode (--compare baseline.json)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';

import {
  convertImageToLatex,
  terminateTesseractWorker,
} from '../src/imageOcr/ocrEngine.ts';
import {
  isMathExpression,
  parseMatrix,
  parseCases,
  parseStackedFractions,
  parseOcrToLatex,
} from '../src/imageOcr/mathParser.ts';
import { detectAndParseTable } from '../src/imageOcr/tableParser.ts';
import { formatLatexOutput } from '../src/imageOcr/latexGenerator.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CORPUS_DIR = path.join(ROOT, 'corpus');
const MANIFEST_PATH = path.join(CORPUS_DIR, 'manifest.json');
const TECTONIC_BIN = path.join(ROOT, '.bin', 'tectonic');
const TMP_DIR = path.join(ROOT, '.tmp_compile');

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

// -------------------------------------------------------------
// Environment & Metadata Collection
// -------------------------------------------------------------

export function getEnvironmentMetadata() {
  let gitHash = 'unknown';
  let dirty = false;
  try {
    gitHash = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' }).trim();
    dirty = status.length > 0;
  } catch {}

  let tesseractVersion = 'unknown';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    tesseractVersion = pkg.dependencies?.['tesseract.js'] || 'unknown';
  } catch {}

  const traineddataHashes = {};
  const tessdataDir = path.join(ROOT, 'assets', 'tessdata');
  for (const lang of ['eng', 'fra']) {
    const p = path.join(tessdataDir, `${lang}.traineddata.gz`);
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p);
      traineddataHashes[lang] = crypto.createHash('sha256').update(buf).digest('hex');
    }
  }

  return {
    gitCommit: gitHash,
    gitDirty: dirty,
    nodeVersion: process.version,
    tesseractVersion,
    traineddataHashes,
    preprocessingConfig: {
      grayscale: true,
      contrastScale: 1.2,
      maxDimensionPx: 2200,
    },
  };
}

// -------------------------------------------------------------
// CER & Normalization Utilities
// -------------------------------------------------------------

export function normalizeForCer(text) {
  if (!text) return '';
  return text
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\s+\n/g, '\n')
    .trim();
}

export function normalizeLatexForEval(latex) {
  if (!latex) return '';
  return latex
    .normalize('NFC')
    .replace(/^% Required packages[\s\S]*?\n\n/m, '')
    .replace(/^% \\usepackage\{[^\}]+\}\s*\n?/gm, '')
    .replace(/\\\[([\s\S]*?)\\\]/g, '$1')
    .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
    .replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, '$1')
    .replace(/\\left\b/g, '')
    .replace(/\\right\b/g, '')
    .replace(/\\[,;:!]/g, ' ')
    .replace(/\\quad\b/g, ' ')
    .replace(/\\qquad\b/g, ' ')
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\mathrm\{([^}]*)\}/g, '$1')
    .replace(/\^\{([a-zA-Z0-9])\}/g, '^$1')
    .replace(/_\{([a-zA-Z0-9])\}/g, '_$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .trim();
}

export function levenshteinDistance(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,       // deletion
        dp[i][j - 1] + 1,       // insertion
        dp[i - 1][j - 1] + cost  // substitution
      );
    }
  }
  return dp[m][n];
}

export function computeCer(reference, hypothesis) {
  const normRef = normalizeForCer(reference);
  const normHyp = normalizeForCer(hypothesis);
  if (normRef.length === 0) {
    return normHyp.length === 0 ? 0 : 1.0;
  }
  const dist = levenshteinDistance(normRef, normHyp);
  return dist / normRef.length;
}

export function computeLatexCer(expectedLatex, generatedLatex) {
  if (!expectedLatex) return null;
  const normExp = normalizeLatexForEval(expectedLatex);
  const normGen = normalizeLatexForEval(generatedLatex);
  if (normExp.length === 0) {
    return normGen.length === 0 ? 0 : 1.0;
  }
  const dist = levenshteinDistance(normExp, normGen);
  return dist / normExp.length;
}

export function tokenizeLatex(str) {
  const normalized = normalizeLatexForEval(str);
  const tokens = [];
  const re = /\\[a-zA-Z]+|\d+|[a-zA-Z]|[\^_{}\(\)\[\]\+\-\*\/=><≠≤≥]/g;
  let match;
  while ((match = re.exec(normalized)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

export function computeTokenF1(expectedLatex, generatedLatex) {
  if (!expectedLatex) return null;
  const expTokens = tokenizeLatex(expectedLatex);
  const genTokens = tokenizeLatex(generatedLatex);

  if (expTokens.length === 0 && genTokens.length === 0) return 1.0;
  if (expTokens.length === 0 || genTokens.length === 0) return 0.0;

  const expCounts = {};
  for (const t of expTokens) expCounts[t] = (expCounts[t] || 0) + 1;

  let common = 0;
  const genCounts = {};
  for (const t of genTokens) genCounts[t] = (genCounts[t] || 0) + 1;

  for (const [t, count] of Object.entries(genCounts)) {
    if (expCounts[t]) {
      common += Math.min(count, expCounts[t]);
    }
  }

  const precision = common / genTokens.length;
  const recall = common / expTokens.length;
  if (precision + recall === 0) return 0.0;
  return (2 * precision * recall) / (precision + recall);
}

// -------------------------------------------------------------
// Structure Precision & Recall
// -------------------------------------------------------------

const STRUCTURE_KEYS = ['superscript', 'subscript', 'fraction', 'matrix', 'cases', 'table', 'radical'];

export function detectStructurePresence(text, latex, tags = []) {
  const tagsLower = tags.map(t => t.toLowerCase());
  return {
    superscript: /\^|\btextsuperscript\b/.test(latex) || /[²³¹⁰⁴⁵⁶⁷⁸⁹]|\^/.test(text) || tagsLower.includes('superscript'),
    subscript: /_|\btextsubscript\b/.test(latex) || /[₀₁₂₃₄₅₆₇₈₉]|_/.test(text) || tagsLower.includes('subscript'),
    fraction: /\\frac\{/.test(latex) || /[/½⅓⅔¼¾]|\bfrac\b/.test(text) || tagsLower.includes('fraction'),
    matrix: /\\begin\{(?:p|b|v|V|B)?matrix\}/.test(latex) || tagsLower.includes('matrix'),
    cases: /\\begin\{cases\}/.test(latex) || tagsLower.includes('cases') || tagsLower.includes('system'),
    table: /\\begin\{tabular\}/.test(latex) || tagsLower.includes('table'),
    radical: /\\sqrt\b/.test(latex) || /[√]|\bsqrt\b/.test(text) || tagsLower.includes('radical'),
  };
}

export function detectEmittedStructures(latex) {
  return {
    superscript: /\^|\btextsuperscript\b/.test(latex),
    subscript: /_|\btextsubscript\b/.test(latex),
    fraction: /\\frac\{/.test(latex),
    matrix: /\\begin\{(?:p|b|v|V|B)?matrix\}/.test(latex),
    cases: /\\begin\{cases\}/.test(latex),
    table: /\\begin\{tabular\}/.test(latex),
    radical: /\\sqrt\b/.test(latex),
  };
}

export function computeStructureMetrics(results) {
  const stats = {};
  for (const k of STRUCTURE_KEYS) {
    stats[k] = { tp: 0, fp: 0, fn: 0, tn: 0, precision: 1.0, recall: 1.0, f1: 1.0 };
  }

  for (const r of results) {
    const expected = detectStructurePresence(r.expectedText, r.expectedLatex, r.tags);
    const emitted = detectEmittedStructures(r.fragmentLatex);

    for (const k of STRUCTURE_KEYS) {
      if (expected[k] && emitted[k]) stats[k].tp++;
      else if (!expected[k] && emitted[k]) stats[k].fp++;
      else if (expected[k] && !emitted[k]) stats[k].fn++;
      else stats[k].tn++;
    }
  }

  for (const k of STRUCTURE_KEYS) {
    const { tp, fp, fn } = stats[k];
    const precision = tp + fp > 0 ? tp / (tp + fp) : 1.0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1.0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 1.0;
    stats[k].precision = precision;
    stats[k].recall = recall;
    stats[k].f1 = f1;
  }

  return stats;
}

// -------------------------------------------------------------
// Compilation Check
// -------------------------------------------------------------

function wrapInIndependentHarness(fragment, options = {}) {
  const isFrench = options.hasFrench ?? false;
  const clean = fragment
    .replace(/^% Required packages[\s\S]*?\n\n/m, '')
    .replace(/^% \\usepackage\{[^\}]+\}\s*\n?/gm, '')
    .trim();

  return [
    '\\documentclass[11pt,a4paper]{article}',
    '\\usepackage{iftex}',
    '\\ifPDFTeX',
    '  \\usepackage[utf8]{inputenc}',
    '  \\usepackage[T1]{fontenc}',
    '\\fi',
    isFrench ? '\\usepackage[french,english]{babel}' : '\\usepackage[english]{babel}',
    '\\usepackage{amsmath,amssymb,amsfonts}',
    '\\usepackage{booktabs}',
    '\\usepackage{longtable}',
    '\\usepackage{calc}',
    '\\usepackage{array}',
    '\\usepackage{graphicx}',
    '\\usepackage{ulem}',
    '',
    '\\begin{document}',
    '',
    clean,
    '',
    '\\end{document}',
  ].join('\n');
}

function compileLatex(latexCode, testName) {
  if (!fs.existsSync(TECTONIC_BIN)) {
    return { success: false, error: 'Tectonic compiler binary missing' };
  }

  const tmpFile = path.join(TMP_DIR, `eval_${testName.replace(/[^a-zA-Z0-9_-]/g, '_')}.tex`);
  fs.writeFileSync(tmpFile, latexCode, 'utf8');

  const res = spawnSync(TECTONIC_BIN, ['-o', TMP_DIR, tmpFile], {
    encoding: 'utf8',
    timeout: 30000,
  });

  const combinedOutput = (res.stdout || '') + '\n' + (res.stderr || '');
  const lines = combinedOutput.split('\n');

  const fatalErrors = [];
  let overfullCount = 0;

  for (const line of lines) {
    const l = line.trim();
    if (/Missing character:/i.test(l)) {
      fatalErrors.push(l);
    } else if (/Undefined control sequence/i.test(l)) {
      fatalErrors.push(l);
    } else if (/Emergency stop/i.test(l)) {
      fatalErrors.push(l);
    } else if (/LaTeX Error:/i.test(l)) {
      fatalErrors.push(l);
    } else if (/Package \w+ Error:/i.test(l)) {
      fatalErrors.push(l);
    } else if (l.startsWith('! ')) {
      fatalErrors.push(l);
    } else if (/Overfull \\hbox/i.test(l)) {
      overfullCount++;
    }
  }

  const hasFatal = res.status !== 0 || fatalErrors.length > 0;
  return {
    success: !hasFatal,
    firstError: fatalErrors[0] || (res.status !== 0 ? (lines.find(l => l.includes('error:') || l.includes('Error:')) || lines[0] || 'Unknown error') : undefined),
    overfullCount,
  };
}

// -------------------------------------------------------------
// Line Classification & Confusion Matrix
// -------------------------------------------------------------

const LINE_CATEGORIES = ['prose', 'math', 'table', 'matrix', 'cases'];

export function classifyOcrOutputLines(rawText, isTable) {
  if (isTable) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    return lines.map(() => 'table');
  }

  const rawLines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  if (rawLines.length === 0) return [];

  const fractionProcessed = parseStackedFractions(rawLines);
  const matrixCheck = parseMatrix(fractionProcessed);
  if (matrixCheck.isMatrix) {
    return fractionProcessed.map(() => 'matrix');
  }

  const casesCheck = parseCases(fractionProcessed);
  if (casesCheck.isCases) {
    return fractionProcessed.map(() => 'cases');
  }

  return fractionProcessed.map(line => isMathExpression(line) ? 'math' : 'prose');
}

export function createConfusionMatrix() {
  const matrix = {};
  for (const actual of LINE_CATEGORIES) {
    matrix[actual] = {};
    for (const pred of LINE_CATEGORIES) {
      matrix[actual][pred] = 0;
    }
  }
  return matrix;
}

export function updateConfusionMatrix(matrix, groundTruthLabels, predictedLabels) {
  let matches = 0;
  const len = Math.max(groundTruthLabels.length, predictedLabels.length);
  for (let i = 0; i < len; i++) {
    const actual = groundTruthLabels[i] || groundTruthLabels[groundTruthLabels.length - 1] || 'prose';
    const pred = predictedLabels[i] || (predictedLabels.length > 0 ? predictedLabels[predictedLabels.length - 1] : 'prose');

    const validActual = LINE_CATEGORIES.includes(actual) ? actual : 'prose';
    const validPred = LINE_CATEGORIES.includes(pred) ? pred : 'prose';

    matrix[validActual][validPred]++;
    if (validActual === validPred) {
      matches++;
    }
  }

  return { matches, total: len };
}

// -------------------------------------------------------------
// Hallucination Detection
// -------------------------------------------------------------

/**
 * Detects structural hallucinations:
 * A hallucination occurs when a structural LaTeX environment or command is emitted
 * (\sqrt, \frac, matrix, cases, tabular) despite the ground truth text, tags, and line labels
 * having zero evidence of that mathematical/tabular structure.
 */
export function detectHallucinations(latex, expectedText, lineLabels, tags = []) {
  const hallucinations = [];
  const expLower = (expectedText || '').toLowerCase();
  const tagsLower = tags.map(t => t.toLowerCase());

  // 1. \sqrt hallucination
  const hasSqrtInLatex = /\\sqrt\b/.test(latex);
  const hasSqrtInGroundTruth = /[√]|\bsqrt\b|\\sqrt\b/i.test(expectedText) || tagsLower.includes('radical');
  if (hasSqrtInLatex && !hasSqrtInGroundTruth) {
    hallucinations.push({ type: 'radical', symbol: '\\sqrt', details: 'hallucinated \\sqrt without radical evidence' });
  }

  // 2. \frac hallucination
  const hasFracInLatex = /\\frac\{/.test(latex);
  const hasFracInGroundTruth = /[/½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|\bfrac\b|\\frac\b|\bdivision\b/i.test(expectedText) || tagsLower.includes('fraction');
  if (hasFracInLatex && !hasFracInGroundTruth) {
    hallucinations.push({ type: 'fraction', symbol: '\\frac', details: 'hallucinated \\frac without division evidence' });
  }

  // 3. matrix hallucination
  const hasMatrixInLatex = /\\begin\{(?:p|b|v|V|B)?matrix\}/.test(latex);
  const hasMatrixInGroundTruth = lineLabels.includes('matrix') || tagsLower.includes('matrix');
  if (hasMatrixInLatex && !hasMatrixInGroundTruth) {
    hallucinations.push({ type: 'matrix', symbol: 'matrix', details: 'hallucinated matrix environment' });
  }

  // 4. cases hallucination
  const hasCasesInLatex = /\\begin\{cases\}/.test(latex);
  const hasCasesInGroundTruth = lineLabels.includes('cases') || tagsLower.includes('cases') || tagsLower.includes('system');
  if (hasCasesInLatex && !hasCasesInGroundTruth) {
    hallucinations.push({ type: 'cases', symbol: 'cases', details: 'hallucinated cases environment' });
  }

  // 5. table / tabular hallucination
  const hasTableInLatex = /\\begin\{tabular\}/.test(latex);
  const hasTableInGroundTruth = lineLabels.includes('table') || tagsLower.includes('table');
  if (hasTableInLatex && !hasTableInGroundTruth) {
    hallucinations.push({ type: 'table', symbol: 'tabular', details: 'hallucinated tabular environment' });
  }

  return hallucinations;
}

// -------------------------------------------------------------
// Core Evaluation Runner
// -------------------------------------------------------------

export async function evaluateSample(sample, corpusDir = CORPUS_DIR, options = {}) {
  const imagePath = path.isAbsolute(sample.file)
    ? sample.file
    : path.join(corpusDir, sample.file);

  if (!fs.existsSync(imagePath)) {
    throw new Error(`Corpus image not found: ${imagePath}`);
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const startTime = performance.now();
  const hasFrench = sample.lang === 'fr';

  // 1. Run conversion
  const fragmentResult = await convertImageToLatex(imageBuffer, {
    mode: 'fragment',
    hasFrench,
  });
  const endTime = performance.now();
  const timeMs = Math.round(endTime - startTime);

  let completeResult = { latex: '' };
  let fragmentCompile = { success: true };
  let documentCompile = { success: true };

  if (!options.skipCompile) {
    completeResult = await convertImageToLatex(imageBuffer, {
      mode: 'document',
      hasFrench,
    });
    const fragmentHarness = wrapInIndependentHarness(fragmentResult.latex, { hasFrench });
    fragmentCompile = compileLatex(fragmentHarness, `${sample.id}_frag`);
    documentCompile = compileLatex(completeResult.latex, `${sample.id}_doc`);
  }

  const gt = sample.ground_truth;
  const ocrCer = computeCer(gt.expected_text, fragmentResult.rawText);
  const latexCer = gt.expected_latex ? computeLatexCer(gt.expected_latex, fragmentResult.latex) : null;
  const tokenF1 = gt.expected_latex ? computeTokenF1(gt.expected_latex, fragmentResult.latex) : null;

  // Line classification
  const predictedLineLabels = classifyOcrOutputLines(fragmentResult.rawText, fragmentResult.isTable);
  const actualLineLabels = gt.line_labels || ['prose'];

  // Assertions: contains & forbids
  const containsPasses = [];
  const containsFails = [];
  for (const needle of gt.expected_latex_contains || []) {
    if (fragmentResult.latex.includes(needle)) {
      containsPasses.push(needle);
    } else {
      containsFails.push(needle);
    }
  }

  const forbidsPasses = [];
  const forbidsFails = [];
  for (const needle of gt.expected_latex_forbids || []) {
    if (!fragmentResult.latex.includes(needle)) {
      forbidsPasses.push(needle);
    } else {
      forbidsFails.push(needle);
    }
  }

  // Hallucinations
  const hallucinations = detectHallucinations(
    fragmentResult.latex,
    gt.expected_text,
    actualLineLabels,
    sample.tags
  );

  return {
    id: sample.id,
    file: sample.file,
    set: sample.set,
    lang: sample.lang,
    tags: sample.tags,
    status: gt.status || 'supported',
    timeMs,
    rawText: fragmentResult.rawText,
    expectedText: gt.expected_text,
    expectedLatex: gt.expected_latex || null,
    fragmentLatex: fragmentResult.latex,
    completeLatex: completeResult.latex,
    cer: ocrCer,
    ocrCer,
    latexCer,
    tokenF1,
    actualLineLabels,
    predictedLineLabels,
    containsTotal: (gt.expected_latex_contains || []).length,
    containsPassed: containsPasses.length,
    containsFailed: containsFails,
    forbidsTotal: (gt.expected_latex_forbids || []).length,
    forbidsPassed: forbidsPasses.length,
    forbidsFailed: forbidsFails,
    hallucinations,
    fragmentCompileSuccess: fragmentCompile.success,
    fragmentCompileError: fragmentCompile.firstError,
    documentCompileSuccess: documentCompile.success,
    documentCompileError: documentCompile.firstError,
  };
}

export async function runFullEvaluation(manifestPath = MANIFEST_PATH, options = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let samples = manifest.samples;

  // Filter by set or ids if specified
  if (options.set) {
    samples = samples.filter(s => s.set === options.set);
  }
  if (options.ids && options.ids.length > 0) {
    samples = samples.filter(s => options.ids.includes(s.id));
  }

  const results = [];
  const confusionMatrix = createConfusionMatrix();
  let totalLines = 0;
  let matchedLines = 0;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    process.stdout.write(`\r[${i + 1}/${samples.length}] Evaluating ${sample.id}...`);
    const evalRes = await evaluateSample(sample, path.dirname(manifestPath), options);
    results.push(evalRes);

    const { matches, total } = updateConfusionMatrix(
      confusionMatrix,
      evalRes.actualLineLabels,
      evalRes.predictedLineLabels
    );
    totalLines += total;
    matchedLines += matches;
  }
  process.stdout.write('\n');

  // Cold-start vs warm median calculation
  const coldStartMs = results.length > 0 ? results[0].timeMs : 0;
  const warmRuntimes = results.slice(1).map(r => r.timeMs).sort((a, b) => a - b);
  const warmMedianMs = warmRuntimes.length > 0
    ? warmRuntimes[Math.floor(warmRuntimes.length / 2)]
    : coldStartMs;

  // Compute aggregate statistics
  const computeSliceMetrics = (subset) => {
    if (subset.length === 0) {
      return {
        count: 0,
        cerMean: 0,
        cerMedian: 0,
        cerP90: 0,
        latexCerMean: null,
        latexTokenF1Mean: null,
        hallucinationsSupported: 0,
        hallucinationsLimitations: 0,
        hallucinationCount: 0,
        containsPassRate: 1.0,
        forbidsPassRate: 1.0,
        fragCompileRate: 1.0,
        docCompileRate: 1.0,
        meanTimeMs: 0,
        medianTimeMs: 0,
      };
    }

    const cers = subset.map(r => r.ocrCer).sort((a, b) => a - b);
    const times = subset.map(r => r.timeMs).sort((a, b) => a - b);
    const cerMean = cers.reduce((a, b) => a + b, 0) / cers.length;
    const cerMedian = cers[Math.floor(cers.length / 2)];
    const cerP90 = cers[Math.floor(cers.length * 0.9)];

    const latexCers = subset.filter(r => r.latexCer !== null).map(r => r.latexCer);
    const latexCerMean = latexCers.length > 0
      ? latexCers.reduce((a, b) => a + b, 0) / latexCers.length
      : null;

    const tokenF1s = subset.filter(r => r.tokenF1 !== null).map(r => r.tokenF1);
    const latexTokenF1Mean = tokenF1s.length > 0
      ? tokenF1s.reduce((a, b) => a + b, 0) / tokenF1s.length
      : null;

    const meanTimeMs = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    const medianTimeMs = times[Math.floor(times.length / 2)];

    const hallucinationsSupported = subset
      .filter(r => r.status === 'supported')
      .reduce((acc, r) => acc + r.hallucinations.length, 0);

    const hallucinationsLimitations = subset
      .filter(r => r.status === 'known_limitation')
      .reduce((acc, r) => acc + r.hallucinations.length, 0);

    const hallucinationCount = hallucinationsSupported + hallucinationsLimitations;

    const totalContains = subset.reduce((acc, r) => acc + r.containsTotal, 0);
    const passedContains = subset.reduce((acc, r) => acc + r.containsPassed, 0);
    const containsPassRate = totalContains > 0 ? passedContains / totalContains : 1.0;

    const totalForbids = subset.reduce((acc, r) => acc + r.forbidsTotal, 0);
    const passedForbids = subset.reduce((acc, r) => acc + r.forbidsPassed, 0);
    const forbidsPassRate = totalForbids > 0 ? passedForbids / totalForbids : 1.0;

    const fragSuccesses = subset.filter(r => r.fragmentCompileSuccess).length;
    const fragCompileRate = fragSuccesses / subset.length;

    const docSuccesses = subset.filter(r => r.documentCompileSuccess).length;
    const docCompileRate = docSuccesses / subset.length;

    return {
      count: subset.length,
      cerMean,
      cerMedian,
      cerP90,
      latexCerMean,
      latexTokenF1Mean,
      hallucinationsSupported,
      hallucinationsLimitations,
      hallucinationCount,
      containsPassRate,
      forbidsPassRate,
      fragCompileRate,
      docCompileRate,
      meanTimeMs,
      medianTimeMs,
    };
  };

  const overall = computeSliceMetrics(results);
  const devSlice = computeSliceMetrics(results.filter(r => r.set === 'dev'));
  const holdoutSlice = computeSliceMetrics(results.filter(r => r.set === 'holdout'));
  const stressSlice = computeSliceMetrics(results.filter(r => r.set === 'stress'));
  const enSlice = computeSliceMetrics(results.filter(r => r.lang === 'en'));
  const frSlice = computeSliceMetrics(results.filter(r => r.lang === 'fr'));

  // Tag slices
  const allTags = Array.from(new Set(results.flatMap(r => r.tags))).sort();
  const tagMetrics = {};
  for (const tag of allTags) {
    tagMetrics[tag] = computeSliceMetrics(results.filter(r => r.tags.includes(tag)));
  }

  // Structure precision & recall
  const structureMetrics = computeStructureMetrics(results);

  // Matrix recall specifically
  const matrixSamples = results.filter(r => r.tags.includes('matrix') || r.actualLineLabels.includes('matrix'));
  const matrixCorrect = matrixSamples.filter(r => /\\begin\{(?:p|b|v|V|B)?matrix\}/.test(r.fragmentLatex)).length;
  const matrixRecall = matrixSamples.length > 0 ? matrixCorrect / matrixSamples.length : 1.0;

  // Misclassification rate
  const misclassificationRate = totalLines > 0 ? (totalLines - matchedLines) / totalLines : 0;

  // 5 worst samples per set
  const getWorst = (subset) => [...subset]
    .sort((a, b) => b.cer - a.cer)
    .slice(0, 5)
    .map(r => ({
      id: r.id,
      set: r.set,
      lang: r.lang,
      tags: r.tags,
      status: r.status,
      cer: Number(r.cer.toFixed(4)),
      latexCer: r.latexCer !== null ? Number(r.latexCer.toFixed(4)) : null,
      timeMs: r.timeMs,
      rawPreview: r.rawText.substring(0, 80).replace(/\n/g, ' '),
      missingContains: r.containsFailed,
      hallucinations: r.hallucinations,
      compileSuccess: r.fragmentCompileSuccess && r.documentCompileSuccess,
    }));

  const worstOverall = getWorst(results);
  const worstDev = getWorst(results.filter(r => r.set === 'dev'));
  const worstHoldout = getWorst(results.filter(r => r.set === 'holdout'));
  const worstStress = getWorst(results.filter(r => r.set === 'stress'));

  return {
    timestamp: new Date().toISOString(),
    environment: getEnvironmentMetadata(),
    totalSamples: results.length,
    timings: {
      coldStartMs,
      warmMedianMs,
    },
    overall,
    devSlice,
    holdoutSlice,
    stressSlice,
    enSlice,
    frSlice,
    tagMetrics,
    structureMetrics,
    matrixAnalysis: {
      total: matrixSamples.length,
      correct: matrixCorrect,
      recall: matrixRecall,
      samples: matrixSamples.map(m => ({
        id: m.id,
        rawText: m.rawText,
        emittedLatex: m.fragmentLatex,
        hasMatrix: /\\begin\{(?:p|b|v|V|B)?matrix\}/.test(m.fragmentLatex),
      })),
    },
    confusionMatrix,
    lineStats: {
      totalLines,
      matchedLines,
      misclassificationRate,
    },
    worstSamples: worstOverall,
    worstDev,
    worstHoldout,
    worstStress,
    results,
  };
}

// -------------------------------------------------------------
// Variance Analysis
// -------------------------------------------------------------

export function computeVariance(run1, run2) {
  const cerDiffs = [];
  const timeDiffs = [];

  for (let i = 0; i < run1.results.length; i++) {
    const r1 = run1.results[i];
    const r2 = run2.results.find(r => r.id === r1.id) || run2.results[i];
    cerDiffs.push(Math.abs(r1.cer - r2.cer));
    timeDiffs.push(Math.abs(r1.timeMs - r2.timeMs));
  }

  const maxCerVariance = Math.max(...cerDiffs);
  const meanCerVariance = cerDiffs.reduce((a, b) => a + b, 0) / cerDiffs.length;
  const meanTimeVarianceMs = Math.round(timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length);

  return {
    maxCerVariance,
    meanCerVariance,
    meanTimeVarianceMs,
    cerMeanRun1: run1.overall.cerMean,
    cerMeanRun2: run2.overall.cerMean,
    identicalPredictions: cerDiffs.every(d => d === 0),
  };
}

// -------------------------------------------------------------
// Markdown Report Formatter
// -------------------------------------------------------------

export function generateMarkdownReport(evalData, varianceData = null) {
  const {
    overall,
    devSlice,
    holdoutSlice,
    stressSlice,
    enSlice,
    frSlice,
    tagMetrics,
    structureMetrics,
    matrixAnalysis,
    confusionMatrix,
    lineStats,
    worstDev,
    worstHoldout,
    worstStress,
    timings,
    environment,
  } = evalData;

  const md = [];
  md.push('# Golden Evaluation Corpus Baseline Report');
  md.push(`Generated: ${evalData.timestamp}`);
  if (environment) {
    md.push(`Git Commit: \`${environment.gitCommit}\` (dirty: ${environment.gitDirty}) | Node: \`${environment.nodeVersion}\` | Tesseract.js: \`${environment.tesseractVersion}\`\n`);
  }

  md.push('## 1. Executive Summary');
  md.push('| Metric | Overall | Dev | Holdout | Stress | Gates / Target |');
  md.push('|---|---|---|---|---|---|');
  md.push(`| **CER (OCR-only Mean)** | ${(overall.cerMean * 100).toFixed(2)}% | ${(devSlice.cerMean * 100).toFixed(2)}% | ${(holdoutSlice.cerMean * 100).toFixed(2)}% | ${(stressSlice.cerMean * 100).toFixed(2)}% | Recorded |`);
  md.push(`| **CER (OCR-only Median)** | ${(overall.cerMedian * 100).toFixed(2)}% | ${(devSlice.cerMedian * 100).toFixed(2)}% | ${(holdoutSlice.cerMedian * 100).toFixed(2)}% | ${(stressSlice.cerMedian * 100).toFixed(2)}% | Recorded |`);
  md.push(`| **LaTeX CER (Mean)** | ${overall.latexCerMean !== null ? (overall.latexCerMean * 100).toFixed(2) + '%' : 'N/A'} | ${devSlice.latexCerMean !== null ? (devSlice.latexCerMean * 100).toFixed(2) + '%' : 'N/A'} | ${holdoutSlice.latexCerMean !== null ? (holdoutSlice.latexCerMean * 100).toFixed(2) + '%' : 'N/A'} | ${stressSlice.latexCerMean !== null ? (stressSlice.latexCerMean * 100).toFixed(2) + '%' : 'N/A'} | Recorded |`);
  md.push(`| **LaTeX Token-F1** | ${overall.latexTokenF1Mean !== null ? (overall.latexTokenF1Mean * 100).toFixed(2) + '%' : 'N/A'} | ${devSlice.latexTokenF1Mean !== null ? (devSlice.latexTokenF1Mean * 100).toFixed(2) + '%' : 'N/A'} | ${holdoutSlice.latexTokenF1Mean !== null ? (holdoutSlice.latexTokenF1Mean * 100).toFixed(2) + '%' : 'N/A'} | ${stressSlice.latexTokenF1Mean !== null ? (stressSlice.latexTokenF1Mean * 100).toFixed(2) + '%' : 'N/A'} | Recorded |`);
  md.push(`| **Line Misclassification** | ${(lineStats.misclassificationRate * 100).toFixed(2)}% | — | — | — | Recorded |`);
  md.push(`| **Hallucinations (Supported)** | ${overall.hallucinationsSupported} | ${devSlice.hallucinationsSupported} | ${holdoutSlice.hallucinationsSupported} | ${stressSlice.hallucinationsSupported} | **0 strictly** |`);
  md.push(`| **Hallucinations (Limitations)** | ${overall.hallucinationsLimitations} | ${devSlice.hallucinationsLimitations} | ${holdoutSlice.hallucinationsLimitations} | ${stressSlice.hallucinationsLimitations} | **0 strictly** |`);
  md.push(`| **Contains Assertions** | ${(overall.containsPassRate * 100).toFixed(1)}% | ${(devSlice.containsPassRate * 100).toFixed(1)}% | ${(holdoutSlice.containsPassRate * 100).toFixed(1)}% | ${(stressSlice.containsPassRate * 100).toFixed(1)}% | Recorded |`);
  md.push(`| **Forbids Assertions** | ${(overall.forbidsPassRate * 100).toFixed(1)}% | ${(devSlice.forbidsPassRate * 100).toFixed(1)}% | ${(holdoutSlice.forbidsPassRate * 100).toFixed(1)}% | ${(stressSlice.forbidsPassRate * 100).toFixed(1)}% | **100% strictly** |`);
  md.push(`| **Fragment Compile** | ${(overall.fragCompileRate * 100).toFixed(1)}% | ${(devSlice.fragCompileRate * 100).toFixed(1)}% | ${(holdoutSlice.fragCompileRate * 100).toFixed(1)}% | ${(stressSlice.fragCompileRate * 100).toFixed(1)}% | **100% strictly** |`);
  md.push(`| **Document Compile** | ${(overall.docCompileRate * 100).toFixed(1)}% | ${(devSlice.docCompileRate * 100).toFixed(1)}% | ${(holdoutSlice.docCompileRate * 100).toFixed(1)}% | ${(stressSlice.docCompileRate * 100).toFixed(1)}% | **100% strictly** |`);
  md.push(`| **Cold-Start OCR Time** | ${timings?.coldStartMs ?? overall.meanTimeMs} ms | — | — | — | Recorded |`);
  md.push(`| **Warm Median Runtime** | ${timings?.warmMedianMs ?? overall.medianTimeMs} ms | ${devSlice.medianTimeMs} ms | ${holdoutSlice.medianTimeMs} ms | ${stressSlice.medianTimeMs} ms | Recorded |\n`);

  md.push('## 2. Structure Precision and Recall');
  md.push('| Structure | Precision | Recall | F1 Score | TP | FP | FN |');
  md.push('|---|---|---|---|---|---|---|');
  for (const [k, s] of Object.entries(structureMetrics)) {
    md.push(`| **${k}** | ${(s.precision * 100).toFixed(1)}% | ${(s.recall * 100).toFixed(1)}% | ${(s.f1 * 100).toFixed(1)}% | ${s.tp} | ${s.fp} | ${s.fn} |`);
  }
  md.push(`\n**Matrix Recall**: ${(matrixAnalysis.recall * 100).toFixed(1)}% (${matrixAnalysis.correct}/${matrixAnalysis.total} correct)\n`);

  md.push('## 3. Slice Breakdown (Language & Degradations)');
  md.push('| Slice | Count | OCR CER (Mean) | LaTeX CER (Mean) | Frag Compile | Doc Compile | Hallucinations |');
  md.push('|---|---|---|---|---|---|---|');
  md.push(`| **English (en)** | ${enSlice.count} | ${(enSlice.cerMean * 100).toFixed(2)}% | ${enSlice.latexCerMean !== null ? (enSlice.latexCerMean * 100).toFixed(2) + '%' : 'N/A'} | ${(enSlice.fragCompileRate * 100).toFixed(1)}% | ${(enSlice.docCompileRate * 100).toFixed(1)}% | ${enSlice.hallucinationCount} |`);
  md.push(`| **French (fr)** | ${frSlice.count} | ${(frSlice.cerMean * 100).toFixed(2)}% | ${frSlice.latexCerMean !== null ? (frSlice.latexCerMean * 100).toFixed(2) + '%' : 'N/A'} | ${(frSlice.fragCompileRate * 100).toFixed(1)}% | ${(frSlice.docCompileRate * 100).toFixed(1)}% | ${frSlice.hallucinationCount} |`);
  for (const [tag, m] of Object.entries(tagMetrics)) {
    md.push(`| ` + '`' + tag + '`' + ` | ${m.count} | ${(m.cerMean * 100).toFixed(2)}% | ${m.latexCerMean !== null ? (m.latexCerMean * 100).toFixed(2) + '%' : 'N/A'} | ${(m.fragCompileRate * 100).toFixed(1)}% | ${(m.docCompileRate * 100).toFixed(1)}% | ${m.hallucinationCount} |`);
  }
  md.push('');

  md.push('## 4. Line Classification Confusion Matrix');
  md.push('| Actual \\ Pred | prose | math | table | matrix | cases |');
  md.push('|---|---|---|---|---|---|');
  for (const actual of LINE_CATEGORIES) {
    const row = [actual];
    for (const pred of LINE_CATEGORIES) {
      row.push(confusionMatrix[actual][pred]);
    }
    md.push(`| **${row[0]}** | ${row[1]} | ${row[2]} | ${row[3]} | ${row[4]} | ${row[5]} |`);
  }
  md.push(`\n**Total Lines Evaluated**: ${lineStats.totalLines}, **Correct**: ${lineStats.matchedLines} (${((1 - lineStats.misclassificationRate) * 100).toFixed(2)}%)\n`);

  md.push('## 5. Worst Samples by Set');
  const renderWorstTable = (title, list) => {
    md.push(`### ${title}`);
    if (list.length === 0) {
      md.push('No samples in this set.\n');
      return;
    }
    md.push('| ID | Status | OCR CER | LaTeX CER | Runtime | Raw OCR Preview | Missing Contains |');
    md.push('|---|---|---|---|---|---|---|');
    for (const s of list) {
      const missing = s.missingContains && s.missingContains.length > 0 ? s.missingContains.join(', ') : 'none';
      md.push(`| ` + '`' + s.id + '`' + ` | ${s.status} | ${(s.cer * 100).toFixed(1)}% | ${s.latexCer !== null ? (s.latexCer * 100).toFixed(1) + '%' : 'N/A'} | ${s.timeMs}ms | ${s.rawPreview.replace(/\|/g, '\\|')} | ${missing} |`);
    }
    md.push('');
  };

  renderWorstTable('Dev Set Worst Samples', worstDev);
  renderWorstTable('Holdout Set Worst Samples', worstHoldout);
  renderWorstTable('Stress Set Worst Samples', worstStress);

  if (varianceData) {
    md.push('## 6. Double-Run Variance Measurement');
    md.push(`- **Max CER Variance**: ${(varianceData.maxCerVariance * 100).toFixed(4)}%`);
    md.push(`- **Mean CER Variance**: ${(varianceData.meanCerVariance * 100).toFixed(4)}%`);
    md.push(`- **Mean Runtime Delta**: ${varianceData.meanTimeVarianceMs} ms`);
    md.push(`- **Deterministic Predictions**: ${varianceData.identicalPredictions ? 'YES (100% identical OCR outputs)' : 'NO'}\n`);
  }

  md.push('## 7. Complete Corpus Inventory');
  md.push('| ID | Set | Lang | Tags | Status | OCR CER | LaTeX CER | Frag | Doc |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of evalData.results) {
    md.push(`| ` + '`' + r.id + '`' + ` | ${r.set} | ${r.lang} | ${r.tags.join(', ')} | ${r.status} | ${(r.cer * 100).toFixed(1)}% | ${r.latexCer !== null ? (r.latexCer * 100).toFixed(1) + '%' : '—'} | ${r.fragmentCompileSuccess ? '✓' : '✗'} | ${r.documentCompileSuccess ? '✓' : '✗'} |`);
  }
  md.push('');

  return md.join('\n');
}

// -------------------------------------------------------------
// CLI Entrypoint
// -------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const isCompare = args.includes('--compare');
  const isDoubleRun = args.includes('--double-run') || args.includes('--runs');
  const skipCompile = args.includes('--skip-compile');
  const saveBaseline = args.includes('--save-baseline') || (!isCompare && !fs.existsSync(path.join(ROOT, 'baseline.json')));

  let setFilter = null;
  const setIdx = args.indexOf('--set');
  if (setIdx !== -1 && args[setIdx + 1]) {
    setFilter = args[setIdx + 1];
  }

  let idFilters = [];
  const idsIdx = args.indexOf('--ids');
  if (idsIdx !== -1 && args[idsIdx + 1]) {
    idFilters = args[idsIdx + 1].split(',').map(s => s.trim()).filter(Boolean);
  }

  const evalOptions = {
    skipCompile,
    set: setFilter,
    ids: idFilters,
  };

  console.log('================================================================');
  console.log('GOLDEN CORPUS EVALUATION & METRICS PIPELINE');
  if (skipCompile) console.log('Mode: --skip-compile enabled (Fast evaluation)');
  if (setFilter) console.log(`Filter: --set ${setFilter}`);
  if (idFilters.length > 0) console.log(`Filter: --ids ${idFilters.join(',')}`);
  console.log('================================================================\n');

  console.log('--- Run 1: Evaluating Golden Corpus ---');
  const run1 = await runFullEvaluation(MANIFEST_PATH, evalOptions);

  let run2 = null;
  let variance = null;
  if (isDoubleRun) {
    console.log('\n--- Run 2: Double Evaluation for Variance Measurement ---');
    run2 = await runFullEvaluation(MANIFEST_PATH, evalOptions);
    variance = computeVariance(run1, run2);
    console.log(`\n✓ Variance measured: Mean CER delta = ${(variance.meanCerVariance * 100).toFixed(4)}%, Identical = ${variance.identicalPredictions}`);
  }

  let outputDir = ROOT;
  const outDirIdx = args.indexOf('--output-dir');
  if (outDirIdx !== -1 && args[outDirIdx + 1]) {
    outputDir = path.resolve(args[outDirIdx + 1]);
  } else if (process.env.EVAL_REPORT_DIR) {
    outputDir = path.resolve(process.env.EVAL_REPORT_DIR);
  }
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write eval-report.json
  const evalReportJsonPath = path.join(outputDir, 'eval-report.json');
  fs.writeFileSync(evalReportJsonPath, JSON.stringify(run1, null, 2), 'utf8');
  console.log(`✓ Report written to ${evalReportJsonPath}`);

  // Write eval-report.md
  const evalReportMdPath = path.join(outputDir, 'eval-report.md');
  const mdContent = generateMarkdownReport(run1, variance);
  fs.writeFileSync(evalReportMdPath, mdContent, 'utf8');
  console.log(`✓ Markdown summary written to ${evalReportMdPath}`);

  // Save baseline if requested
  const baselinePath = path.join(ROOT, 'baseline.json');
  if (saveBaseline && !setFilter && idFilters.length === 0) {
    fs.writeFileSync(baselinePath, JSON.stringify(run1, null, 2), 'utf8');
    console.log(`✓ Baseline snapshot saved to ${baselinePath}`);
  }

  // Compare mode
  if (isCompare) {
    const compareIdx = args.indexOf('--compare');
    const baselineFile = args[compareIdx + 1] || baselinePath;
    console.log(`\n--- Comparing against baseline: ${baselineFile} ---`);
    if (!fs.existsSync(baselineFile)) {
      console.error(`✗ Baseline file not found: ${baselineFile}`);
      process.exit(1);
    }

    const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    const cerDelta = run1.overall.cerMean - baseline.overall.cerMean;
    const newHallucinations = run1.overall.hallucinationCount - baseline.overall.hallucinationCount;
    const compileRegressions = (baseline.overall.fragCompileRate - run1.overall.fragCompileRate) > 0.001;

    console.log(`CER Delta: ${(cerDelta * 100).toFixed(3)}% (Threshold: +2.0%)`);
    console.log(`Hallucinations Delta: ${newHallucinations} (Threshold: 0)`);

    let failed = false;
    if (cerDelta > 0.02) {
      console.error(`✗ Regression failure: CER regressed by ${(cerDelta * 100).toFixed(3)}%`);
      failed = true;
    }
    if (newHallucinations > 0) {
      console.error(`✗ Regression failure: ${newHallucinations} new hallucinations introduced`);
      failed = true;
    }
    if (compileRegressions) {
      console.error(`✗ Regression failure: Fragment compile rate regressed from ${(baseline.overall.fragCompileRate * 100).toFixed(1)}% to ${(run1.overall.fragCompileRate * 100).toFixed(1)}%`);
      failed = true;
    }

    if (failed) {
      process.exit(1);
    }
    console.log('✓ Compare check passed with zero regressions.');
  }

  await terminateTesseractWorker();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(async (err) => {
    console.error('Fatal evaluation error:', err);
    await terminateTesseractWorker();
    process.exit(1);
  });
}
