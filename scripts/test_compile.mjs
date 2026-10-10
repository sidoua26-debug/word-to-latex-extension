/**
 * test_compile.mjs — Comprehensive LaTeX compilation test suite.
 * Validates 100% compilation of all DOCX, Paste, and Image OCR fixtures using local Tectonic engine.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import { createPandocInstance } from '../node_modules/pandoc-wasm/src/core.js';
import { runPandocConvert } from '../src/pandocCore.ts';
import { cleanupLatex, wrapCompleteDocument } from '../src/cleanup.ts';
import { convertImageToLatex, terminateTesseractWorker } from '../src/imageOcr/ocrEngine.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(ROOT, 'tests', 'fixtures');
const REAL_FIXTURES_DIR = path.join(FIXTURES_DIR, 'real');
const TECTONIC_BIN = path.join(ROOT, '.bin', 'tectonic');
const TMP_DIR = path.join(ROOT, '.tmp_compile');

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function checkTectonic() {
  if (!fs.existsSync(TECTONIC_BIN)) {
    console.error('✗ Tectonic compiler not found at ' + TECTONIC_BIN);
    console.error("  Run 'npm run setup:tectonic' to download the pinned v0.17.0 binary into .bin/ (dev-only tool).");
    return false;
  }
  return true;
}

/**
 * Independent test harness for Fragment rows.
 * Does NOT rely on product's wrapCompleteDocument, testing that raw fragments compile
 * against a standard independent LaTeX preamble.
 */
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
  const tmpFile = path.join(TMP_DIR, `${testName.replace(/[^a-zA-Z0-9_-]/g, '_')}.tex`);
  fs.writeFileSync(tmpFile, latexCode, 'utf8');

  const res = spawnSync(TECTONIC_BIN, ['-o', TMP_DIR, tmpFile], {
    encoding: 'utf8',
    timeout: 45000,
  });

  const combinedOutput = (res.stdout || '') + '\n' + (res.stderr || '');
  const lines = combinedOutput.split('\n');

  // Strict failure checks: Missing character, Undefined control sequence, Emergency stop, LaTeX Error, Package ... Error
  const fatalErrors = [];
  const missingChars = [];
  let overfullCount = 0;
  let underfullCount = 0;

  for (const line of lines) {
    const l = line.trim();
    if (/Missing character:/i.test(l)) {
      fatalErrors.push(l);
      missingChars.push(l);
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
    } else if (/Underfull \\hbox/i.test(l)) {
      underfullCount++;
    }
  }

  const hasFatal = res.status !== 0 || fatalErrors.length > 0;
  const firstError = fatalErrors[0] || (res.status !== 0 ? (lines.find(l => l.includes('error:') || l.includes('Error:')) || lines[0] || 'Unknown compile error') : undefined);

  return {
    success: !hasFatal,
    firstError: firstError ? firstError.trim() : undefined,
    missingChars,
    overfullCount,
    underfullCount,
    fullLog: combinedOutput,
  };
}

