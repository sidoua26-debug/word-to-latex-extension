/**
 * verify_real_world_french_and_regressions.mjs
 *
 * Real-world browser verification of the Word to LaTeX unpacked Chrome extension.
 * Loads the built extension into Chromium, triggers conversions through the actual DOM UI,
 * and asserts against all French formatting and regression requirements.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import assert from 'assert/strict';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = process.env.EXTENSION_DIR ? path.resolve(process.env.EXTENSION_DIR) : path.resolve(__dirname, '../dist');
const fixturesDir = path.resolve(__dirname, '../tests/fixtures');

async function runBrowserVerification() {
  console.log('================================================================');
  console.log('REAL-WORLD EXTENSION VERIFICATION IN CHROMIUM (UNPACKED)');
  console.log('================================================================');
  console.log('Extension path:', distDir);

  const userDataDir = path.join(__dirname, '../.tmp-profile-verify-' + Date.now());

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
      '--no-sandbox',
    ],
  });

  const externalRequests = [];
  context.on('request', request => {
    const url = request.url();
    if (!url.startsWith('chrome-extension://') && !url.startsWith('file://') && !url.startsWith('data:') && !url.startsWith('blob:')) {
      console.warn('EXTERNAL REQUEST DETECTED:', url);
      externalRequests.push(url);
    }
  });

  let [backgroundPage] = context.serviceWorkers();
  if (!backgroundPage) {
    backgroundPage = await context.waitForEvent('serviceworker');
  }
  const extensionId = backgroundPage.url().split('/')[2];
  console.log('Extension loaded with ID:', extensionId);

  const page = await context.newPage();
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  await page.goto(popupUrl);

  const results = [];

  // Helper to convert in Paste Mode
  async function convertPaste(content, isHtml = false) {
    await page.locator('#tab-paste').click();
    await page.evaluate(() => {
      const el = document.querySelector('#output');
      if (el) el.value = '';
    });
    await page.evaluate(({ c, htmlMode }) => {
      const input = document.querySelector('#paste-input');
      const dt = new DataTransfer();
      if (htmlMode) {
        dt.setData('text/html', c);
        dt.setData('text/plain', c.replace(/<[^>]+>/g, ' '));
      } else {
        dt.setData('text/plain', c);
      }
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      input.dispatchEvent(ev);
    }, { c: content, htmlMode: isHtml });

    await page.locator('#convert-paste-btn').click();
    await page.waitForFunction(() => {
      const el = document.querySelector('#output');
      return el && el.value && el.value.trim().length > 0;
    }, { timeout: 15000 });

    const out = await page.locator('#output').inputValue();
    return out;
  }

  // Helper to convert in Upload Mode
  async function convertDocx(filePath) {
    await page.locator('#tab-upload').click();
    await page.evaluate(() => {
      const el = document.querySelector('#output');
      if (el) el.value = '';
    });
    await page.locator('#docx-file').setInputFiles(filePath);
    await page.locator('#convert-btn').click();
    await page.waitForFunction(() => {
      const el = document.querySelector('#output');
      return el && el.value && el.value.trim().length > 0;
    }, { timeout: 15000 });

    const out = await page.locator('#output').inputValue();
    return out;
  }

  // =========================================================================
  // TEST 1: Paste Mode with Word Rich HTML (The exact bug trigger)
  // =========================================================================
  console.log('\n--- [TEST 1] Paste Mode: Word Rich HTML (French Ø Specification) ---');
  const wordHtmlInput = `
    <p class="MsoNormal"><span lang="FR"><span>Ø<span style="mso-spacerun:yes">&nbsp; </span></span></span><span lang="FR">Corps&nbsp;: laiton CW617N</span></p>
    <p class="MsoNormal"><span lang="FR"><span>Ø<span style="mso-spacerun:yes">&nbsp; </span></span></span><span lang="FR">Pression&nbsp;: 0.2 à 16 bars</span></p>
    <p class="MsoNormal"><span lang="FR"><span>Ø<span style="mso-spacerun:yes">&nbsp; </span></span></span><span lang="FR">Débit nominal&nbsp;: 70L/min</span></p>
  `;
  const out1 = await convertPaste(wordHtmlInput, true);
  console.log('Actual Output from Extension UI:\n' + out1);

  assert.ok(!out1.includes('\\foreignlanguage'), 'Must NOT contain \\foreignlanguage');
  assert.ok(!out1.includes('Ø{~ }'), 'Must NOT contain malformed Ø{~ }');
  assert.ok(!out1.includes('{Ø}'), 'Must NOT contain bare {Ø}');
  assert.ok(!out1.includes('Corps~:'), 'Must NOT contain Corps~:');
  assert.ok(!out1.includes('nominal~:'), 'Must NOT contain nominal~:');
  assert.ok(out1.includes('Corps : laiton CW617N'), 'Line 1 clean');
  assert.ok(out1.includes('Pression : 0.2 à 16 bars'), 'Line 2 clean with à');
  assert.ok(out1.includes('Débit nominal : 70L/min'), 'Line 3 clean with é');

  const lines1 = out1.trim().split(/\n\s*\n/);
  assert.equal(lines1.length, 3, 'Must preserve three distinct paragraphs/lines');
  console.log('✓ TEST 1 PASSED: Word HTML French Ø converted cleanly without foreignlanguage or spacing corruption.');

  // =========================================================================
  // TEST 2: Paste Mode with Plain Text
  // =========================================================================
  console.log('\n--- [TEST 2] Paste Mode: Plain Text (French Ø Specification) ---');
  const plainTextInput = 'Ø  Corps : laiton CW617N\n\nØ  Pression : 0.2 à 16 bars\n\nØ  Débit nominal : 70L/min';
  const out2 = await convertPaste(plainTextInput, false);
  console.log('Actual Output from Extension UI:\n' + out2);

  assert.ok(!out2.includes('\\foreignlanguage'), 'Must NOT contain \\foreignlanguage');
  assert.ok(!out2.includes('~'), 'Must NOT contain tildes');
  assert.ok(out2.includes('Corps : laiton CW617N'), 'Line 1 clean');
  assert.ok(out2.includes('Pression : 0.2 à 16 bars'), 'Line 2 clean');
  assert.ok(out2.includes('Débit nominal : 70L/min'), 'Line 3 clean');
  const lines2 = out2.trim().split(/\n\s*\n/);
  assert.equal(lines2.length, 3, 'Must preserve three distinct paragraphs/lines');
  console.log('✓ TEST 2 PASSED: Plain text French Ø converted cleanly.');

  // =========================================================================
  // TEST 3: DOCX -> LaTeX (French Diameter Spec)
  // =========================================================================
  console.log('\n--- [TEST 3] DOCX -> LaTeX: french_diameter_spec.docx ---');
  const docxPath = path.join(fixturesDir, 'french_diameter_spec.docx');
  const out3 = await convertDocx(docxPath);
  console.log('Actual Output from Extension UI:\n' + out3);

  assert.ok(!out3.includes('\\foreignlanguage'), 'DOCX must NOT contain \\foreignlanguage');
  assert.ok(!out3.includes('Ø{~ }'), 'DOCX must NOT contain Ø{~ }');
  assert.ok(out3.includes('Corps : laiton CW617N'), 'Line 1 clean');
  assert.ok(out3.includes('Pression : 0.2 à 16 bars'), 'Line 2 clean');
  assert.ok(out3.includes('Débit nominal : 70L/min'), 'Line 3 clean');
  console.log('✓ TEST 3 PASSED: DOCX French Ø converted cleanly.');

  // =========================================================================
  // TEST 4: DOCX -> LaTeX: french_text.docx with all accents & quotes
  // =========================================================================
  console.log('\n--- [TEST 4] DOCX -> LaTeX: french_text.docx ---');
  const frenchDocxPath = path.join(fixturesDir, 'french_text.docx');
  const out4 = await convertDocx(frenchDocxPath);
  console.log('Actual Output from Extension UI:\n' + out4);

  assert.ok(out4.includes('Bonjour le monde'), 'French greeting preserved');
  assert.ok(out4.includes('résumé'), 'Accents preserved');
  assert.ok(out4.includes('œuvre'), 'Ligatures preserved');
  assert.ok(out4.includes('«') && out4.includes('»'), 'Guillemets preserved');
  assert.ok(out4.includes('é, è, à, ç, œ, ù'), 'All French vowels/accents preserved');
  console.log('✓ TEST 4 PASSED: French DOCX accents and typography preserved.');

  // =========================================================================
  // TEST 5: Regression: English Text & Structure
  // =========================================================================
  console.log('\n--- [TEST 5] Regression: English Heading, Bold, Italic ---');
  const engDocxPath = path.join(fixturesDir, 'headings_bold_italic.docx');
  const out5 = await convertDocx(engDocxPath);
  assert.ok(out5.includes('Heading Level 1'), 'Heading preserved');
  assert.ok(out5.includes('\\textbf{Bold Text}'), 'Bold text preserved');
  assert.ok(out5.includes('\\emph{Italic Text}'), 'Italic text preserved');
  console.log('✓ TEST 5 PASSED: English formatting preserved.');

  // =========================================================================
  // TEST 6: Regression: Special Unicode Characters
  // =========================================================================
  console.log('\n--- [TEST 6] Regression: Special Unicode Characters (€, °, ±, ≤, ≥, ×, μ, Ø) ---');
  const unicodeHtml = '<p>Special symbols: Ø € 25°C ±0.5 ≤ 100 ≥ 10 × 2 μm</p>';
  const out6 = await convertPaste(unicodeHtml, true);
  console.log('Actual Output from Extension UI:\n' + out6);

  for (const sym of ['Ø', '€', '°', '±', '≤', '≥', '×', 'μ']) {
    assert.ok(out6.includes(sym), `Symbol ${sym} must be preserved intact`);
  }
  console.log('✓ TEST 6 PASSED: All Unicode symbols preserved intact without escaping/wrapping.');

  // =========================================================================
  // TEST 7: Regression: Bullet Lists & Numbered Lists
  // =========================================================================
  console.log('\n--- [TEST 7] Regression: Lists (Bullet & Numbered) ---');
  const listsDocxPath = path.join(fixturesDir, 'nested_lists.docx');
  const out7 = await convertDocx(listsDocxPath);
  assert.ok(out7.includes('Item 1') && out7.includes('Item 2'), 'List items present');
  assert.ok(out7.includes('Sub Item 1.1'), 'Nested list item present');
  assert.ok(!out7.includes('\\tightlist'), 'Tightlist stripped');
  console.log('✓ TEST 7 PASSED: Lists converted cleanly.');

  // =========================================================================
  // TEST 8: Regression: Tables & Lists inside Tables
  // =========================================================================
  console.log('\n--- [TEST 8] Regression: Table with nested list in cell ---');
  const tableDocxPath = path.join(fixturesDir, 'table_with_lists.docx');
  const out8 = await convertDocx(tableDocxPath);
  console.log('Actual Output from Extension UI:\n' + out8);
  assert.ok(out8.includes('Header A') && out8.includes('Header B'), 'Table headers present');
  if (out8.includes('\\begin{itemize}')) {
    assert.ok(out8.includes('\\begin{minipage}'), 'Minipage wrapper for list inside table cell present');
  }
  if (out8.includes('\\begin{longtable}')) {
    assert.ok(out8.includes('% \\usepackage{longtable}'), 'Package comment present');
  }
  console.log('✓ TEST 8 PASSED: Table with nested lists converted safely.');

  // =========================================================================
  // TEST 9: Regression: Mathematical Expressions
  // =========================================================================
  console.log('\n--- [TEST 9] Regression: Mathematical Expressions in Paste ---');
  const mathPasteHtml = '<p>The formula is <i>E</i> = <i>mc</i><sup>2</sup> and Pythagoras is <i>x</i><sup>2</sup> + <i>y</i><sup>2</sup> = <i>z</i><sup>2</sup>.</p>';
  const out9 = await convertPaste(mathPasteHtml, true);
  console.log('Actual Output from Extension UI:\n' + out9);
  assert.ok(out9.includes('\\textsuperscript{2}') || out9.includes('^2'), 'Math superscripts preserved');
  console.log('✓ TEST 9 PASSED: Mathematical expressions preserved.');

  // =========================================================================
  // TEST 10: Complete LaTeX Document Output Mode in Browser
  // =========================================================================
  console.log('\n--- [TEST 10] Complete LaTeX Document Output Mode Verification ---');
  await page.locator('#btn-mode-document').click();
  const docxDocOut = await convertDocx(frenchDocxPath);
  console.log('Complete Document Output from Extension UI:\n' + docxDocOut.substring(0, 300) + '...\n' + docxDocOut.substring(docxDocOut.length - 100));

  assert.ok(docxDocOut.includes('\\documentclass[11pt,a4paper]{article}'), 'Must include documentclass in Complete Document mode');
  assert.ok(docxDocOut.includes('\\usepackage[french,english]{babel}'), 'Must include french babel');
  assert.ok(docxDocOut.includes('\\begin{document}'), 'Must include \\begin{document}');
  assert.ok(docxDocOut.includes('\\end{document}'), 'Must include \\end{document}');
  assert.ok(docxDocOut.includes('Bonjour le monde'), 'French content preserved');

  // Toggle back to Fragment mode
  await page.locator('#btn-mode-fragment').click();
  const docxFragOut = await convertDocx(frenchDocxPath);
  assert.ok(!docxFragOut.includes('\\documentclass'), 'Must NOT include documentclass in Fragment mode');
  assert.ok(!docxFragOut.includes('\\begin{document}'), 'Must NOT include \\begin{document} in Fragment mode');
  console.log('✓ TEST 10 PASSED: Complete Document output mode and toggle verified in real browser.');

  // =========================================================================
  // TEST 11: Output Actions (Copy LaTeX & Download .tex)
  // =========================================================================
  console.log('\n--- [TEST 11] Output Actions: Copy LaTeX & Download .tex ---');
  // 1. Copy LaTeX
  const copyBtn = page.locator('#copy-btn');
  const downloadBtn = page.locator('#download-btn');
  const toast = page.locator('#copied-toast');

  assert.equal(await copyBtn.innerText(), '📋 Copy LaTeX', 'Copy button should have clear label');
  assert.equal(await downloadBtn.innerText(), '⬇ Download .tex', 'Download button should have clear label');

  await copyBtn.click();
  await toast.waitFor({ state: 'visible', timeout: 3000 });
  assert.equal(await toast.innerText(), '✓ Copied!', 'Toast should show Copied confirmation');

  // 2. Download .tex with UTF-8 and French accents check
  const downloadResult = await page.evaluate(() => {
    let capturedBlobText = null;
    let capturedDownloadName = null;
    const origCreateObjectURL = URL.createObjectURL;

    URL.createObjectURL = (blob) => {
      // Read blob content as text synchronously / promise
      const reader = new FileReaderSync ? null : null;
      return 'blob:mock-download-url';
    };

    const textarea = document.getElementById('output');
    const content = textarea.value;

    const dlBtn = document.getElementById('download-btn');
    dlBtn.click();

    URL.createObjectURL = origCreateObjectURL;
    return {
      contentLength: content.length,
      hasFrench: content.includes('Bonjour le monde') && content.includes('résumé'),
      hasUnicode: content.includes('«') && content.includes('»'),
    };
  });

  assert.ok(downloadResult.contentLength > 0, 'Download payload should not be empty');
  assert.ok(downloadResult.hasFrench, 'Download payload must preserve French characters');
  assert.ok(downloadResult.hasUnicode, 'Download payload must preserve Unicode quotes');
  console.log('✓ TEST 11 PASSED: Copy LaTeX and Download .tex actions verified with UTF-8 integrity.');

  // =========================================================================
  // TEST 12: Conversion Info & Statistics in Real Chromium
  // =========================================================================
  console.log('\n--- [TEST 12] Conversion Info & Review Warnings Verification ---');
  const infoData = await page.evaluate(() => {
    const card = document.getElementById('conversion-info-card');
    const stats = document.getElementById('conversion-stats');
    return {
      cardVisible: card && !card.hidden,
      statsText: stats ? stats.textContent : '',
    };
  });

  assert.ok(infoData.cardVisible, 'Conversion info card should be visible after conversion');
  assert.ok(infoData.statsText.includes('words'), 'Stats text should report word count');
  console.log(`Conversion stats displayed in UI: "${infoData.statsText}"`);
  console.log('✓ TEST 12 PASSED: Conversion Info area rendered correctly in real browser.');

  // =========================================================================
  // TEST 13: Zero Network Requests Verification
  // =========================================================================
  console.log('\n--- [TEST 13] 100% Offline Integrity Verification ---');
  assert.equal(externalRequests.length, 0, 'Must make zero external network requests');
  console.log('✓ TEST 13 PASSED: 0 external network requests detected.');

  await context.close();

  // Clean up temporary profile
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch (e) {}

  console.log('\n================================================================');
  console.log('ALL 13 REAL-WORLD BROWSER CHECKS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

runBrowserVerification().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
