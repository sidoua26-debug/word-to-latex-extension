/**
 * generate.mjs — Seeded, deterministic synthetic corpus generator.
 * Generates synthetic PNG images using Playwright and HTML5 Canvas.
 * Produces ground-truth annotations in corpus/manifest.json.
 *
 * Slices generated:
 * - 15 Seed fixture annotations
 * - 18 Dev synthetic samples
 * - 23 Holdout synthetic samples (including 6 distinct sources)
 * - 24 Stress synthetic samples (with hard degradations: rotation 4-5°, blur 2px, heavy noise, contrast [120, 180], downscale, vignette, combined)
 * Total: 80 samples
 *
 * Determinism note: Canvas pixel operations use deterministic Mulberry32 PRNG.
 * Font rendering depends on system font rasterization (DejaVu Sans / Arial).
 * Committed PNG files in corpus/ are canonical.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CORPUS_DIR = path.join(ROOT, 'corpus');
const SYNTH_DIR = path.join(CORPUS_DIR, 'synthetic');
const MANIFEST_PATH = path.join(CORPUS_DIR, 'manifest.json');

if (!fs.existsSync(SYNTH_DIR)) {
  fs.mkdirSync(SYNTH_DIR, { recursive: true });
}

// Seeded PRNG: Mulberry32 for deterministic random numbers
function createPrng(seed = 1337) {
  let s = seed >>> 0;
  return function () {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -------------------------------------------------------------
// 15 Baseline Seed Fixture Definitions
// -------------------------------------------------------------
const SEED_SAMPLES = [
  {
    id: 'seed_french_sample',
    file: 'seed/french_sample.png',
    set: 'dev',
    lang: 'fr',
    tags: ['seed', 'french', 'accents', 'prose'],
    ground_truth: {
      expected_text: 'Théorème fondamental\nVoici des caractères accentués : é, è, à, ç, œ, ù.\nCalculer la dérivée de la fonction f sur cet intervalle.',
      expected_latex: null,
      line_labels: ['prose', 'prose', 'prose'],
      expected_latex_contains: ['Théorème', 'caractères', 'dérivée'],
      expected_latex_forbids: [],
      status: 'supported',
    },
  },
  {
    id: 'seed_math_equation',
    file: 'seed/math_equation.png',
    set: 'dev',
    lang: 'en',
    tags: ['seed', 'math', 'algebra'],
    ground_truth: {
      expected_text: 'E = mc^2\nf(x) = x^2 + 2x + 1',
      expected_latex: '\\[\nE = mc^{2}\n\\]\n\\[\nf(x) = x^{2} + 2x + 1\n\\]',
      line_labels: ['math', 'math'],
      expected_latex_contains: ['mc', 'x^{2}', '+ 1'],
      expected_latex_forbids: [],
      status: 'supported',
    },
  },
  {
    id: 'seed_math_fraction',
    file: 'seed/math_fraction.png',
    set: 'dev',
    lang: 'en',
    tags: ['seed', 'math', 'fraction'],
    ground_truth: {
      expected_text: '(x + 1) / (x - 1)',
      expected_latex: '\\[\n\\frac{x + 1}{x - 1}\n\\]',
      line_labels: ['math'],
      expected_latex_contains: ['(x + 1)', '(x - 1)'],
      expected_latex_forbids: [],
      status: 'supported',
    },
  },
  {
    id: 'seed_math_matrix',
    file: 'seed/math_matrix.png',
    set: 'dev',
    lang: 'en',
    tags: ['seed', 'math', 'matrix'],
    ground_truth: {
      expected_text: '[ 1 2 ]\n[ 3 4 ]',
      expected_latex: '\\[\n\\begin{bmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{bmatrix}\n\\]',
      line_labels: ['matrix'],
      expected_latex_contains: ['\\begin{bmatrix}', '1 & 2', '3 & 4', '\\end{bmatrix}'],
      expected_latex_forbids: [],
      status: 'supported',
    },
  },
  {
    id: 'seed_table_sample',
    file: 'seed/table_sample.png',
    set: 'dev',
    lang: 'en',
    tags: ['seed', 'table', 'booktabs'],
    ground_truth: {
      expected_text: 'Item Quantity Price\nApples 10 $5.00\nOranges 8 $4.50',
      expected_latex: null,
      line_labels: ['table', 'table', 'table'],
      expected_latex_contains: ['\\begin{table}', '\\begin{tabular}', 'Item & Quantity & Price', 'Apples & 10 & \\$5.00', '\\bottomrule'],
      expected_latex_forbids: [],
      status: 'supported',
    },
  },
  {
    id: 'seed_case_01_pythagoras',
    file: 'seed/case_01_pythagoras.png',
    set: 'dev',
    lang: 'en',
    tags: ['seed', 'math', 'pythagoras', 'geometry'],
    ground_truth: {
      expected_text: 'x^2 + y^2 = z^2',
      expected_latex: '\\[\nx^{2} + y^{2} = z^{2}\n\\]',
      line_labels: ['math'],
      expected_latex_contains: ['x^{2}', 'y^{2}', 'z^{2}'],
      expected_latex_forbids: [],
      status: 'supported',
    },
  },
  {
    id: 'seed_case_02_fraction',
    file: 'seed/case_02_fraction.png',
    set: 'dev',
    lang: 'en',
    tags: ['seed', 'math', 'fraction'],
    ground_truth: {
      expected_text: '(a + b) / c',
      expected_latex: '\\[\n\\frac{a + b}{c}\n\\]',
      line_labels: ['math'],
      expected_latex_contains: ['\\frac{a + b}{c}'],
      expected_latex_forbids: [],
      status: 'supported',
    },
  },
  {
    id: 'seed_case_03_sqrt',
    file: 'seed/case_03_sqrt.png',
    set: 'dev',
    lang: 'en',
    tags: ['seed', 'math', 'radical', 'limitation'],
    ground_truth: {
      expected_text: 'sqrt(x^2 + 1)',
      expected_latex: '\\[\n\\sqrt{x^{2} + 1}\n\\]',
      line_labels: ['math'],
      expected_latex_contains: [],
      expected_latex_forbids: ['\\sqrt'],
      status: 'known_limitation',
    },
  },
  {
    id: 'seed_case_04_integral',
    file: 'seed/case_04_integral.png',
    set: 'dev',
    lang: 'en',
    tags: ['seed', 'math', 'calculus', 'integral', 'limitation'],
    ground_truth: {
      expected_text: 'int_0^1 x^2 dx',
      expected_latex: '\\[\n\\int_{0}^{1} x^{2} dx\n\\]',
      line_labels: ['math'],
      expected_latex_contains: ['x'],
      expected_latex_forbids: [],
      status: 'known_limitation',
    },
  },
  {
    id: 'seed_case_05_summation',
    file: 'seed/case_05_summation.png',
    set: 'dev',
    lang: 'en',
    tags: ['seed', 'math', 'summation', 'limitation'],
    ground_truth: {
      expected_text: 'sum_{i=1}^n i',
      expected_latex: '\\[\n\\sum_{i=1}^{n} i\n\\]',
      line_labels: ['math'],
      expected_latex_contains: ['i'],
      expected_latex_forbids: [],
      status: 'known_limitation',
    },
  },
  {
    id: 'seed_case_06_matrix',
    file: 'seed/case_06_matrix.png',
    set: 'dev',
    lang: 'en',
    tags: ['seed', 'math', 'matrix'],
    ground_truth: {
      expected_text: '( 1 2 )\n( 3 4 )',
      expected_latex: '\\[\n\\begin{pmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{pmatrix}\n\\]',
      line_labels: ['matrix'],
      expected_latex_contains: ['\\begin{', 'matrix', '1', '2'],
      expected_latex_forbids: [],
      status: 'supported',
    },
  },
  {
    id: 'seed_case_07_system',
    file: 'seed/case_07_system.png',
    set: 'dev',
    lang: 'en',
    tags: ['seed', 'math', 'cases', 'system'],
    ground_truth: {
      expected_text: '{ 2x + y = 5\n{ x - 3y = 2',
      expected_latex: '\\[\n\\begin{cases}\n2x + y = 5 \\\\\nx - 3y = 2\n\\end{cases}\n\\]',
      line_labels: ['cases', 'cases'],
      expected_latex_contains: ['\\begin{cases}', '2x + y = 5', 'x - 3y = 2', '\\end{cases}'],
      expected_latex_forbids: [],
      status: 'supported',
    },
  },
  {
    id: 'seed_case_08_french_math',
    file: 'seed/case_08_french_math.png',
    set: 'dev',
    lang: 'fr',
    tags: ['seed', 'french', 'mixed-math', 'prose'],
    ground_truth: {
      expected_text: 'Soit f une fonction continue sur l\'intervalle [0, 1]. On considère l\'intégrale suivante :\nI = int_0^1 f(x) dx\nCalculer la valeur moyenne de f.',
      expected_latex: null,
      line_labels: ['prose', 'prose', 'math', 'prose'],
      expected_latex_contains: ['Soit f une fonction', 'intervalle', 'Calculer'],
      expected_latex_forbids: [],
      status: 'supported',
    },
  },
  {
    id: 'seed_case_09_french_accents',
    file: 'seed/case_09_french_accents.png',
    set: 'dev',
    lang: 'fr',
    tags: ['seed', 'french', 'accents', 'prose'],
    ground_truth: {
      expected_text: 'Documentation Français\nVoici des caractères accentués : é, è, à, ç, œ, ù.\nL\'élève étudie attentivement le théorème où apparaît le paramètre déjà défini.',
      expected_latex: null,
      line_labels: ['prose', 'prose', 'prose', 'prose'],
      expected_latex_contains: ['Documentation', 'caractères', 'élève'],
      expected_latex_forbids: [],
      status: 'supported',
    },
  },
  {
    id: 'seed_case_10_table_math',
    file: 'seed/case_10_table_math.png',
    set: 'dev',
    lang: 'fr',
    tags: ['seed', 'table', 'math-cells', 'french', 'limitation'],
    ground_truth: {
      expected_text: 'Fonction Dérivée Primitive\nf(x)=e^x f\'(x)=e^x F(x)=e^x\ng(x)=sin(x) g\'(x)=cos(x) G(x)=-cos(x)',
      expected_latex: null,
      line_labels: ['table', 'table', 'table'],
      expected_latex_contains: ['Fonction'],
      expected_latex_forbids: [],
      status: 'known_limitation',
    },
  },
];

// -------------------------------------------------------------
// Synthetic Sample Specifications
// -------------------------------------------------------------
const SYNTHETIC_SAMPLES = [
  // --- DEV SET (18 samples) ---
  {
    id: 'synth_dev_superscript',
    set: 'dev',
    lang: 'en',
    tags: ['dev', 'math', 'superscript'],
    html: '<div class="math-expr">x<sup>2</sup> + y<sup>10</sup> = z<sup>3</sup></div>',
    expected_text: 'x^2 + y^10 = z^3',
    expected_latex: '\\[\nx^{2} + y^{10} = z^{3}\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['x^{2}', 'y^{10}', 'z^{3}'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_subscript',
    set: 'dev',
    lang: 'en',
    tags: ['dev', 'math', 'subscript'],
    html: '<div class="math-expr">a<sub>1</sub> + a<sub>2</sub> = a<sub>3</sub></div>',
    expected_text: 'a_1 + a_2 = a_3',
    expected_latex: '\\[\na_{1} + a_{2} = a_{3}\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['a_{1}', 'a_{2}', 'a_{3}'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_baseline_id',
    set: 'dev',
    lang: 'en',
    tags: ['dev', 'prose', 'baseline-preservation'],
    html: '<div class="prose-text">Release version2 is ready for item1 testing.</div>',
    expected_text: 'Release version2 is ready for item1 testing.',
    expected_latex: null,
    line_labels: ['prose'],
    expected_latex_contains: ['version2', 'item1'],
    expected_latex_forbids: ['version^{2}', 'item^{1}'],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_chemical',
    set: 'dev',
    lang: 'en',
    tags: ['dev', 'prose', 'chemistry', 'baseline-preservation'],
    html: '<div class="prose-text">Water consists of H2O and releases CO2 during reaction.</div>',
    expected_text: 'Water consists of H2O and releases CO2 during reaction.',
    expected_latex: null,
    line_labels: ['prose'],
    expected_latex_contains: ['H2O', 'CO2'],
    expected_latex_forbids: ['H_{2}O', 'CO_{2}'],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_calculus_dx',
    set: 'dev',
    lang: 'en',
    tags: ['dev', 'math', 'calculus'],
    html: '<div class="math-expr">∫ x<sup>2</sup> dx = x<sup>3</sup> / 3 + C</div>',
    expected_text: '∫ x^2 dx = x^3 / 3 + C',
    expected_latex: '\\[\n\\int x^{2} dx = \\frac{x^{3}}{3} + C\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['\\int', 'x^{2}', 'dx'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_matrix_bracket',
    set: 'dev',
    lang: 'en',
    tags: ['dev', 'math', 'matrix'],
    html: '<div class="matrix-box">[ 5 7 ; 2 9 ]</div>',
    expected_text: '[ 5 7 ; 2 9 ]',
    expected_latex: '\\[\n\\begin{bmatrix}\n5 & 7 \\\\\n2 & 9\n\\end{bmatrix}\n\\]',
    line_labels: ['matrix'],
    expected_latex_contains: ['\\begin{bmatrix}', '5 & 7', '2 & 9', '\\end{bmatrix}'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_system_cases',
    set: 'dev',
    lang: 'en',
    tags: ['dev', 'math', 'cases'],
    html: '<div class="cases-box">{ 3x + 2y = 12<br>{ x - y = 1</div>',
    expected_text: '{ 3x + 2y = 12\n{ x - y = 1',
    expected_latex: '\\[\n\\begin{cases}\n3x + 2y = 12 \\\\\nx - y = 1\n\\end{cases}\n\\]',
    line_labels: ['cases', 'cases'],
    expected_latex_contains: ['\\begin{cases}', '3x + 2y = 12', 'x - y = 1', '\\end{cases}'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_sqrt_scoping',
    set: 'dev',
    lang: 'en',
    tags: ['dev', 'math', 'radical'],
    html: '<div class="math-expr">√(x<sup>2</sup> + y<sup>2</sup>)</div>',
    expected_text: '√(x^2 + y^2)',
    expected_latex: '\\[\n\\sqrt{x^{2} + y^{2}}\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['\\sqrt{x^{2} + y^{2}}'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_french_action_calc',
    set: 'dev',
    lang: 'fr',
    tags: ['dev', 'french', 'action-verb', 'prose'],
    html: '<div class="prose-text">Calculer la valeur exacte de l\'expression suivante.</div>',
    expected_text: 'Calculer la valeur exacte de l\'expression suivante.',
    expected_latex: null,
    line_labels: ['prose'],
    expected_latex_contains: ['Calculer la valeur exacte'],
    expected_latex_forbids: ['\\[', '\\]'],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_french_action_montrer',
    set: 'dev',
    lang: 'fr',
    tags: ['dev', 'french', 'action-verb', 'prose'],
    html: '<div class="prose-text">Montrer que la limite en zéro est égale à un.</div>',
    expected_text: 'Montrer que la limite en zéro est égale à un.',
    expected_latex: null,
    line_labels: ['prose'],
    expected_latex_contains: ['Montrer que la limite'],
    expected_latex_forbids: ['\\[', '\\]'],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_french_action_soit',
    set: 'dev',
    lang: 'fr',
    tags: ['dev', 'french', 'action-verb', 'prose'],
    html: '<div class="prose-text">Soit n un entier naturel non nul donné.</div>',
    expected_text: 'Soit n un entier naturel non nul donné.',
    expected_latex: null,
    line_labels: ['prose'],
    expected_latex_contains: ['Soit n un entier naturel'],
    expected_latex_forbids: ['\\[', '\\]'],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_french_accents',
    set: 'dev',
    lang: 'fr',
    tags: ['dev', 'french', 'accents', 'prose'],
    html: '<div class="prose-text">L\'ingénieur vérifie l\'équation déjà résolue avec succès.</div>',
    expected_text: 'L\'ingénieur vérifie l\'équation déjà résolue avec succès.',
    expected_latex: null,
    line_labels: ['prose'],
    expected_latex_contains: ['ingénieur', 'vérifie', 'équation', 'succès'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_diameter_spec',
    set: 'dev',
    lang: 'en',
    tags: ['dev', 'prose', 'symbols'],
    html: '<div class="prose-text">The pipe diameter is Ø 40 mm nominal.</div>',
    expected_text: 'The pipe diameter is Ø 40 mm nominal.',
    expected_latex: null,
    line_labels: ['prose'],
    expected_latex_contains: ['diameter is', '40 mm'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_table_currency',
    set: 'dev',
    lang: 'en',
    tags: ['dev', 'table', 'currency'],
    html: '<table class="table-grid"><tr><th>Item</th><th>Qty</th><th>Cost</th></tr><tr><td>Monitor</td><td>2</td><td>$300</td></tr><tr><td>Desk</td><td>1</td><td>$150</td></tr></table>',
    expected_text: 'Item Qty Cost\nMonitor 2 $300\nDesk 1 $150',
    expected_latex: null,
    line_labels: ['table', 'table', 'table'],
    expected_latex_contains: ['\\begin{tabular}', 'Monitor', '\\$300', '\\$150'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_prose_uniform_words',
    set: 'dev',
    lang: 'en',
    tags: ['dev', 'prose', 'negative-table'],
    html: '<div class="prose-text">Alpha bravo charlie<br>Delta echo foxtrot<br>Golf hotel india</div>',
    expected_text: 'Alpha bravo charlie\nDelta echo foxtrot\nGolf hotel india',
    expected_latex: null,
    line_labels: ['prose', 'prose', 'prose'],
    expected_latex_contains: ['Alpha bravo charlie'],
    expected_latex_forbids: ['\\begin{tabular}', '\\begin{table}'],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_french_prose_uniform_numbers',
    set: 'dev',
    lang: 'fr',
    tags: ['dev', 'french', 'negative-table', 'prose'],
    html: '<div class="prose-text">Le fichier contient 12 données importantes.<br>Le serveur traite 14 requêtes par seconde.</div>',
    expected_text: 'Le fichier contient 12 données importantes.\nLe serveur traite 14 requêtes par seconde.',
    expected_latex: null,
    line_labels: ['prose', 'prose'],
    expected_latex_contains: ['données importantes', 'requêtes'],
    expected_latex_forbids: ['\\begin{tabular}'],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_numbered_list',
    set: 'dev',
    lang: 'en',
    tags: ['dev', 'prose', 'negative-table'],
    html: '<div class="prose-text">1. Step one preparation<br>2. Step two execution</div>',
    expected_text: '1. Step one preparation\n2. Step two execution',
    expected_latex: null,
    line_labels: ['prose', 'prose'],
    expected_latex_contains: ['Step one preparation', 'Step two execution'],
    expected_latex_forbids: ['\\begin{tabular}'],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_dev_short_expr_no_eq',
    set: 'dev',
    lang: 'en',
    tags: ['dev', 'math', 'negative-table'],
    html: '<div class="math-expr">x + y<br>a + b</div>',
    expected_text: 'x + y\na + b',
    expected_latex: '\\[\nx + y\n\\]\n\\[\na + b\n\\]',
    line_labels: ['math', 'math'],
    expected_latex_contains: ['x + y', 'a + b'],
    expected_latex_forbids: ['\\begin{tabular}'],
    status: 'supported',
    degradation: 'clean',
  },

  // --- HOLDOUT SET (23 samples: 17 original + 6 distinct sources) ---
  {
    id: 'synth_hold_poly_clean',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'polynomial', 'degradation:clean'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['2x^{3}', '5x^{2}'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_poly_rot2',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'polynomial', 'degradation:rotation'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['P(x)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'rotation_2',
  },
  {
    id: 'synth_hold_poly_blur',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'polynomial', 'degradation:blur'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['P(x)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'blur_1',
  },
  {
    id: 'synth_hold_poly_noise',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'polynomial', 'degradation:noise'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['P(x)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'noise',
  },
  {
    id: 'synth_hold_poly_low_contrast',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'polynomial', 'degradation:low-contrast'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['P(x)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'low_contrast',
  },
  {
    id: 'synth_hold_poly_low_dpi',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'polynomial', 'degradation:low-dpi'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['P(x)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'low_dpi',
  },
  {
    id: 'synth_hold_trig_identity',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'trigonometry', 'degradation:clean'],
    html: '<div class="math-expr">sin<sup>2</sup>(θ) + cos<sup>2</sup>(θ) = 1</div>',
    expected_text: 'sin^2(θ) + cos^2(θ) = 1',
    expected_latex: '\\[\n\\sin^{2}(\\theta) + \\cos^{2}(\\theta) = 1\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['sin', 'cos', '= 1'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_trig_rot3',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'trigonometry', 'degradation:rotation'],
    html: '<div class="math-expr">sin<sup>2</sup>(θ) + cos<sup>2</sup>(θ) = 1</div>',
    expected_text: 'sin^2(θ) + cos^2(θ) = 1',
    expected_latex: '\\[\n\\sin^{2}(\\theta) + \\cos^{2}(\\theta) = 1\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['sin'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'rotation_3',
  },
  {
    id: 'synth_hold_euler_identity',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'euler', 'degradation:clean'],
    html: '<div class="math-expr">e<sup>iπ</sup> + 1 = 0</div>',
    expected_text: 'e^iπ + 1 = 0',
    expected_latex: '\\[\ne^{i\\pi} + 1 = 0\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['e^{i', '+ 1 = 0'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_fraction_division',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'fraction', 'degradation:clean'],
    html: '<div class="math-expr">(a + b) / (c + d) = x / y</div>',
    expected_text: '(a + b) / (c + d) = x / y',
    expected_latex: '\\[\n\\frac{a + b}{c + d} = \\frac{x}{y}\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['\\frac{a + b}{c + d}', '\\frac{x}{y}'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_summation_limit',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'summation', 'degradation:clean'],
    html: '<div class="math-expr">∑ k<sup>2</sup> = n(n + 1)(2n + 1) / 6</div>',
    expected_text: '∑ k^2 = n(n + 1)(2n + 1) / 6',
    expected_latex: '\\[\n\\sum k^{2} = \\frac{n(n + 1)(2n + 1)}{6}\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['k^{2}', '(2n + 1)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_french_paragraph',
    set: 'holdout',
    lang: 'fr',
    tags: ['holdout', 'french', 'prose', 'degradation:clean'],
    html: '<div class="prose-text">En mathématiques, la continuité est une propriété topologique fondamentale.</div>',
    expected_text: 'En mathématiques, la continuité est une propriété topologique fondamentale.',
    expected_latex: null,
    line_labels: ['prose'],
    expected_latex_contains: ['mathématiques', 'continuité', 'topologique'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_french_quote',
    set: 'holdout',
    lang: 'fr',
    tags: ['holdout', 'french', 'typography', 'degradation:clean'],
    html: '<div class="prose-text">Le professeur a dit : « Voici l\'énoncé du problème ».</div>',
    expected_text: 'Le professeur a dit : « Voici l\'énoncé du problème ».',
    expected_latex: null,
    line_labels: ['prose'],
    expected_latex_contains: ['professeur', 'énoncé'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_table_data',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'table', 'degradation:clean'],
    html: '<table class="table-grid"><tr><th>Name</th><th>Age</th><th>Score</th></tr><tr><td>Alice</td><td>24</td><td>95</td></tr><tr><td>Bob</td><td>28</td><td>88</td></tr></table>',
    expected_text: 'Name Age Score\nAlice 24 95\nBob 28 88',
    expected_latex: null,
    line_labels: ['table', 'table', 'table'],
    expected_latex_contains: ['\\begin{tabular}', 'Alice', 'Bob'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_physics_formula',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'physics', 'degradation:clean'],
    html: '<div class="math-expr">F = G (m<sub>1</sub> m<sub>2</sub>) / r<sup>2</sup></div>',
    expected_text: 'F = G (m_1 m_2) / r^2',
    expected_latex: '\\[\nF = G \\frac{m_{1} m_{2}}{r^{2}}\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['m_{1}', 'm_{2}', 'r^{2}'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_mixed_font_math',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'degradation:clean'],
    html: '<div class="math-expr">x<sup>2</sup> + 2xy + y<sup>2</sup> = (x + y)<sup>2</sup></div>',
    expected_text: 'x^2 + 2xy + y^2 = (x + y)^2',
    expected_latex: '\\[\nx^{2} + 2xy + y^{2} = (x + y)^{2}\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['x^{2}', 'y^{2}', '(x + y)^{2}'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_complex_equation',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'complex', 'degradation:clean'],
    html: '<div class="math-expr">z = a + bi</div>',
    expected_text: 'z = a + bi',
    expected_latex: '\\[\nz = a + bi\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['z = a + bi'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  // 6 NEW DISTINCT HOLDOUT SOURCES
  {
    id: 'synth_hold_gaussian_integral',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'calculus', 'distinct-source'],
    html: '<div class="math-expr">∫ e<sup>-x^2</sup> dx = √π</div>',
    expected_text: '∫ e^-x^2 dx = √π',
    expected_latex: '\\[\n\\int e^{-x^{2}} dx = \\sqrt{\\pi}\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['\\int', 'e^{-x^{2}}'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_matrix_rotation',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'matrix', 'distinct-source'],
    html: '<div class="matrix-box">[ cos(θ) -sin(θ) ; sin(θ) cos(θ) ]</div>',
    expected_text: '[ cos(θ) -sin(θ) ; sin(θ) cos(θ) ]',
    expected_latex: '\\[\n\\begin{bmatrix}\n\\cos(\\theta) & -\\sin(\\theta) \\\\\n\\sin(\\theta) & \\cos(\\theta)\n\\end{bmatrix}\n\\]',
    line_labels: ['matrix'],
    expected_latex_contains: ['\\begin{bmatrix}', '\\cos', '\\sin', '\\end{bmatrix}'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_french_cinematics',
    set: 'holdout',
    lang: 'fr',
    tags: ['holdout', 'french', 'prose', 'physics', 'distinct-source'],
    html: '<div class="prose-text">Le vecteur vitesse est tangent à la trajectoire au point considéré.</div>',
    expected_text: 'Le vecteur vitesse est tangent à la trajectoire au point considéré.',
    expected_latex: null,
    line_labels: ['prose'],
    expected_latex_contains: ['vecteur vitesse', 'trajectoire', 'considéré'],
    expected_latex_forbids: ['\\['],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_table_elements',
    set: 'holdout',
    lang: 'fr',
    tags: ['holdout', 'table', 'chemistry', 'distinct-source'],
    html: '<table class="table-grid"><tr><th>Element</th><th>Symbole</th><th>Masse</th></tr><tr><td>Hydrogene</td><td>H</td><td>1.008</td></tr><tr><td>Helium</td><td>He</td><td>4.002</td></tr></table>',
    expected_text: 'Element Symbole Masse\nHydrogene H 1.008\nHelium He 4.002',
    expected_latex: null,
    line_labels: ['table', 'table', 'table'],
    expected_latex_contains: ['\\begin{tabular}', 'Hydrogene', 'Helium'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_logarithm_identity',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'algebra', 'distinct-source'],
    html: '<div class="math-expr">ln(xy) = ln(x) + ln(y)</div>',
    expected_text: 'ln(xy) = ln(x) + ln(y)',
    expected_latex: '\\[\n\\ln(xy) = \\ln(x) + \\ln(y)\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['ln(xy)', 'ln(x) + ln(y)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },
  {
    id: 'synth_hold_quadratic_formula',
    set: 'holdout',
    lang: 'en',
    tags: ['holdout', 'math', 'algebra', 'distinct-source'],
    html: '<div class="math-expr">x = (-b + √(b<sup>2</sup> - 4ac)) / (2a)</div>',
    expected_text: 'x = (-b + √(b^2 - 4ac)) / (2a)',
    expected_latex: '\\[\nx = \\frac{-b + \\sqrt{b^{2} - 4ac}}{2a}\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['-b', 'b^{2}', '4ac', '2a'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'clean',
  },

  // --- STRESS SET (24 samples: hard degradations that move CER) ---
  {
    id: 'synth_stress_poly_rot4',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'degradation:rotation_4'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['P(x)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'rotation_4',
  },
  {
    id: 'synth_stress_poly_rot5',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'degradation:rotation_5'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['P(x)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'rotation_5',
  },
  {
    id: 'synth_stress_poly_blur2',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'degradation:blur_2'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['P(x)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'blur_2',
  },
  {
    id: 'synth_stress_poly_heavy_noise',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'degradation:noise_heavy'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['P(x)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'noise_heavy',
  },
  {
    id: 'synth_stress_poly_contrast_squeezed',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'degradation:contrast_squeezed'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['P(x)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'contrast_squeezed',
  },
  {
    id: 'synth_stress_poly_downscale45',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'degradation:downscale_45'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['P(x)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'downscale_45',
  },
  {
    id: 'synth_stress_poly_vignette',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'degradation:vignette'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['P(x)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'vignette_lighting',
  },
  {
    id: 'synth_stress_poly_combined_rot_blur',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'degradation:combined_rot_blur'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['P(x)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'combined_rot_blur',
  },
  {
    id: 'synth_stress_poly_combined_noise_contrast',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'degradation:combined_noise_contrast'],
    html: '<div class="math-expr">P(x) = 2x<sup>3</sup> - 5x<sup>2</sup> + 3x - 7</div>',
    expected_text: 'P(x) = 2x^3 - 5x^2 + 3x - 7',
    expected_latex: '\\[\nP(x) = 2x^{3} - 5x^{2} + 3x - 7\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['P(x)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'combined_noise_contrast',
  },
  {
    id: 'synth_stress_french_rot4',
    set: 'stress',
    lang: 'fr',
    tags: ['stress', 'french', 'degradation:rotation_4'],
    html: '<div class="prose-text">Calculer la valeur exacte de l\'expression suivante.</div>',
    expected_text: 'Calculer la valeur exacte de l\'expression suivante.',
    expected_latex: null,
    line_labels: ['prose'],
    expected_latex_contains: ['valeur exacte'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'rotation_4',
  },
  {
    id: 'synth_stress_french_blur2',
    set: 'stress',
    lang: 'fr',
    tags: ['stress', 'french', 'degradation:blur_2'],
    html: '<div class="prose-text">Calculer la valeur exacte de l\'expression suivante.</div>',
    expected_text: 'Calculer la valeur exacte de l\'expression suivante.',
    expected_latex: null,
    line_labels: ['prose'],
    expected_latex_contains: ['valeur exacte'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'blur_2',
  },
  {
    id: 'synth_stress_french_noise',
    set: 'stress',
    lang: 'fr',
    tags: ['stress', 'french', 'degradation:noise_heavy'],
    html: '<div class="prose-text">L\'ingénieur vérifie l\'équation déjà résolue avec succès.</div>',
    expected_text: 'L\'ingénieur vérifie l\'équation déjà résolue avec succès.',
    expected_latex: null,
    line_labels: ['prose'],
    expected_latex_contains: ['ingénieur', 'résolue'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'noise_heavy',
  },
  {
    id: 'synth_stress_french_vignette',
    set: 'stress',
    lang: 'fr',
    tags: ['stress', 'french', 'degradation:vignette'],
    html: '<div class="prose-text">L\'élève étudie attentivement le théorème où apparaît le paramètre.</div>',
    expected_text: 'L\'élève étudie attentivement le théorème où apparaît le paramètre.',
    expected_latex: null,
    line_labels: ['prose'],
    expected_latex_contains: ['élève', 'théorème'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'vignette_lighting',
  },
  {
    id: 'synth_stress_matrix_rot4',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'matrix', 'degradation:rotation_4'],
    html: '<div class="matrix-box">[ 5 7 ; 2 9 ]</div>',
    expected_text: '[ 5 7 ; 2 9 ]',
    expected_latex: '\\[\n\\begin{bmatrix}\n5 & 7 \\\\\n2 & 9\n\\end{bmatrix}\n\\]',
    line_labels: ['matrix'],
    expected_latex_contains: ['5', '7', '2', '9'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'rotation_4',
  },
  {
    id: 'synth_stress_matrix_blur2',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'matrix', 'degradation:blur_2'],
    html: '<div class="matrix-box">[ 5 7 ; 2 9 ]</div>',
    expected_text: '[ 5 7 ; 2 9 ]',
    expected_latex: '\\[\n\\begin{bmatrix}\n5 & 7 \\\\\n2 & 9\n\\end{bmatrix}\n\\]',
    line_labels: ['matrix'],
    expected_latex_contains: ['5', '7'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'blur_2',
  },
  {
    id: 'synth_stress_matrix_noise',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'matrix', 'degradation:noise_heavy'],
    html: '<div class="matrix-box">[ 5 7 ; 2 9 ]</div>',
    expected_text: '[ 5 7 ; 2 9 ]',
    expected_latex: '\\[\n\\begin{bmatrix}\n5 & 7 \\\\\n2 & 9\n\\end{bmatrix}\n\\]',
    line_labels: ['matrix'],
    expected_latex_contains: ['5', '7'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'noise_heavy',
  },
  {
    id: 'synth_stress_table_rot4',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'table', 'degradation:rotation_4'],
    html: '<table class="table-grid"><tr><th>Item</th><th>Qty</th><th>Cost</th></tr><tr><td>Monitor</td><td>2</td><td>$300</td></tr><tr><td>Desk</td><td>1</td><td>$150</td></tr></table>',
    expected_text: 'Item Qty Cost\nMonitor 2 $300\nDesk 1 $150',
    expected_latex: null,
    line_labels: ['table', 'table', 'table'],
    expected_latex_contains: ['Monitor', 'Desk'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'rotation_4',
  },
  {
    id: 'synth_stress_table_contrast',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'table', 'degradation:contrast_squeezed'],
    html: '<table class="table-grid"><tr><th>Item</th><th>Qty</th><th>Cost</th></tr><tr><td>Monitor</td><td>2</td><td>$300</td></tr><tr><td>Desk</td><td>1</td><td>$150</td></tr></table>',
    expected_text: 'Item Qty Cost\nMonitor 2 $300\nDesk 1 $150',
    expected_latex: null,
    line_labels: ['table', 'table', 'table'],
    expected_latex_contains: ['Monitor'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'contrast_squeezed',
  },
  {
    id: 'synth_stress_table_vignette',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'table', 'degradation:vignette'],
    html: '<table class="table-grid"><tr><th>Item</th><th>Qty</th><th>Cost</th></tr><tr><td>Monitor</td><td>2</td><td>$300</td></tr><tr><td>Desk</td><td>1</td><td>$150</td></tr></table>',
    expected_text: 'Item Qty Cost\nMonitor 2 $300\nDesk 1 $150',
    expected_latex: null,
    line_labels: ['table', 'table', 'table'],
    expected_latex_contains: ['Monitor'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'vignette_lighting',
  },
  {
    id: 'synth_stress_cases_rot4',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'cases', 'degradation:rotation_4'],
    html: '<div class="cases-box">{ 3x + 2y = 12<br>{ x - y = 1</div>',
    expected_text: '{ 3x + 2y = 12\n{ x - y = 1',
    expected_latex: '\\[\n\\begin{cases}\n3x + 2y = 12 \\\\\nx - y = 1\n\\end{cases}\n\\]',
    line_labels: ['cases', 'cases'],
    expected_latex_contains: ['3x + 2y = 12'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'rotation_4',
  },
  {
    id: 'synth_stress_cases_blur2',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'cases', 'degradation:blur_2'],
    html: '<div class="cases-box">{ 3x + 2y = 12<br>{ x - y = 1</div>',
    expected_text: '{ 3x + 2y = 12\n{ x - y = 1',
    expected_latex: '\\[\n\\begin{cases}\n3x + 2y = 12 \\\\\nx - y = 1\n\\end{cases}\n\\]',
    line_labels: ['cases', 'cases'],
    expected_latex_contains: ['3x'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'blur_2',
  },
  {
    id: 'synth_stress_sqrt_rot4',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'radical', 'degradation:rotation_4'],
    html: '<div class="math-expr">√(x<sup>2</sup> + y<sup>2</sup>)</div>',
    expected_text: '√(x^2 + y^2)',
    expected_latex: '\\[\n\\sqrt{x^{2} + y^{2}}\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['x^{2}'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'rotation_4',
  },
  {
    id: 'synth_stress_fraction_rot5',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'fraction', 'degradation:rotation_5'],
    html: '<div class="math-expr">(a + b) / (c + d) = x / y</div>',
    expected_text: '(a + b) / (c + d) = x / y',
    expected_latex: '\\[\n\\frac{a + b}{c + d} = \\frac{x}{y}\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['a + b'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'rotation_5',
  },
  {
    id: 'synth_stress_combined_extreme',
    set: 'stress',
    lang: 'en',
    tags: ['stress', 'math', 'degradation:extreme'],
    html: '<div class="math-expr">x<sup>2</sup> + 2xy + y<sup>2</sup> = (x + y)<sup>2</sup></div>',
    expected_text: 'x^2 + 2xy + y^2 = (x + y)^2',
    expected_latex: '\\[\nx^{2} + 2xy + y^{2} = (x + y)^{2}\n\\]',
    line_labels: ['math'],
    expected_latex_contains: ['(x + y)'],
    expected_latex_forbids: [],
    status: 'supported',
    degradation: 'combined_rot_blur',
  },
];

// -------------------------------------------------------------
// Generation Pipeline
// -------------------------------------------------------------

async function generateAll() {
  console.log('================================================================');
  console.log('DETERMINISTIC GOLDEN CORPUS GENERATOR');
  console.log('================================================================\n');

  const manifestSamples = [...SEED_SAMPLES];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 900, height: 400 },
    deviceScaleFactor: 1,
  });

  for (let idx = 0; idx < SYNTHETIC_SAMPLES.length; idx++) {
    const spec = SYNTHETIC_SAMPLES[idx];
    const filename = `${spec.id}.png`;
    const relPath = `synthetic/${filename}`;
    const pngPath = path.join(SYNTH_DIR, filename);

    // Only render synthetic images
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 30px;
            background: #ffffff;
            font-family: 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif;
            color: #000000;
          }
          #target {
            display: inline-block;
            background: #ffffff;
            padding: 16px 24px;
          }
          .math-expr {
            font-size: 28px;
            letter-spacing: 1px;
          }
          .prose-text {
            font-size: 20px;
            line-height: 1.5;
            max-width: 650px;
          }
          .table-grid {
            border-collapse: collapse;
            font-size: 22px;
          }
          .table-grid th, .table-grid td {
            border: 1px solid #333333;
            padding: 8px 16px;
            text-align: left;
          }
          .cases-box, .matrix-box {
            font-size: 26px;
          }
        </style>
      </head>
      <body>
        <div id="target">${spec.html}</div>
      </body>
      </html>
    `;

    await page.setContent(htmlContent);
    const targetEl = await page.$('#target');
    const rawBuffer = await targetEl.screenshot({ type: 'png' });

    // Apply canvas degradation using page context with deterministic PRNG
    const finalBuffer = await page.evaluate(
      async ({ dataUrl, deg, seed }) => {
        const img = new Image();
        img.src = dataUrl;
        await new Promise((r) => (img.onload = r));

        // Mulberry32 in browser context
        let s = seed >>> 0;
        function prng() {
          let t = (s += 0x6d2b79f5);
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (deg === 'rotation_2' || deg === 'rotation_3' || deg === 'rotation_4' || deg === 'rotation_5') {
          const angles = { rotation_2: 2, rotation_3: 3, rotation_4: 4, rotation_5: 5 };
          const angleDeg = angles[deg] || 3;
          const rad = (angleDeg * Math.PI) / 180;
          canvas.width = Math.abs(img.width * Math.cos(rad)) + Math.abs(img.height * Math.sin(rad)) + 20;
          canvas.height = Math.abs(img.width * Math.sin(rad)) + Math.abs(img.height * Math.cos(rad)) + 20;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate(rad);
          ctx.drawImage(img, -img.width / 2, -img.height / 2);
        } else if (deg === 'blur_1' || deg === 'blur_2') {
          const blurPx = deg === 'blur_2' ? '2px' : '1px';
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.filter = `blur(${blurPx})`;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
        } else if (deg === 'low_contrast' || deg === 'contrast_squeezed') {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = imgData.data;
          // Squeeze into [120, 180] for stress or [80, 210] for dev
          const minVal = deg === 'contrast_squeezed' ? 120 : 80;
          const range = deg === 'contrast_squeezed' ? 60 : 130;
          for (let i = 0; i < d.length; i += 4) {
            d[i] = minVal + (d[i] / 255) * range;
            d[i + 1] = minVal + (d[i + 1] / 255) * range;
            d[i + 2] = minVal + (d[i + 2] / 255) * range;
          }
          ctx.putImageData(imgData, 0, 0);
        } else if (deg === 'noise' || deg === 'noise_heavy') {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = imgData.data;
          const amp = deg === 'noise_heavy' ? 45 : 20;
          for (let i = 0; i < d.length; i += 4) {
            const noise = (prng() * 2 - 1) * amp;
            d[i] = Math.min(255, Math.max(0, d[i] + noise));
            d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + noise));
            d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + noise));
          }
          ctx.putImageData(imgData, 0, 0);
        } else if (deg === 'downscale_45' || deg === 'low_dpi') {
          const scale = deg === 'downscale_45' ? 0.45 : 0.7;
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        } else if (deg === 'vignette_lighting') {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          const grad = ctx.createRadialGradient(
            canvas.width / 2, canvas.height / 2, 20,
            canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) / 1.5
          );
          grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
          grad.addColorStop(1, 'rgba(80, 80, 80, 0.45)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else if (deg === 'combined_rot_blur') {
          const rad = (4 * Math.PI) / 180;
          canvas.width = Math.abs(img.width * Math.cos(rad)) + Math.abs(img.height * Math.sin(rad)) + 20;
          canvas.height = Math.abs(img.width * Math.sin(rad)) + Math.abs(img.height * Math.cos(rad)) + 20;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate(rad);
          ctx.filter = 'blur(1.5px)';
          ctx.drawImage(img, -img.width / 2, -img.height / 2);
        } else if (deg === 'combined_noise_contrast') {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = imgData.data;
          for (let i = 0; i < d.length; i += 4) {
            const contrast = 100 + (d[i] / 255) * 80;
            const noise = (prng() * 2 - 1) * 25;
            d[i] = Math.min(255, Math.max(0, contrast + noise));
            d[i + 1] = Math.min(255, Math.max(0, contrast + noise));
            d[i + 2] = Math.min(255, Math.max(0, contrast + noise));
          }
          ctx.putImageData(imgData, 0, 0);
        } else {
          // Clean
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
        }

        return canvas.toDataURL('image/png');
      },
      {
        dataUrl: `data:image/png;base64,${rawBuffer.toString('base64')}`,
        deg: spec.degradation,
        seed: 1337 + idx,
      }
    );

    const base64Data = finalBuffer.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(pngPath, Buffer.from(base64Data, 'base64'));

    manifestSamples.push({
      id: spec.id,
      file: relPath,
      set: spec.set,
      lang: spec.lang,
      tags: spec.tags,
      ground_truth: {
        expected_text: spec.expected_text,
        expected_latex: spec.expected_latex || null,
        line_labels: spec.line_labels,
        expected_latex_contains: spec.expected_latex_contains,
        expected_latex_forbids: spec.expected_latex_forbids,
        status: spec.status,
      },
    });

    console.log(`✓ Generated ${spec.id} (${spec.set}, ${spec.lang}, ${spec.degradation}) -> ${relPath}`);
  }

  await browser.close();

  // Write manifest.json
  const manifest = {
    version: '1.0.0',
    description: 'Word to LaTeX Golden Evaluation Corpus (80 samples: 33 dev, 23 holdout, 24 stress)',
    total_samples: manifestSamples.length,
    dev_samples: manifestSamples.filter((s) => s.set === 'dev').length,
    holdout_samples: manifestSamples.filter((s) => s.set === 'holdout').length,
    stress_samples: manifestSamples.filter((s) => s.set === 'stress').length,
    samples: manifestSamples,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\n✓ Manifest written to ${MANIFEST_PATH} with ${manifest.total_samples} samples (dev: ${manifest.dev_samples}, holdout: ${manifest.holdout_samples}, stress: ${manifest.stress_samples})`);
}

generateAll().catch((err) => {
  console.error('Fatal error generating corpus:', err);
  process.exit(1);
});
