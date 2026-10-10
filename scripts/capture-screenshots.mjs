import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const SAMPLE_DOCX = join(ROOT, 'sample-paper.docx');
const SCREENSHOTS_DIR = join(ROOT, 'assets', 'screenshots');

if (!existsSync(SCREENSHOTS_DIR)) {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

console.log('Starting Playwright Chromium browser to capture 1280x800 screenshots...');

const context = await chromium.launchPersistentContext('', {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1280,800',
  ],
});

try {
  // Determine extension ID
  const extPage = await context.newPage();
  await extPage.goto('chrome://extensions');
  const extId = await extPage.evaluate(async () => {
    const manager = document.querySelector('extensions-manager');
    const itemList = manager.shadowRoot.querySelector('extensions-item-list');
    const items = itemList.shadowRoot.querySelectorAll('extensions-item');
    for (const item of items) {
      const name = item.shadowRoot.querySelector('#name')?.textContent;
      if (name?.includes('Word to LaTeX')) {
        return item.id;
      }
    }
    return null;
  });

  if (!extId) {
    throw new Error('Could not locate extension ID on chrome://extensions');
  }

  console.log(`Located Extension ID: ${extId}`);
  await extPage.close();

  const popupUrl = `chrome-extension://${extId}/popup.html`;

  // Helper to frame the popup inside an exact, perfectly centered canvas with a premium backdrop
  async function captureFramedPopup(page, outFileName, description) {
    await page.evaluate(() => {
      // Reset html and body
      const html = document.documentElement;
      const body = document.body;

      html.style.margin = '0';
      html.style.padding = '0';
      html.style.width = '1280px';
      html.style.height = '800px';
      html.style.overflow = 'hidden';

      body.style.margin = '0';
      body.style.padding = '0';
      body.style.width = '1280px';
      body.style.height = '800px';
      body.style.overflow = 'hidden';
      body.style.display = 'flex';
      body.style.alignItems = 'center';
      body.style.justifyContent = 'center';

      // Clean, modern, high-end mesh gradient background with subtle grid
      body.style.background = `
        radial-gradient(circle at 18% 20%, rgba(37, 99, 235, 0.45) 0%, transparent 45%),
        radial-gradient(circle at 82% 75%, rgba(14, 165, 233, 0.35) 0%, transparent 40%),
        radial-gradient(circle at 50% 50%, #0f172a 0%, #020617 100%)
      `;

      // Popup card container styling
      const container = document.querySelector('.container');
      if (container) {
        container.style.width = '460px';
        container.style.maxHeight = '720px';
        container.style.overflowY = 'visible';
        container.style.borderRadius = '18px';
        container.style.background = '#ffffff';
        container.style.boxShadow = '0 30px 60px -12px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.15), 0 0 80px -20px rgba(56, 189, 248, 0.25)';
        container.style.padding = '24px';
        container.style.boxSizing = 'border-box';
      }

      // Ensure textarea fits comfortably inside 720px container
      const textarea = document.getElementById('output');
      if (textarea) {
        textarea.style.height = '180px';
      }
    });

    // Capture screenshot at exactly 1280x800
    const outPath = join(SCREENSHOTS_DIR, outFileName);
    await page.screenshot({ path: outPath });
    console.log(`✓ Saved screenshot: ${outFileName} (1280x800) — ${description}`);
  }

  // --- SCREENSHOT 1: Upload tab with sample .docx selected, ready for conversion ---
  console.log('Capturing Screenshot 1: Upload tab with file selected...');
  const page1 = await context.newPage();
  await page1.goto(popupUrl);
  await page1.waitForLoadState('domcontentloaded');

  const fileInput = await page1.$('#docx-file');
  await fileInput.setInputFiles(SAMPLE_DOCX);
  await page1.waitForTimeout(500);

  await captureFramedPopup(
    page1,
    '1-upload-file-selected.png',
    'Upload File tab with sample-paper.docx selected, Convert button active'
  );
  await page1.close();

  // --- SCREENSHOT 2: Output view after successful conversion with "Copied!" notification ---
  console.log('Capturing Screenshot 2: Successful conversion output & Copied confirmation...');
  const page2 = await context.newPage();
  await page2.goto(popupUrl);
  await page2.waitForLoadState('domcontentloaded');

  const fileInput2 = await page2.$('#docx-file');
  await fileInput2.setInputFiles(SAMPLE_DOCX);
  await page2.click('#convert-btn');

  // Wait for conversion output to appear
  await page2.waitForSelector('#output-wrapper:not([hidden])', { timeout: 15000 });
  await page2.waitForTimeout(800);

  await captureFramedPopup(
    page2,
    '2-conversion-output-copied.png',
    'LaTeX fragment output with package headers and Copied! toast notification'
  );
  await page2.close();

  // --- SCREENSHOT 3: Paste Content tab with table and converted output ---
  console.log('Capturing Screenshot 3: Paste Content tab with table conversion...');
  const page3 = await context.newPage();
  await page3.goto(popupUrl);
  await page3.waitForLoadState('domcontentloaded');

  // Switch to paste tab
  await page3.click('#tab-paste');
  await page3.waitForTimeout(300);

  // Populate contenteditable with rich table HTML
  const sampleTableHtml = `
    <h3>Experimental Benchmarks</h3>
    <table border="1" style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="background: #f1f5f9;">
          <th>Benchmark Suite</th>
          <th>Baseline</th>
          <th>Optimized</th>
          <th>Speedup</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Docx Parser</td>
          <td>142 ms</td>
          <td>38 ms</td>
          <td><b>3.7x</b></td>
        </tr>
        <tr>
          <td>AST Compaction</td>
          <td>95 ms</td>
          <td>22 ms</td>
          <td><b>4.3x</b></td>
        </tr>
      </tbody>
    </table>
  `.trim();

  await page3.evaluate((html) => {
    const pasteInput = document.getElementById('paste-input');
    pasteInput.innerHTML = html;
    pasteInput.dispatchEvent(new Event('input', { bubbles: true }));
  }, sampleTableHtml);

  await page3.waitForTimeout(400);

  // Click convert paste button
  await page3.click('#convert-paste-btn');

  // Wait for conversion output
  await page3.waitForSelector('#output-wrapper:not([hidden])', { timeout: 15000 });
  await page3.waitForTimeout(800);

  await captureFramedPopup(
    page3,
    '3-paste-table-converted.png',
    'Paste Content tab with rich table structure converted to LaTeX longtable/booktabs'
  );
  await page3.close();

  // --- SCREENSHOT 4: Image to LaTeX tab with mathematical OCR conversion ---
  console.log('Capturing Screenshot 4: Image to LaTeX OCR conversion...');
  const page4 = await context.newPage();
  await page4.goto(popupUrl);
  await page4.waitForLoadState('domcontentloaded');

  // Switch to image tab
  await page4.click('#tab-image');
  await page4.waitForTimeout(300);

  // Select math image
  const imageInput = await page4.$('#image-file');
  await imageInput.setInputFiles(join(ROOT, 'corpus/seed/math_equation.png'));
  await page4.waitForTimeout(300);

  // Click convert image button
  await page4.click('#convert-image-btn');

  // Wait for conversion output
  await page4.waitForSelector('#output-wrapper:not([hidden])', { timeout: 30000 });
  await page4.waitForTimeout(800);

  await captureFramedPopup(
    page4,
    '4-image-ocr-converted.png',
    'Image to LaTeX tab with formula OCR converted to clean LaTeX math'
  );
  await page4.close();

  console.log('✓ All 4 live store screenshots captured successfully with centered framing!');
} catch (err) {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
} finally {
  await context.close();
}