async function runSelfTest() {
  if (!checkTectonic()) {
    process.exit(1);
  }

  console.log('================================================================');
  console.log('LATEX COMPILER GATE SELF-TEST (--selftest)');
  console.log('================================================================\n');

  const selftestCases = [
    {
      id: 'undefined_control_sequence',
      description: 'Undefined control sequence detection',
      tex: '\\documentclass{article}\n\\begin{document}\n\\badMacroABC\n\\end{document}',
      validate: (res) => {
        const failed = !res.success;
        const matched = /Undefined control sequence/i.test(res.firstError || '') || /Undefined control sequence/i.test(res.fullLog);
        return { pass: failed && matched, detail: res.firstError || 'Did not fail with Undefined control sequence' };
      },
    },
    {
      id: 'missing_glyph',
      description: 'Missing character/glyph detection via log parsing',
      tex: '\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\begin{document}\nœ\n\\end{document}',
      validate: (res) => {
        const failed = !res.success;
        const matched = res.missingChars.length > 0 && /Missing character:/i.test(res.missingChars[0]);
        return { pass: failed && matched, detail: res.missingChars[0] || 'Did not detect Missing character' };
      },
    },
    {
      id: 'latex_error',
      description: 'LaTeX structural Error detection',
      tex: '\\documentclass{article}\n\\begin{document}\n\\begin{itemize}\n\\end{document}',
      validate: (res) => {
        const failed = !res.success;
        const matched = /LaTeX Error:/i.test(res.firstError || '') || /LaTeX Error:/i.test(res.fullLog);
        return { pass: failed && matched, detail: res.firstError || 'Did not fail with LaTeX Error' };
      },
    },
    {
      id: 'overfull_hbox',
      description: 'Forced Overfull \\hbox warning detection',
      tex: '\\documentclass{article}\n\\begin{document}\n\\noindent\\mbox{AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA}\n\\end{document}',
      validate: (res) => {
        const detected = res.overfullCount > 0;
        return { pass: detected, detail: `${res.overfullCount} overfull warning(s) detected` };
      },
    },
  ];

  let allPassed = true;
  for (const c of selftestCases) {
    const res = compileLatex(c.tex, `selftest_${c.id}`);
    const check = c.validate(res);
    if (check.pass) {
      console.log(`✓ [PASS] ${c.id}: ${c.description} -> ${check.detail}`);
    } else {
      console.error(`✗ [FAIL] ${c.id}: ${c.description} -> ${check.detail}`);
      allPassed = false;
    }
  }

  if (!allPassed) {
    console.error('\n✗ Gate self-test failed: One or more failure detection categories failed.');
    process.exit(1);
  }

  console.log('\n✓ Gate self-test passed: All 4 error/warning categories correctly flagged by log parser.');
  process.exit(0);
}

