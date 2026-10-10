/**
 * corpusEval.test.ts — Unit and Integration Tests for Corpus Evaluation Pipeline.
 *
 * Validates:
 * 1. Text normalization & Levenshtein / CER calculation
 * 2. LaTeX-level normalization, LaTeX CER & token-F1 calculation
 * 3. Line classification & confusion matrix updates
 * 4. Per-structure precision and recall computation
 * 5. Comprehensive hallucination detection rules with injected fake outputs
 * 6. Compare mode behavior (clean pass, injected CER regression, injected hallucination)
 * 7. Golden Corpus manifest schema and fixture file integrity
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CORPUS_DIR = path.join(ROOT, 'corpus');
const MANIFEST_PATH = path.join(CORPUS_DIR, 'manifest.json');
const TEST_TMP_DIR = path.join(os.tmpdir(), `eval_test_${Date.now()}`);
if (!fs.existsSync(TEST_TMP_DIR)) {
  fs.mkdirSync(TEST_TMP_DIR, { recursive: true });
}

import {
  normalizeForCer,
  normalizeLatexForEval,
  levenshteinDistance,
  computeCer,
  computeLatexCer,
  tokenizeLatex,
  computeTokenF1,
  classifyOcrOutputLines,
  createConfusionMatrix,
  updateConfusionMatrix,
  detectHallucinations,
  computeStructureMetrics,
  detectStructurePresence,
  detectEmittedStructures,
} from '../scripts/eval.mjs';

describe('Corpus Evaluation Helpers', () => {
  describe('CER & Normalization', () => {
    it('normalizes Unicode NFC and collapses whitespace', () => {
      const input = '  Bonjour   le   monde \r\n  avec   accents : e\u0301  ';
      const normalized = normalizeForCer(input);
      assert.equal(normalized, 'Bonjour le monde\navec accents : é');
    });

    it('computes Levenshtein distance accurately', () => {
      assert.equal(levenshteinDistance('kitten', 'sitting'), 3);
      assert.equal(levenshteinDistance('', 'abc'), 3);
      assert.equal(levenshteinDistance('abc', ''), 3);
      assert.equal(levenshteinDistance('same', 'same'), 0);
    });

    it('computes CER with zero on identical text and 1.0 on complete mismatch', () => {
      assert.equal(computeCer('f(x) = x^2 + 1', 'f(x) = x^2 + 1'), 0);
      assert.equal(computeCer('abc', 'xyz'), 1.0);
      assert.equal(computeCer('', ''), 0);
    });
  });

  describe('LaTeX-Level Metrics & Normalization', () => {
    it('normalizes LaTeX code for evaluation (strips display wrappers, left/right, and spacing)', () => {
      const rawLatex = '\\[\n\\left( x + 1 \\right) \\, = \\; \\frac{a}{b}\n\\]';
      const norm = normalizeLatexForEval(rawLatex);
      assert.equal(norm, '( x + 1 ) = \\frac{a}{b}');
    });

    it('computes LaTeX-level CER correctly', () => {
      const exp = '\\[\nx^{2} + y^{2} = z^{2}\n\\]';
      const gen = '\\[\nx^{2} + y^{2} = z^{2}\n\\]';
      assert.equal(computeLatexCer(exp, gen), 0);

      const genMinor = '\\[\nx^{2} + y^{2} = 2^{2}\n\\]';
      const cer = computeLatexCer(exp, genMinor);
      assert.ok(cer !== null && cer > 0 && cer < 0.2);
    });

    it('computes token-F1 on math formulas', () => {
      const exp = 'x^{2} + 2x + 1';
      const gen = 'x^{2} + 2x + 1';
      assert.equal(computeTokenF1(exp, gen), 1.0);

      const genPartial = 'x^{2} + 2x';
      const f1 = computeTokenF1(exp, genPartial);
      assert.ok(f1 !== null && f1 > 0.7 && f1 < 1.0);
    });
  });

  describe('Line Classification & Confusion Matrix', () => {
    it('classifies table OCR output lines as table', () => {
      const labels = classifyOcrOutputLines('Col1 Col2\n10 20\n30 40', true);
      assert.deepEqual(labels, ['table', 'table', 'table']);
    });

    it('classifies math lines vs prose lines correctly', () => {
      const raw = 'f(x) = x^2 + 1\nThis is an explanatory sentence describing the function.';
      const labels = classifyOcrOutputLines(raw, false);
      assert.deepEqual(labels, ['math', 'prose']);
    });

    it('creates and updates confusion matrix accurately', () => {
      const matrix = createConfusionMatrix();
      const actual = ['prose', 'math', 'table'];
      const pred = ['prose', 'math', 'math']; // 1 misclassification

      const stats = updateConfusionMatrix(matrix, actual, pred);
      assert.equal(stats.matches, 2);
      assert.equal(stats.total, 3);
      assert.equal(matrix.prose.prose, 1);
      assert.equal(matrix.math.math, 1);
      assert.equal(matrix.table.math, 1);
    });
  });

  describe('Structure Precision & Recall', () => {
    it('calculates structure metrics across sample results', () => {
      const mockResults = [
        {
          expectedText: 'x^2',
          expectedLatex: 'x^{2}',
          tags: ['superscript'],
          fragmentLatex: 'x^{2}',
        },
        {
          expectedText: 'a_1',
          expectedLatex: 'a_{1}',
          tags: ['subscript'],
          fragmentLatex: 'a_{1}',
        },
        {
          expectedText: 'a/b',
          expectedLatex: '\\frac{a}{b}',
          tags: ['fraction'],
          fragmentLatex: 'a/b', // Failed to emit \frac
        },
      ];

      const metrics = computeStructureMetrics(mockResults);
      assert.equal(metrics.superscript.precision, 1.0);
      assert.equal(metrics.superscript.recall, 1.0);
      assert.equal(metrics.subscript.precision, 1.0);
      assert.equal(metrics.subscript.recall, 1.0);
      assert.equal(metrics.fraction.tp, 0);
      assert.equal(metrics.fraction.fn, 1);
      assert.equal(metrics.fraction.recall, 0);
    });
  });

  describe('Hallucination Detector with Injected Cases', () => {
    it('flags hallucinated \\sqrt when ground truth has no radical evidence', () => {
      const fakeLatex = '\\[\n\\sqrt{x + 1}\n\\]';
      const expectedText = 'x + 1';
      const hallucinations = detectHallucinations(fakeLatex, expectedText, ['math'], ['clean']);
      assert.equal(hallucinations.length, 1);
      assert.equal(hallucinations[0].symbol, '\\sqrt');
    });

    it('flags hallucinated \\frac when ground truth has no division evidence', () => {
      const fakeLatex = '\\[\n\\frac{a}{b}\n\\]';
      const expectedText = 'a b';
      const hallucinations = detectHallucinations(fakeLatex, expectedText, ['math'], ['algebra']);
      assert.equal(hallucinations.length, 1);
      assert.equal(hallucinations[0].symbol, '\\frac');
    });

    it('flags hallucinated matrix environment when ground truth is plain text', () => {
      const fakeLatex = '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}';
      const expectedText = '1 2 3 4';
      const hallucinations = detectHallucinations(fakeLatex, expectedText, ['prose'], ['prose']);
      assert.equal(hallucinations.length, 1);
      assert.equal(hallucinations[0].symbol, 'matrix');
    });

    it('flags hallucinated cases environment when ground truth is plain math', () => {
      const fakeLatex = '\\[\n\\begin{cases}\n2x + y = 5 \\\\\nx - 3y = 2\n\\end{cases}\n\\]';
      const expectedText = '2x + y = 5 and x - 3y = 2';
      const hallucinations = detectHallucinations(fakeLatex, expectedText, ['math'], ['algebra']);
      assert.equal(hallucinations.length, 1);
      assert.equal(hallucinations[0].symbol, 'cases');
    });

    it('flags hallucinated tabular environment when ground truth is prose list', () => {
      const fakeLatex = '\\begin{tabular}{ll} Item & Price \\end{tabular}';
      const expectedText = '1. First item\n2. Second item';
      const hallucinations = detectHallucinations(fakeLatex, expectedText, ['prose', 'prose'], ['list']);
      assert.equal(hallucinations.length, 1);
      assert.equal(hallucinations[0].symbol, 'tabular');
    });

    it('does not flag clean supported outputs matching ground truth evidence', () => {
      const cleanLatex = '\\[\n\\sqrt{x^2 + y^2}\n\\]';
      const expectedText = '√(x^2 + y^2)';
      const hallucinations = detectHallucinations(cleanLatex, expectedText, ['math'], ['radical']);
      assert.equal(hallucinations.length, 0);
    });
  });

  describe('Compare Mode Verification with Injected Anomalies', () => {
    it('detects injected CER regression and exits non-zero', () => {
      const fakeBaseline = {
        overall: {
          cerMean: 0.01, // Artificially low baseline CER
          hallucinationCount: 0,
          fragCompileRate: 1.0,
        },
      };
      const tmpBaseline = path.join(ROOT, '.tmp_compile', 'injected_regress_baseline.json');
      fs.writeFileSync(tmpBaseline, JSON.stringify(fakeBaseline), 'utf8');

      const res = spawnSync('node', [
        'scripts/eval.mjs',
        '--skip-compile',
        '--ids', 'seed_french_sample',
        '--output-dir', TEST_TMP_DIR,
        '--compare', tmpBaseline,
      ], { cwd: ROOT, encoding: 'utf8' });

      // Clean up tmp file
      try { fs.unlinkSync(tmpBaseline); } catch {}

      assert.equal(res.status, 1, 'Compare mode must exit with code 1 on CER regression');
      assert.ok(res.stderr.includes('Regression failure: CER regressed') || res.stdout.includes('Regression failure: CER regressed'));
    });

    it('detects injected hallucination and exits non-zero', () => {
      const fakeBaseline = {
        overall: {
          cerMean: 0.99, // High CER so CER does not trigger failure
          hallucinationCount: -1, // Force hallucination delta > 0
          fragCompileRate: 1.0,
        },
      };
      const tmpBaseline = path.join(ROOT, '.tmp_compile', 'injected_hallucination_baseline.json');
      fs.writeFileSync(tmpBaseline, JSON.stringify(fakeBaseline), 'utf8');

      const res = spawnSync('node', [
        'scripts/eval.mjs',
        '--skip-compile',
        '--ids', 'seed_french_sample',
        '--output-dir', TEST_TMP_DIR,
        '--compare', tmpBaseline,
      ], { cwd: ROOT, encoding: 'utf8' });

      try { fs.unlinkSync(tmpBaseline); } catch {}

      assert.equal(res.status, 1, 'Compare mode must exit with code 1 on hallucination regression');
    });

    it('passes cleanly when comparing against self baseline', () => {
      // First run quick eval to create valid baseline for 1 sample
      const tmpBaseline = path.join(ROOT, '.tmp_compile', 'clean_test_baseline.json');
      const evalRes = spawnSync('node', [
        'scripts/eval.mjs',
        '--skip-compile',
        '--ids', 'seed_french_sample',
        '--output-dir', TEST_TMP_DIR,
      ], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(evalRes.status, 0);

      const report = JSON.parse(fs.readFileSync(path.join(TEST_TMP_DIR, 'eval-report.json'), 'utf8'));
      fs.writeFileSync(tmpBaseline, JSON.stringify(report), 'utf8');

      const compareRes = spawnSync('node', [
        'scripts/eval.mjs',
        '--skip-compile',
        '--ids', 'seed_french_sample',
        '--output-dir', TEST_TMP_DIR,
        '--compare', tmpBaseline,
      ], { cwd: ROOT, encoding: 'utf8' });

      try { fs.unlinkSync(tmpBaseline); } catch {}

      assert.equal(compareRes.status, 0, 'Clean compare run must exit 0');
      assert.ok(compareRes.stdout.includes('Compare check passed with zero regressions'));
    });
  });

  describe('Manifest & Fixture Integrity', () => {
    it('verifies manifest sample partition and counts', () => {
      assert.equal(fs.existsSync(MANIFEST_PATH), true, 'manifest.json must exist');
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      assert.ok(manifest.samples.length >= 50);
    });

    it('verifies valid ground truth schema for all manifest samples', () => {
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      for (const sample of manifest.samples) {
        assert.ok(sample.id, 'sample must have id');
        assert.ok(sample.file, 'sample must have file');
        assert.ok(['dev', 'holdout', 'stress'].includes(sample.set), `sample set must be dev, holdout, or stress: ${sample.set}`);
        assert.ok(['en', 'fr'].includes(sample.lang), `sample lang must be en or fr: ${sample.lang}`);
        assert.ok(Array.isArray(sample.tags) && sample.tags.length > 0, `sample must have tags: ${sample.id}`);

        const gt = sample.ground_truth;
        assert.ok(gt, `sample must have ground_truth: ${sample.id}`);
        assert.ok(typeof gt.expected_text === 'string' && gt.expected_text.length > 0, `expected_text required: ${sample.id}`);
        assert.ok(Array.isArray(gt.line_labels) && gt.line_labels.length > 0, `line_labels required: ${sample.id}`);
        assert.ok(Array.isArray(gt.expected_latex_contains), `expected_latex_contains must be array: ${sample.id}`);
        assert.ok(Array.isArray(gt.expected_latex_forbids), `expected_latex_forbids must be array: ${sample.id}`);
        assert.ok(['supported', 'known_limitation'].includes(gt.status), `status must be supported or known_limitation: ${sample.id}`);
      }
    });
  });

  after(() => {
    try {
      fs.rmSync(TEST_TMP_DIR, { recursive: true, force: true });
    } catch {}
  });
});
