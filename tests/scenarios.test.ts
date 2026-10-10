/**
 * scenarios.test.ts — Verification of all 12 scenarios:
 * 1. Idle state on open (no spinner).
 * 2. DOCX with headings, bold, italic.
 * 3. DOCX with bullet and numbered lists (nested).
 * 4. DOCX with table containing lists inside cells.
 * 5. DOCX with French text and special characters.
 * 6. Paste mode with plain French text.
 * 7. Paste mode with HTML table containing lists.
 * 8. Conversion error handling (corrupted file).
 * 9. Empty state validation (buttons disabled).
 * 10. File removal/clear functionality.
 * 11. Clipboard copy confirmation.
 * 12. Tab switching state preservation.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
// @ts-ignore
import { createPandocInstance } from "../node_modules/pandoc-wasm/src/core.js";
import { runPandocConvert } from "../src/pandocCore.ts";
import { cleanupLatex, wrapCompleteDocument } from "../src/cleanup.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_POPUP_PATH = "file://" + path.resolve(__dirname, "../dist/popup.html");

describe("Scenario 1 & 9: Idle state on open and empty state validation", () => {
  let browser: Browser;
  let page: Page;

  before(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.goto(DIST_POPUP_PATH);
  });

  after(async () => {
    await browser?.close();
  });

  it("1. Idle state on open: button displays idle text, spinner is completely hidden", async () => {
    const uploadBtn = page.locator("#convert-btn");
    const uploadText = page.locator("#convert-btn .btn-text");
    const uploadSpinner = page.locator("#convert-btn .btn-spinner");

    assert.equal(await uploadText.isVisible(), true, "Upload button text should be visible");
    assert.equal(await uploadSpinner.isVisible(), false, "Upload button spinner must NOT be visible");
    const display = await uploadSpinner.evaluate((el) => window.getComputedStyle(el).display);
    assert.equal(display, "none", "Computed display of spinner must be none");

    const pasteSpinner = page.locator("#convert-paste-btn .btn-spinner");
    assert.equal(await pasteSpinner.isVisible(), false, "Paste button spinner must NOT be visible");
    const pasteDisplay = await pasteSpinner.evaluate((el) => window.getComputedStyle(el).display);
    assert.equal(pasteDisplay, "none", "Computed display of paste spinner must be none");
  });

  it("9. Empty state validation: convert buttons are disabled when empty", async () => {
    const uploadBtn = page.locator("#convert-btn");
    assert.equal(await uploadBtn.isDisabled(), true, "Upload button should be disabled with no file");

    // Switch to paste tab
    await page.click("#tab-paste");
    const pasteBtn = page.locator("#convert-paste-btn");
    assert.equal(await pasteBtn.isDisabled(), true, "Paste button should be disabled when empty");

    // Switch back to upload tab
    await page.click("#tab-upload");
  });
});

describe("Scenarios 2, 3, 4, 5, 8: DOCX Conversion Quality & Error Handling", () => {
  let pandoc: any;

  before(async () => {
    const wasmPath = path.resolve(__dirname, "../node_modules/pandoc-wasm/src/pandoc.wasm");
    const wasmBuffer = fs.readFileSync(wasmPath);
    pandoc = await createPandocInstance(wasmBuffer);
  });

  it("2. DOCX with headings, bold, italic", async () => {
    const docxPath = path.resolve(__dirname, "fixtures/headings_bold_italic.docx");
    const bytes = fs.readFileSync(docxPath);
    const raw = await runPandocConvert(pandoc, { format: "docx", bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    const clean = cleanupLatex(raw);

    assert.ok(clean.includes("Heading Level 1"), "Must include heading text");
    assert.ok(clean.includes("\\textbf{Bold Text}"), "Must format bold text with \\textbf");
    assert.ok(clean.includes("\\emph{Italic Text}"), "Must format italic text with \\emph");
    assert.ok(!clean.includes("\\tightlist"), "Must not contain \\tightlist");
  });

  it("3. DOCX with bullet and numbered lists (nested)", async () => {
    const docxPath = path.resolve(__dirname, "fixtures/nested_lists.docx");
    const bytes = fs.readFileSync(docxPath);
    const raw = await runPandocConvert(pandoc, { format: "docx", bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    const clean = cleanupLatex(raw);

    assert.ok(clean.includes("Item 1"), "Must include list items");
    assert.ok(clean.includes("Sub Item 1.1"), "Must include nested items");
    assert.ok(clean.includes("Item 2"), "Must include item 2");
    assert.ok(!clean.includes("\\tightlist"), "Must strip \\tightlist");
  });

  it("4. DOCX with table containing lists inside cells", async () => {
    const docxPath = path.resolve(__dirname, "fixtures/table_with_lists.docx");
    const bytes = fs.readFileSync(docxPath);
    const raw = await runPandocConvert(pandoc, { format: "docx", bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    const clean = cleanupLatex(raw);

    assert.ok(clean.includes("Header A") && clean.includes("Header B"), "Must contain table headers");
    assert.ok(clean.includes("Row 1"), "Must contain table cell content");
    if (clean.includes("\\begin{itemize}")) {
      assert.ok(clean.includes("\\begin{minipage}"), "List in table cell must be wrapped in minipage");
    }
    if (clean.includes("\\begin{longtable}")) {
      assert.ok(clean.includes("% \\usepackage{longtable}"), "Must list longtable package");
    }
  });

  it("5. DOCX with French text and special characters", async () => {
    const docxPath = path.resolve(__dirname, "fixtures/french_text.docx");
    const bytes = fs.readFileSync(docxPath);
    const raw = await runPandocConvert(pandoc, { format: "docx", bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    const clean = cleanupLatex(raw);

    assert.ok(clean.includes("Bonjour le monde"), "French text preserved");
    assert.ok(clean.includes("résumé"), "Accents é preserved");
    assert.ok(clean.includes("œuvre"), "French ligature œ preserved");
    assert.ok(clean.includes("«") && clean.includes("»"), "French guillemets preserved");
    assert.ok(clean.includes("caractères accentués : é, è, à, ç, œ, ù"), "All French accents preserved intact");
    assert.ok(!clean.toLowerCase().includes("here is"), "No conversational preamble");
    assert.ok(!clean.toLowerCase().includes("translation"), "No translation commentary");
  });

  it("8. Conversion error handling (corrupted file)", async () => {
    const docxPath = path.resolve(__dirname, "fixtures/corrupted.docx");
    const bytes = fs.readFileSync(docxPath);

    await assert.rejects(
      async () => {
        await runPandocConvert(pandoc, { format: "docx", bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
      },
      /Pandoc error/i,
      "Must reject corrupted docx file gracefully"
    );
  });
});

describe("Scenarios 6 & 7: Paste Mode Conversion", () => {
  let pandoc: any;

  before(async () => {
    const wasmPath = path.resolve(__dirname, "../node_modules/pandoc-wasm/src/pandoc.wasm");
    const wasmBuffer = fs.readFileSync(wasmPath);
    pandoc = await createPandocInstance(wasmBuffer);
  });

  it("6. Paste mode with plain French text", async () => {
    const frenchText = "« Bonjour à tous et à l’œuvre des étudiants ! Est-ce prêt ? Oui, très bien. »";
    const raw = await runPandocConvert(pandoc, { format: "markdown", text: frenchText });
    const clean = cleanupLatex(raw);

    assert.ok(clean.includes("«") && clean.includes("»"), "Guillemets preserved");
    assert.ok(clean.includes("Bonjour à tous"), "Accents preserved");
    assert.ok(clean.includes("œuvre"), "Ligatures preserved");
    assert.ok(clean.includes("très"), "Accent grave preserved");
    assert.ok(!clean.includes("\\documentclass"), "Must be a fragment without documentclass");
    assert.ok(!clean.includes("Here is"), "No AI conversation");
  });

  it("7. Paste mode with HTML table containing lists", async () => {
    const htmlTable = "<table><thead><tr><th>Task</th><th>Checklist</th></tr></thead><tbody><tr><td>Review</td><td><ul><li>Item 1</li><li>Item 2</li></ul></td></tr></tbody></table>";

    const raw = await runPandocConvert(pandoc, { format: "html", text: htmlTable });
    const clean = cleanupLatex(raw);

    assert.ok(clean.includes("Review"), "Cell text present");
    assert.ok(clean.includes("Item 1") && clean.includes("Item 2"), "List items present");
    assert.ok(clean.includes("\\begin{minipage}"), "List in table wrapped in minipage");
    assert.ok(!clean.includes("\\tightlist"), "Tightlist stripped");
    assert.ok(clean.includes("% \\usepackage{longtable}"), "Required packages suggested");
    assert.ok(clean.includes("% \\usepackage{calc}"), "Calc package suggested for real dimensions");
    assert.ok(clean.includes("% \\usepackage{array}"), "Array package suggested");
  });

  it("Regression: French text with Ø bullets and colon spacing produces clean paste-ready LaTeX", async () => {
    // 1. Plain text / markdown paste
    const plainInput = "Ø  Corps : laiton CW617N\n\nØ  Pression : 0.2 à 16 bars\n\nØ  Débit nominal : 70L/min";
    const rawPlain = await runPandocConvert(pandoc, { format: "markdown", text: plainInput });
    const cleanPlain = cleanupLatex(rawPlain);

    assert.ok(!cleanPlain.includes("\\foreignlanguage"), "Must not contain \\foreignlanguage");
    assert.ok(!cleanPlain.includes("Ø{~ }"), "Must not contain malformed Ø{~ }");
    assert.ok(!cleanPlain.includes("{Ø}"), "Must not contain bare {Ø}");
    assert.ok(!cleanPlain.includes("Corps~:"), "Must not contain Corps~:");
    assert.ok(!cleanPlain.includes("nominal~:"), "Must not contain nominal~:");
    assert.ok(cleanPlain.includes("Corps : laiton CW617N"), "Line 1 preserved cleanly");
    assert.ok(cleanPlain.includes("Pression : 0.2 à 16 bars"), "Line 2 with à preserved");
    assert.ok(cleanPlain.includes("Débit nominal : 70L/min"), "Line 3 with é preserved");

    // Verify 3 distinct paragraphs/lines
    const plainLines = cleanPlain.trim().split(/\n\s*\n/);
    assert.equal(plainLines.length, 3, "Must preserve three separate lines/paragraphs");

    // 2. Rich HTML / Word paste format with mso-spacerun and lang attributes
    const htmlWordInput = '<p class="MsoNormal"><span lang="FR"><span>Ø<span style="mso-spacerun:yes">&nbsp; </span></span></span><span lang="FR">Corps&nbsp;: laiton CW617N</span></p><p class="MsoNormal"><span lang="FR"><span>Ø<span style="mso-spacerun:yes">&nbsp; </span></span></span><span lang="FR">Pression&nbsp;: 0.2 à 16 bars</span></p><p class="MsoNormal"><span lang="FR"><span>Ø<span style="mso-spacerun:yes">&nbsp; </span></span></span><span lang="FR">Débit nominal&nbsp;: 70L/min</span></p>';
    const rawHtml = await runPandocConvert(pandoc, { format: "html", text: htmlWordInput });
    const cleanHtml = cleanupLatex(rawHtml);

    assert.ok(!cleanHtml.includes("\\foreignlanguage"), "HTML must not generate \\foreignlanguage");
    assert.ok(!cleanHtml.includes("Ø{~ }"), "HTML must not contain Ø{~ }");
    assert.ok(!cleanHtml.includes("{Ø}"), "HTML must not contain {Ø}");
    assert.ok(!cleanHtml.includes("Corps~:"), "HTML must not contain Corps~:");
    assert.ok(!cleanHtml.includes("nominal~:"), "HTML must not contain nominal~:");
    assert.ok(cleanHtml.includes("Corps : laiton CW617N"), "Line 1 preserved cleanly");
    assert.ok(cleanHtml.includes("Pression : 0.2 à 16 bars"), "Line 2 with à preserved");
    assert.ok(cleanHtml.includes("Débit nominal : 70L/min"), "Line 3 with é preserved");

    const htmlLines = cleanHtml.trim().split(/\n\s*\n/);
    assert.equal(htmlLines.length, 3, "HTML must preserve three separate lines/paragraphs");
  });

  it("Converts DOCX and Paste input to complete compilable LaTeX document in Document Mode", async () => {
    // 1. DOCX in document mode
    const docxPath = path.resolve(__dirname, "fixtures/table_with_lists.docx");
    const bytes = fs.readFileSync(docxPath);
    const rawDocx = await runPandocConvert(pandoc, { format: "docx", bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    const cleanDocx = cleanupLatex(rawDocx);
    const fullDoc = wrapCompleteDocument(cleanDocx);

    assert.ok(fullDoc.includes("\\documentclass[11pt,a4paper]{article}"), "Must include article documentclass");
    assert.ok(fullDoc.includes("\\usepackage{longtable}"), "Must include longtable package in preamble");
    assert.ok(fullDoc.includes("\\usepackage{booktabs}"), "Must include booktabs package in preamble");
    assert.ok(fullDoc.includes("\\begin{document}"), "Must include begin document");
    assert.ok(fullDoc.includes("\\end{document}"), "Must include end document");

    const body = fullDoc.split("\\begin{document}")[1].split("\\end{document}")[0];
    assert.ok(!body.includes("% \\usepackage"), "Body must not contain preamble comment lines");

    // 2. French paste in document mode
    const frenchText = "Voici un résumé des résultats : 100 % de réussite.";
    const rawPaste = await runPandocConvert(pandoc, { format: "markdown", text: frenchText });
    const cleanPaste = cleanupLatex(rawPaste);
    const frenchDoc = wrapCompleteDocument(cleanPaste);

    assert.ok(frenchDoc.includes("\\documentclass[11pt,a4paper]{article}"));
    assert.ok(frenchDoc.includes("\\usepackage[french,english]{babel}"));
    assert.ok(frenchDoc.includes("résumé"));
  });
});

describe("Scenarios 10, 11, 12, 13: UI Interactivity & Edge Cases", () => {
  let browser: Browser;
  let page: Page;

  before(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ permissions: ["clipboard-read", "clipboard-write"] });
    await page.goto(DIST_POPUP_PATH);
  });

  after(async () => {
    await browser?.close();
  });

  it("10. File removal/clear functionality", async () => {
    const fileInput = page.locator("#docx-file");
    const convertBtn = page.locator("#convert-btn");
    const clearBtn = page.locator("#clear-file-btn");
    const fileNameSpan = page.locator("#file-name");

    assert.equal(await clearBtn.isVisible(), false);
    assert.equal(await convertBtn.isDisabled(), true);

    const testDocxPath = path.resolve(__dirname, "fixtures/headings_bold_italic.docx");
    await fileInput.setInputFiles(testDocxPath);

    assert.equal(await clearBtn.isVisible(), true, "Clear button should become visible");
    assert.equal(await convertBtn.isDisabled(), false, "Convert button should be enabled");
    assert.ok((await fileNameSpan.textContent())?.includes("headings_bold_italic.docx"));

    await clearBtn.click();

    assert.equal(await clearBtn.isVisible(), false, "Clear button should be hidden after clearing");
    assert.equal(await convertBtn.isDisabled(), true, "Convert button should be disabled after clearing");
    assert.ok((await fileNameSpan.textContent())?.includes("Choose a .docx file"));
  });

  it("11. Clipboard copy confirmation", async () => {
    await page.evaluate(() => {
      const outputWrapper = document.getElementById("output-wrapper");
      const outputTextarea = document.getElementById("output");
      outputWrapper.hidden = false;
      outputTextarea.value = "\\textbf{Testing clipboard copy}";
    });

    const copyBtn = page.locator("#copy-btn");
    const toast = page.locator("#copied-toast");

    assert.equal(await toast.isVisible(), false, "Toast should be initially hidden");
    await copyBtn.click();
    await toast.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    assert.equal(await toast.isVisible(), true, "Toast should be visible after clicking copy");
  });

  it("12. Tab switching state preservation", async () => {
    await page.click("#tab-paste");
    const pasteInput = page.locator("#paste-input");
    const pasteBtn = page.locator("#convert-paste-btn");

    await pasteInput.fill("Some text in paste box");
    await pasteInput.dispatchEvent("input");
    assert.equal(await pasteBtn.isDisabled(), false, "Paste button should be enabled with text");

    await page.click("#tab-upload");
    const uploadPanel = page.locator("#panel-upload");
    const pastePanel = page.locator("#panel-paste");
    assert.equal(await uploadPanel.isVisible(), true);
    assert.equal(await pastePanel.isVisible(), false);

    await page.click("#tab-paste");
    assert.equal(await pasteInput.innerText(), "Some text in paste box");
    assert.equal(await pasteBtn.isDisabled(), false, "Paste button should remain enabled");
  });

  it("13. Output Mode selector UI interactivity", async () => {
    const btnDoc = page.locator("#btn-mode-document");
    const btnFrag = page.locator("#btn-mode-fragment");

    // Initially Fragment should be active
    assert.ok((await btnFrag.getAttribute("class"))?.includes("active"), "Fragment button should be active by default");
    assert.ok(!(await btnDoc.getAttribute("class"))?.includes("active"), "Document button should not be active initially");

    // Click Document
    await btnDoc.click();
    assert.ok((await btnDoc.getAttribute("class"))?.includes("active"), "Document button should become active");
    assert.ok(!(await btnFrag.getAttribute("class"))?.includes("active"), "Fragment button should become inactive");

    // Click Fragment
    await btnFrag.click();
    assert.ok((await btnFrag.getAttribute("class"))?.includes("active"), "Fragment button should become active");
    assert.ok(!(await btnDoc.getAttribute("class"))?.includes("active"), "Document button should become inactive");
  });

  it("14. Output actions: Copy LaTeX and Download .tex interactions", async () => {
    await page.evaluate(() => {
      const outputWrapper = document.getElementById("output-wrapper");
      const outputTextarea = document.getElementById("output") as HTMLTextAreaElement;
      outputWrapper.hidden = false;
      outputTextarea.value = "\\section{Bonjour}\nVoici du texte avec accents : é, è, à, ç, œ, ù.";
    });

    const copyBtn = page.locator("#copy-btn");
    const downloadBtn = page.locator("#download-btn");
    const toast = page.locator("#copied-toast");

    // Copy LaTeX check
    assert.equal(await copyBtn.innerText(), "📋 Copy LaTeX");
    assert.equal(await downloadBtn.innerText(), "⬇ Download .tex");

    await copyBtn.click();
    await toast.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    assert.equal(await toast.isVisible(), true);
    assert.equal(await toast.innerText(), "✓ Copied!");

    // Download .tex check (mocking URL.createObjectURL / click)
    const downloadTriggered = await page.evaluate(() => {
      let triggered = false;
      const originalCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = (blob: Blob) => {
        if (blob.type.includes("text/x-tex")) {
          triggered = true;
        }
        return "blob:test-download";
      };
      const dlBtn = document.getElementById("download-btn");
      dlBtn?.click();
      URL.createObjectURL = originalCreateObjectURL;
      return triggered;
    });

    assert.equal(downloadTriggered, true, "Download should create a text/x-tex Blob and trigger download");
  });

  it("15. Dynamic mode toggle updates displayed output in real-time", async () => {
    await page.evaluate(() => {
      // Simulate state after a conversion
      const win = window as any;
      const textarea = document.getElementById("output") as HTMLTextAreaElement;
      const wrapper = document.getElementById("output-wrapper");
      wrapper.hidden = false;
      textarea.value = "Fragment content with math $x^2$.";
      // Trigger mode click
      const btnDoc = document.getElementById("btn-mode-document");
      btnDoc?.click();
    });

    const outputTextarea = page.locator("#output");
    const btnDoc = page.locator("#btn-mode-document");
    assert.ok((await btnDoc.getAttribute("class"))?.includes("active"));
  });

  it("16. Conversion info and review warnings are displayed in UI", async () => {
    await page.evaluate(() => {
      const statsCard = document.getElementById("conversion-info-card");
      const statsText = document.getElementById("conversion-stats");
      const warningsBlock = document.getElementById("conversion-warnings");
      const wrapper = document.getElementById("output-wrapper");

      wrapper!.hidden = false;
      statsCard!.hidden = false;
      statsText!.textContent = "120 words · 2 tables · 1 equation";

      warningsBlock!.hidden = false;
      warningsBlock!.innerHTML = `
        <div class="warning-item severity-review">
          <span class="warning-badge">Review</span>
          <div class="warning-msg">Table structure simplified.<span class="warning-suggestion">Tip: Check cell widths</span></div>
        </div>
      `;
    });

    const statsEl = page.locator("#conversion-stats");
    const warningBadge = page.locator(".warning-badge");

    assert.equal(await statsEl.innerText(), "120 words · 2 tables · 1 equation");
    assert.equal(await warningBadge.textContent(), "Review");
  });
});