async function runCompileVerification() {
  if (!checkTectonic()) {
    process.exit(1);
  }

  console.log('================================================================');
  console.log('LATEX COMPILATION TEST SUITE (Tectonic)');
  console.log('================================================================\n');

  const results = [];
  let totalTests = 0;
  let passedTests = 0;

  const wasmPath = path.join(ROOT, 'node_modules', 'pandoc-wasm', 'src', 'pandoc.wasm');
  const wasmBuffer = fs.readFileSync(wasmPath);
  const pandoc = await createPandocInstance(wasmBuffer);

  // -------------------------------------------------------------
  // 1. DOCX FIXTURES
  // -------------------------------------------------------------
  console.log('--- 1. DOCX Fixtures ---');
  const docxFixtures = [
    'anonymized_discharge_summary.docx',
    'french_diameter_spec.docx',
    'french_text.docx',
    'headings_bold_italic.docx',
    'nested_lists.docx',
    'table_with_lists.docx',
  ];

  for (const docxName of docxFixtures) {
    const filePath = path.join(FIXTURES_DIR, docxName);
    const fileBytes = fs.readFileSync(filePath);
    const rawLatex = await runPandocConvert(pandoc, { format: 'docx', bytes: fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength) });
    const cleanFragment = cleanupLatex(rawLatex);
    const isFrench = docxName.startsWith('french_');

    // Mode: Fragment (wrapped in independent minimal test harness)
    totalTests++;
    const fragDoc = wrapInIndependentHarness(cleanFragment, { hasFrench: isFrench });
    const fragRes = compileLatex(fragDoc, `docx_${docxName}_fragment`);
    if (fragRes.success) passedTests++;
    results.push({
      fixture: docxName,
      mode: 'Fragment (wrapped)',
      compiled: fragRes.success,
      firstError: fragRes.firstError || '-',
      missingChars: fragRes.missingChars,
      overfull: fragRes.overfullCount,
      underfull: fragRes.underfullCount,
    });

    // Mode: Complete Document (compiled directly as generated by product's wrapCompleteDocument)
    totalTests++;
    const fullDoc = wrapCompleteDocument(cleanFragment, { hasFrench: isFrench });
    const fullRes = compileLatex(fullDoc, `docx_${docxName}_document`);
    if (fullRes.success) passedTests++;
    results.push({
      fixture: docxName,
      mode: 'Complete Document',
      compiled: fullRes.success,
      firstError: fullRes.firstError || '-',
      missingChars: fullRes.missingChars,
      overfull: fullRes.overfullCount,
      underfull: fullRes.underfullCount,
    });
  }

  // Corrupted DOCX expected failure check
  console.log('Testing corrupted.docx error assertion...');
  const corruptedPath = path.join(FIXTURES_DIR, 'corrupted.docx');
  const corruptedBytes = fs.readFileSync(corruptedPath);
  let corruptedErrorMatched = false;
  let corruptedMessage = '';
  try {
    await runPandocConvert(pandoc, { format: 'docx', bytes: corruptedBytes.buffer.slice(corruptedBytes.byteOffset, corruptedBytes.byteOffset + corruptedBytes.byteLength) });
  } catch (err) {
    corruptedMessage = err instanceof Error ? err.message : String(err);
    if (/couldn't unpack docx container|central directory|Pandoc error/i.test(corruptedMessage)) {
      corruptedErrorMatched = true;
    }
  }
  if (!corruptedErrorMatched) {
    console.error(`✗ Corrupted DOCX did not fail with expected container/zip error: ${corruptedMessage}`);
    process.exit(1);
  }
  console.log(`✓ Corrupted DOCX correctly rejected with specific error: "${corruptedMessage.trim()}"\n`);

  // -------------------------------------------------------------
  // 2. PASTE FIXTURES
  // -------------------------------------------------------------
  console.log('--- 2. Paste Fixtures ---');
  const pasteFixtures = [
    {
      name: 'paste_french_plain_text',
      format: 'markdown',
      text: 'Ø Corps : laiton CW617N\n\nØ Pression : 0.2 à 16 bars\n\nØ Débit nominal : 70L/min',
      isFrench: true,
    },
    {
      name: 'paste_french_word_html',
      format: 'html',
      text: '<p class="MsoNormal"><span>Ø Corps : laiton CW617N</span></p><p class="MsoNormal"><span>Ø Pression : 0.2 à 16 bars</span></p><p class="MsoNormal"><span>Ø Débit nominal : 70L/min</span></p>',
      isFrench: true,
    },
    {
      name: 'paste_html_table_with_lists',
      format: 'html',
      text: '<table><tr><th>Header A</th><th>Header B</th></tr><tr><td>Row 1</td><td><ul><li>Bullet 1</li><li>Bullet 2</li></ul></td></tr></table>',
      isFrench: false,
    },
    {
      name: 'paste_french_accents',
      format: 'markdown',
      text: "Bonjour le monde ! Voici un résumé de l'œuvre : « Été, automne, hiver et printemps ». Des caractères accentués : é, è, à, ç, œ, ù, et une question : est-ce prêt ? Oui !",
      isFrench: true,
    },
    {
      name: 'paste_math_formulas',
      format: 'markdown',
      text: 'The formula is *E* = *mc*^2^ and Pythagoras is *x*^2^ + *y*^2^ = *z*^2^.',
      isFrench: false,
    },
  ];

  for (const pasteItem of pasteFixtures) {
    const rawLatex = await runPandocConvert(pandoc, {
      format: pasteItem.format,
      text: pasteItem.text,
    });
    const cleanFragment = cleanupLatex(rawLatex);

    // Mode: Fragment (wrapped in independent minimal test harness)
    totalTests++;
    const fragDoc = wrapInIndependentHarness(cleanFragment, { hasFrench: pasteItem.isFrench });
    const fragRes = compileLatex(fragDoc, `${pasteItem.name}_fragment`);
    if (fragRes.success) passedTests++;
    results.push({
      fixture: pasteItem.name,
      mode: 'Fragment (wrapped)',
      compiled: fragRes.success,
      firstError: fragRes.firstError || '-',
      missingChars: fragRes.missingChars,
      overfull: fragRes.overfullCount,
      underfull: fragRes.underfullCount,
    });

    // Mode: Complete Document (compiled directly as generated by product's wrapCompleteDocument)
    totalTests++;
    const fullDoc = wrapCompleteDocument(cleanFragment, { hasFrench: pasteItem.isFrench });
    const fullRes = compileLatex(fullDoc, `${pasteItem.name}_document`);
    if (fullRes.success) passedTests++;
    results.push({
      fixture: pasteItem.name,
      mode: 'Complete Document',
      compiled: fullRes.success,
      firstError: fullRes.firstError || '-',
      missingChars: fullRes.missingChars,
      overfull: fullRes.overfullCount,
      underfull: fullRes.underfullCount,
    });
  }

  // -------------------------------------------------------------
  // 3. IMAGE OCR FIXTURES
  // -------------------------------------------------------------
  console.log('--- 3. Image OCR Fixtures ---');
  const ocrFixtures = [
    { name: 'french_sample.png', p: path.join(FIXTURES_DIR, 'french_sample.png'), lang: 'fra' },
    { name: 'math_equation.png', p: path.join(FIXTURES_DIR, 'math_equation.png'), lang: 'eng' },
    { name: 'math_fraction.png', p: path.join(FIXTURES_DIR, 'math_fraction.png'), lang: 'eng' },
    { name: 'math_matrix.png', p: path.join(FIXTURES_DIR, 'math_matrix.png'), lang: 'eng' },
    { name: 'table_sample.png', p: path.join(FIXTURES_DIR, 'table_sample.png'), lang: 'eng' },
    { name: 'case_01_pythagoras.png', p: path.join(REAL_FIXTURES_DIR, 'case_01_pythagoras.png'), lang: 'eng' },
    { name: 'case_02_fraction.png', p: path.join(REAL_FIXTURES_DIR, 'case_02_fraction.png'), lang: 'eng' },
    { name: 'case_03_sqrt.png', p: path.join(REAL_FIXTURES_DIR, 'case_03_sqrt.png'), lang: 'eng' },
    { name: 'case_04_integral.png', p: path.join(REAL_FIXTURES_DIR, 'case_04_integral.png'), lang: 'eng' },
    { name: 'case_05_summation.png', p: path.join(REAL_FIXTURES_DIR, 'case_05_summation.png'), lang: 'eng' },
    { name: 'case_06_matrix.png', p: path.join(REAL_FIXTURES_DIR, 'case_06_matrix.png'), lang: 'eng' },
    { name: 'case_07_system.png', p: path.join(REAL_FIXTURES_DIR, 'case_07_system.png'), lang: 'eng' },
    { name: 'case_08_french_math.png', p: path.join(REAL_FIXTURES_DIR, 'case_08_french_math.png'), lang: 'fra+eng' },
    { name: 'case_09_french_accents.png', p: path.join(REAL_FIXTURES_DIR, 'case_09_french_accents.png'), lang: 'fra+eng' },
    { name: 'case_10_table_math.png', p: path.join(REAL_FIXTURES_DIR, 'case_10_table_math.png'), lang: 'fra+eng' },
  ];

  for (const ocrItem of ocrFixtures) {
    if (!fs.existsSync(ocrItem.p)) continue;

    const imgBuf = fs.readFileSync(ocrItem.p);
    const isFrench = ocrItem.lang.includes('fra');

    // 1. Fragment mode (wrapped in independent minimal test harness)
    const fragResult = await convertImageToLatex(imgBuf, {
      mode: 'fragment',
      lang: ocrItem.lang,
      hasFrench: isFrench,
    });
    const fragDoc = wrapInIndependentHarness(fragResult.latex, { hasFrench: isFrench });
    totalTests++;
    const fragRes = compileLatex(fragDoc, `ocr_${ocrItem.name}_fragment`);
    if (fragRes.success) passedTests++;
    results.push({
      fixture: ocrItem.name,
      mode: 'Fragment (wrapped)',
      compiled: fragRes.success,
      firstError: fragRes.firstError || '-',
      missingChars: fragRes.missingChars,
      overfull: fragRes.overfullCount,
      underfull: fragRes.underfullCount,
    });

    // 2. Complete Document mode (compiled directly as generated by product)
    const docResult = await convertImageToLatex(imgBuf, {
      mode: 'document',
      lang: ocrItem.lang,
      hasFrench: isFrench,
    });
    totalTests++;
    const docRes = compileLatex(docResult.latex, `ocr_${ocrItem.name}_document`);
    if (docRes.success) passedTests++;
    results.push({
      fixture: ocrItem.name,
      mode: 'Complete Document',
      compiled: docRes.success,
      firstError: docRes.firstError || '-',
      missingChars: docRes.missingChars,
      overfull: docRes.overfullCount,
      underfull: docRes.underfullCount,
    });
  }

  await terminateTesseractWorker();

  // -------------------------------------------------------------
  // OUTPUT SUMMARY TABLE
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log('LATEX COMPILE RESULTS MATRIX');
  console.log('================================================================');
  console.log('| Fixture | Mode | Compiled | First Error Line |');
  console.log('| :--- | :--- | :---: | :--- |');
  let totalOverfull = 0;
  let totalUnderfull = 0;
  const allMissingChars = [];

  for (const r of results) {
    const status = r.compiled ? 'YES' : 'NO';
    console.log(`| ${r.fixture} | ${r.mode} | ${status} | ${r.firstError} |`);
    totalOverfull += r.overfull || 0;
    totalUnderfull += r.underfull || 0;
    if (r.missingChars && r.missingChars.length > 0) {
      allMissingChars.push(...r.missingChars.map(m => `${r.fixture} (${r.mode}): ${m}`));
    }
  }
  console.log('================================================================');
  console.log(`TOTAL: ${passedTests}/${totalTests} compiled successfully (${Math.round((passedTests / totalTests) * 100)}%)\n`);

  console.log('--- Engine Warnings & Glyph Audit (Info) ---');
  console.log(`Total Overfull \\hbox warnings: ${totalOverfull}`);
  console.log(`Total Underfull \\hbox warnings: ${totalUnderfull}`);

  // Check French and special glyph missing characters: Ø, œ, «, », é, è, à, ç, etc.
  const targetSpecialGlyphs = ['Ø', 'œ', '«', '»', 'é', 'è', 'à', 'ç', 'ù', 'î', 'ô', 'ê', 'ë', 'ï', 'ü', 'ÿ'];
  const missingTargetGlyphs = allMissingChars.filter(line => targetSpecialGlyphs.some(g => line.includes(g)));

  if (allMissingChars.length === 0) {
    console.log('✓ Missing characters count: 0 (No missing glyphs detected)');
    console.log('✓ Special glyph audit: All French characters (Ø, œ, «, », é, è, à, ç, etc.) rendered intact without missing font glyphs!');
  } else {
    console.warn(`⚠ Missing character warnings detected (${allMissingChars.length}):`);
    for (const m of allMissingChars) {
      console.warn(`  - ${m}`);
    }
    if (missingTargetGlyphs.length > 0) {
      console.error(`✗ Critical: Missing glyphs for French/special characters: ${missingTargetGlyphs.join(', ')}`);
      process.exit(1);
    }
  }

  if (passedTests !== totalTests) {
    console.error(`\n✗ Compilation failures detected: ${totalTests - passedTests} failed.`);
    process.exit(1);
  } else {
    console.log('\n✓ 100% of fixture outputs compiled successfully into valid PDFs without errors!');
  }
}

if (process.argv.includes('--selftest')) {
  runSelfTest().catch(err => {
    console.error('Fatal error in compile self-test:', err);
    process.exit(1);
  });
} else {
  runCompileVerification().catch(err => {
    console.error('Fatal error in compile verification:', err);
    process.exit(1);
  });
}

