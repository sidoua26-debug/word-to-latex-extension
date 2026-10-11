import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import assert from 'assert/strict';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = process.env.EXTENSION_DIR ? path.resolve(process.env.EXTENSION_DIR) : path.resolve(__dirname, '../dist');
const fixturesDir = path.resolve(__dirname, '../tests/fixtures');
const realFixturesDir = path.resolve(__dirname, '../tests/fixtures/real');

async function testUnpackedExtension() {
  console.log('--- Testing Unpacked Extension in Chromium ---');
  console.log('Loading extension from:', distDir);

  const pathToExtension = distDir;
  const userDataDir = path.join(__dirname, '../.tmp-profile-' + Date.now());

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
      '--allow-file-access-from-files',
      '--no-sandbox',
    ],
  });

  const externalRequests = [];

  context.on('request', request => {
    const url = request.url();
    // Allow local chrome-extension://, file://, data:, or blob: URLs
    if (!url.startsWith('chrome-extension://') && !url.startsWith('file://') && !url.startsWith('data:') && !url.startsWith('blob:')) {
      console.warn('EXTERNAL NETWORK REQUEST DETECTED:', url);
      externalRequests.push(url);
    }
  });

  // Retrieve the loaded extension's ID via its background service worker
  let [backgroundPage] = context.serviceWorkers();
  if (!backgroundPage) {
    backgroundPage = await context.waitForEvent('serviceworker');
  }
  const extensionId = backgroundPage.url().split('/')[2];
  console.log('Unpacked Extension loaded with ID:', extensionId);

  // Open the extension popup directly using real chrome-extension:// scheme
  const page = await context.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));
  
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;

  console.log('Navigating to real extension popup:', popupUrl);
  await page.goto(popupUrl);

  // 1. Verify idle loading state on open
  console.log('[Check 1] Verify idle state on open...');
  const uploadBtnText = await page.locator('#convert-btn .btn-text').innerText();
  const uploadSpinnerHidden = await page.locator('#convert-btn .btn-spinner').isHidden();
  assert.equal(uploadBtnText, 'Convert to LaTeX', 'Button must show idle text');
  assert.equal(uploadSpinnerHidden, true, 'Spinner must be hidden on open');
  console.log('✓ Idle state confirmed.');

  // 2. Test DOCX conversion (Table containing a list)
  console.log('[Check 2] Testing real DOCX conversion (table_with_lists.docx)...');
  const docxPath = path.join(fixturesDir, 'table_with_lists.docx');
  await page.locator('#docx-file').setInputFiles(docxPath);
  await page.locator('#convert-btn').click();
  await page.waitForFunction(() => {
    const el = document.querySelector('#output');
    return el && el.value && el.value.length > 0;
  }, { timeout: 15000 });
  const docxOutput = await page.locator('#output').inputValue();
  assert.ok(docxOutput.includes('longtable') || docxOutput.includes('tabular'), 'Output should contain table');
  console.log('✓ DOCX conversion successful. Output length:', docxOutput.length);

  // 3. Test Paste mode with French text
  console.log('[Check 3] Testing Paste mode with French text...');
  await page.locator('#tab-paste').click();
  const frenchPasteText = "Voici un texte en français avec des accents : élève, théorème, où, déjà.";
  await page.locator('#paste-input').fill(frenchPasteText);
  await page.locator('#convert-paste-btn').click();
  await page.waitForFunction(() => {
    const el = document.querySelector('#output');
    return el && el.value && el.value.includes('théorème');
  }, { timeout: 15000 });
  const pasteOutput = await page.locator('#output').inputValue();
  assert.ok(pasteOutput.includes('théorème') && pasteOutput.includes('élève'), 'French text preserved');
  console.log('✓ Paste conversion successful.');

  // 4. Test Image to LaTeX with French accents
  console.log('[Check 4] Testing Image to LaTeX with French accents image...');
  await page.locator('#tab-image').click();
  const frenchImgPath = path.join(realFixturesDir, 'case_09_french_accents.png');
  await page.locator('#image-file').setInputFiles(frenchImgPath);
  await page.waitForSelector('#image-preview-card:not([hidden])');
  await page.locator('#convert-image-btn').click();
  
  // Wait for output
  await page.waitForFunction(() => {
    const el = document.getElementById('output');
    return el && el.value && el.value.includes('caract');
  }, { timeout: 15000 });
  
  const imgFrenchOutput = await page.locator('#output').inputValue();
  console.log('Recognized Image French Output preview:\n', imgFrenchOutput.substring(0, 200));
  assert.ok(imgFrenchOutput.includes('caract'), 'French text should be recognized');
  console.log('✓ Image French OCR successful.');

  // 5. Test Image to LaTeX with Real Math Equation
  console.log('[Check 5] Testing Image to LaTeX with Pythagoras equation...');
  await page.locator('#clear-image-btn').click({ force: true });
  await page.locator('#image-preview-card').waitFor({ state: 'hidden' });

  const pythagorasImgPath = path.join(realFixturesDir, 'case_01_pythagoras.png');
  await page.locator('#image-file').setInputFiles(pythagorasImgPath);
  await page.locator('#image-preview-card').waitFor({ state: 'visible' });
  await page.locator('#convert-image-btn').click();
  
  await page.waitForFunction(() => {
    const el = document.getElementById('output');
    return el && el.value && el.value.includes('Recognition Quality');
  }, { timeout: 20000 });
  
  const imgMathOutput = await page.locator('#output').inputValue();
  console.log('Recognized Math Equation Output:\n', imgMathOutput);
  assert.ok(imgMathOutput.includes('Recognition Quality'), 'Diagnostic headers attached');
  console.log('✓ Image Math OCR with diagnostic quality headers verified.');

  // 5b. Test Image to LaTeX with Synthetic Bordered Reference Table (Browser Canvas Retry Path)
  console.log('[Check 5b] Testing Image to LaTeX with synthetic_table_ref.png (Canvas retry path)...');
  await page.locator('#clear-image-btn').click({ force: true });
  await page.locator('#image-preview-card').waitFor({ state: 'hidden' });

  const tableImgPath = path.join(fixturesDir, 'synthetic_table_ref.png');
  await page.locator('#image-file').setInputFiles(tableImgPath);
  await page.locator('#image-preview-card').waitFor({ state: 'visible' });
  await page.locator('#convert-image-btn').click();

  await page.waitForFunction(() => {
    const el = document.getElementById('output');
    return el && el.value && el.value.includes('Age');
  }, { timeout: 25000 });

  const imgTableOutput = await page.locator('#output').inputValue();
  console.log('Recognized Synthetic Table Output (Browser Canvas Path):\n', imgTableOutput);

  assert.ok(imgTableOutput.includes('Age'), 'Output must contain header "Age"');
  const ageRows = [/20-29/, /30-39/, /40-49/, /50-59/, /60-69/, /70-79/, /80/];
  const matchedRows = ageRows.filter((r) => r.test(imgTableOutput));
  console.log(`Matched ${matchedRows.length}/7 age rows in browser canvas output.`);
  assert.ok(matchedRows.length >= 5, `Expected >= 5 age rows, matched ${matchedRows.length}`);
  assert.ok(!imgTableOutput.includes('(0%)'), 'Recognition quality must not be 0%');
  console.log('✓ Synthetic table recognized via browser canvas retry path.');

  // 6. Verify 0 external network requests
  console.log('[Check 6] Verifying zero external network calls...');
  assert.equal(externalRequests.length, 0, `Expected 0 external requests, found: ${externalRequests.join(', ')}`);
  console.log('✓ 100% offline verification confirmed: 0 external requests made.');

  await context.close();
  // Cleanup tmp profile
  fs.rmSync(userDataDir, { recursive: true, force: true });

  console.log('=== ALL MANUAL-EQUIVALENT UNPACKED EXTENSION CHECKS PASSED ===');
}

testUnpackedExtension().catch((err) => {
  console.error('Extension test failed:', err);
  process.exit(1);
});
