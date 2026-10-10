# Microsoft Edge Add-ons Store Listing Copy

This document contains all official store metadata, listing descriptions, category recommendations, and reviewer testing notes for publishing **Word to LaTeX (Offline)** to the Microsoft Edge Add-ons Partner Center.

---

### 1. Basic Metadata

- **Display Name**: `Word to LaTeX (Offline)`
  *(Matches `"name"` in `manifest.json`)*
- **Short / Promotional Description** *(max 100 characters)*:
  `Convert Word docs, pasted text, and tables to clean LaTeX — 100% offline in Microsoft Edge.`

---

### 2. Full Description

*(Character count: ~1,560 characters; well within the Partner Center 250–5,000 character limit. Focuses on user benefits, explicitly includes "Microsoft Edge", and mentions no competing browsers.)*

```
Convert Microsoft Word (.docx) documents, formatted text, and complex tables directly into clean, paste-ready LaTeX fragments — entirely client-side inside Microsoft Edge.

Word to LaTeX (Offline) brings the full power of Pandoc into your browser using WebAssembly. There are no server calls, no external APIs, and no accounts required. Your research papers, coursework, and confidential manuscripts never leave your computer.

KEY FEATURES:
• Three Conversion Modes:
  1. Upload File: Select any .docx file for instantaneous local compilation.
  2. Paste Content: Paste rich text, formatted tables, or outlines copied from Microsoft Word, Google Docs, or web pages into the interactive editor. Structure, headers, bold, italics, and tabular columns are preserved.
  3. Image to LaTeX (Experimental): Built-in offline OCR for simple typed equations, French accents, and basic formulas.
• Paste-Ready Fragments: Produces clean LaTeX snippets without unwanted \documentclass or \begin{document} wrappers, ready to drop straight into your existing Overleaf or TeXstudio projects.
• Automated Cleanup Pipeline: Automatically removes Pandoc's bare \tightlist artifacts, unwraps nested \pandocbounded{} commands, normalizes whitespace, and prepends a list of required LaTeX packages (\usepackage{booktabs}, \usepackage{longtable}, etc.) in comments.
• Instant Clipboard Sync: Converted LaTeX is immediately copied to your clipboard with a confirmation notice.
• 100% Offline & Private: Zero external network requests (permissions: []). Bundles all WebAssembly binaries and translation shims inside the extension.

IMAGE OCR SCOPE & LIMITATIONS:
• Supported: Simple typed equations, French accented text, Unicode superscripts/subscripts, simple inline fractions, and narrow stacked definite integrals.
• Limited or Unsupported: Image radicals (OCR reads √ as V), matrix reconstruction from images, summation vertical limits, systems of equations without an explicit brace, handwriting, and rotated/stylized math. Unreadable glyphs are preserved as "?" with diagnostic review warnings.
• Word Document Layout: Preserves paragraph alignment (center, flushright), explicit and approximate page breaks following Word's saved layout, and floating text boxes in document flow with proportional widths. Does not replicate exact 2D coordinates, graphical stamps, or Word line spacing.
• Review Notice: Image OCR output is experimental and must be reviewed and edited before use. Tested against an 80-sample synthetic golden corpus (median CER 19.2%, document compile rate 97.5%).
```

---

### 3. Store Categorization & Search Terms

- **Suggested Category**: `Productivity`
  - *Rationale*: Word to LaTeX (Offline) is primarily used by researchers, students, engineers, and academics to accelerate document drafting and eliminate manual reformatting between office suites and LaTeX editors. (Alternative: *Developer Tools*).
- **Search Terms / Keywords** *(Up to 21 words total, feature-based, non-deceptive)*:
  `latex docx word converter pandoc offline table academic overleaf tex typesetting markdown equation ocr manuscript paper document format`
  *(Count: 17 keywords)*

---

### 4. Support, URLs & Declarations

- **Single Purpose Statement**:
  `Converts Microsoft Word documents, pasted rich text/tables, and typed math images into clean, paste-ready LaTeX fragments locally in the browser.`
- **Website URL**:
  `https://your-domain-or-github-io.com/landing-page.html`
- **Privacy Policy URL**:
  `https://your-domain-or-github-io.com/privacy-policy.html`
- **Support Contact Email**:
  `sidoua26@gmail.com`

---

### 5. Notes for Certification (Reviewer Instructions)

Please provide the following text in the Partner Center **"Notes for certification"** field:

```
No login, subscription, or test credentials are required to verify this extension. All functionality runs client-side offline using bundled WebAssembly engines (pandoc-wasm and offline Tesseract OCR with bundled traineddata) and requires no external network connections (permissions: []).

STEPS TO TEST:
1. Open the extension popup from the Microsoft Edge toolbar.
2. Test File Upload Mode:
   - On the default "Upload File" tab, click "Choose a .docx file…" and select any standard Microsoft Word (.docx) document.
   - Click "Convert to LaTeX".
   - Verify that the LaTeX output displays in the textarea, a "Copied to clipboard!" toast notification appears, and the text is copied to the system clipboard.
3. Test Paste Mode:
   - Switch to the "Paste Content" tab at the top of the popup.
   - Copy a formatted table or formatted text with bold/italic styling from a web page or Word, and paste it into the editor box.
   - Click "Convert Pasted Content".
   - Verify that the converted LaTeX fragment renders in the textarea and copies to the clipboard.
4. Test Image to LaTeX Mode:
   - Switch to "Image to LaTeX" tab, upload a math equation PNG, and click "Convert Image to LaTeX".
   - Verify that recognized LaTeX displays with diagnostic review comments and editability.
```

---

### 6. Asset Checklist for Partner Center Submission

| Asset | Target Size | File Location | Status |
| :--- | :--- | :--- | :--- |
| **Store Listing Logo** | 300x300 PNG (solid background) | `assets/icons/300.png` | ✅ Generated |
| **Small Promo Tile** | 440x280 PNG | `assets/promo/promo-tile-small.png` | ✅ Generated |
| **Large Promo Tile** | 1400x560 PNG | `assets/promo/promo-tile-large.png` | ✅ Generated |
| **Screenshot 1 (Upload)**| 1280x800 PNG | `assets/screenshots/1-upload-file-selected.png` | ✅ Captured live |
| **Screenshot 2 (Output)**| 1280x800 PNG | `assets/screenshots/2-conversion-output-copied.png` | ✅ Captured live |
| **Screenshot 3 (Paste)** | 1280x800 PNG | `assets/screenshots/3-paste-table-converted.png` | ✅ Captured live |
| **Screenshot 4 (Image)** | 1280x800 PNG | `assets/screenshots/4-image-ocr-converted.png` | ✅ Captured live |

*Note: Microsoft Partner Center may occasionally adjust exact pixel dimension requirements for featured promotional tiles. Please verify current dimensions on the live dashboard before uploading.*
