# Word to LaTeX (Offline) — Chrome & Microsoft Edge Extension

A browser extension (Manifest V3) that converts `.docx` (Microsoft Word) files and pasted rich/plain text directly to clean, paste-ready LaTeX entirely client-side using [Pandoc WASM](https://github.com/pandoc/pandoc-wasm). No server calls, no native binaries — works fully offline once installed.

## Features

- **100% Offline & Private**: Zero external network requests (permissions: `[]`). All processing happens client-side via WebAssembly (`pandoc-wasm` and Tesseract.js with bundled traineddata). Your files, pasted content, and images never leave your machine.
- **Three Conversion Modes**:
  - **Upload File**: Select and convert local `.docx` files.
  - **Paste Content**: Paste formatted content, tables, or text from Word, Google Docs, or web pages into a `contenteditable` container. Preserves formatting (bold, italic, tables, lists, headers) via `text/html` clipboard data, with graceful fallback to markdown/plain text.
  - **Image to LaTeX (Experimental)**: Convert screenshots and typed math equation images into LaTeX offline.
- **Paste-Ready Output**: Produces a LaTeX fragment (no `\documentclass` / `\begin{document}` wrapper) ready to paste directly into an existing document body. Complete Document mode is also available with full preambles.
- **Auto-Cleanup Pipeline**:
  - Removes bare `\tightlist` lines.
  - Recursively unwraps `\pandocbounded{...}` commands while tracking brace depth.
  - Collapses 3+ consecutive blank lines down to 2 and trims trailing whitespace.
  - Detects required packages (`booktabs`, `longtable`, `graphicx`, `hyperref`) and prepends a `% Required packages` comment block.
- **Instant Copy**: Automatically copies the converted LaTeX to clipboard with visual confirmation and source indication.

## Image to LaTeX: Supported Scope & Limitations

The Image to LaTeX feature is designed for basic conversion assistance and is **experimental**. Users must review and edit output before use.

- **Supported**:
  - Clean, high-contrast, typed single-line equations.
  - Greek letters and standard mathematical operators.
  - French language text and accented characters (`é`, `è`, `à`, `ç`, `œ`, `ù`).
  - Unicode superscripts, subscripts, and simple inline fractions (e.g. `1/2`).
  - Line-by-line classification heuristics separating natural prose paragraphs from display math equations.
  - Definite integrals in a narrow stacked 3-line layout (bracket/integral operator, limit lines, and integrand ending in a standalone differential `dx`).
- **Limited or Unsupported**:
  - **Radicals / Square roots**: OCR frequently transcribes square root symbols `√` as the letter `V`.
  - **Matrices & Grids**: Grid reconstruction from images without clear brackets is unreliable.
  - **Summations**: Vertical limits above and below `\sum` are frequently transcribed inline.
  - **Systems of Equations**: Only parsed into a `cases` environment if an explicit left brace `{` or piecewise condition keywords are detected.
  - **Handwriting & Stylized Math**: Handwritten notes, blackboard/whiteboard photos, and rotated or blurry images are not supported.
  - **Unrecognized Glyphs**: Preserved as `?` with a `% [Warning]` header rather than guessed.
- **Golden Evaluation Corpus & Measured Baseline**:
  - Image OCR is **experimental** and requires manual review and editing before publication.
  - Benchmarked against an 80-sample synthetic and curated test corpus (33 dev, 23 holdout, 24 stress).
  - Measured baseline metrics from `baseline.json`:
    - Overall (80 samples): median Character Error Rate (CER) 19.2% (mean 30.4%), LaTeX token F1 mean 46.0%, document compile rate 97.5%.
    - Dev split (33 samples): median CER 25.0% (mean 28.9%), document compile rate 100%.
    - Holdout split (23 samples): median CER 14.8% (mean 24.6%), document compile rate 100%.
    - Stress split (24 samples): median CER 25.0% (mean 38.1%), document compile rate 91.7%.

## Word Documents: Preserved vs. Not Preserved Layout

### Preserved
- **Paragraph Alignment**: Centered (`\begin{center}`) and right-aligned (`\begin{flushright}`) paragraphs.
- **Page Breaks**: Hard page breaks (`w:br type="page"`), `pageBreakBefore`, section breaks, and approximate page breaks following Word's last saved layout (`lastRenderedPageBreak` markers, default ON when markers are present).
- **Text Boxes**: Extracted into document flow with approximate position and proportional width mini-pages (`0.25\linewidth` to `0.90\linewidth` based on box dimensions).
- **Page Geometry**: Page size (`pgSz`) and margins (`pgMar`) mapped to matching `\usepackage[...]{geometry}` options in Complete Document mode.
- **Document Content**: Headings, lists, bold/italic formatting, nested tables, hyperlinks, and mathematical formulas.

### Not Preserved
- **Exact 2D Coordinates & Overlap**: Free-floating coordinate positioning and overlapping text layers are flattened into sequential document flow; no exact page or stamp positions are claimed.
- **Word Line Spacing**: LaTeX manages paragraph line spacing and inter-element flow; Word line spacing metrics are not replicated.
- **Images Inside Text Boxes**: Raster graphics or shapes nested inside drawing text boxes may be decoupled or skipped.
- **Graphical Stamps & Signatures**: Scanned signature images, vector shapes, or rubber stamps.
- **Word Headers & Footers**: Header and footer XML parts are not merged into the LaTeX body.


## Prerequisites

- **Node.js** ≥ 18
- **npm** (comes with Node.js)
- **Google Chrome** or **Microsoft Edge**

## Setup & Build

```bash
# 1. Install dependencies
npm install

# 2. Build the extension (required before running tests)
npm run build
```

This compiles TypeScript, bundles all code and WASI shims with `esbuild`, and copies `pandoc.wasm`, icons, and static assets into the `dist/` directory.

> **Note**: `npm run build` must run before `npm test` in a fresh clone because browser scenario tests load the built extension from `dist/`.


## Load in Microsoft Edge or Chrome (Unpacked Extension)

1. Open Microsoft Edge (`edge://extensions`) or Google Chrome (`chrome://extensions`).
2. Enable **Developer mode** (toggle in the left or top-right menu).
3. Click **Load unpacked**.
4. Select the `dist/` folder inside this project.
5. Pin "Word to LaTeX (Offline)" to your browser toolbar and click it to open the popup.

## Usage

1. Open the popup by clicking the extension icon.
2. Choose your input mode:
   - **Upload File**: Select a `.docx` file and click **Convert to LaTeX**.
   - **Paste Content**: Paste rich text, a table, or type into the box, then click **Convert Pasted Content**.
3. The converted LaTeX will appear in the output textarea and automatically copy to your clipboard.
4. Paste directly into your LaTeX document!

## Publishing to Microsoft Edge Add-ons & Chrome Web Store

Everything needed for store submission is prepared and automated:

- **Complete Store Listing Metadata**: See [`STORE.md`](STORE.md) for full descriptions, feature bullets, search keywords, single-purpose statement, and certification notes for store reviewers.
- **Icon Generation**: Run `node scripts/generate-icons.mjs` to rebuild icons at `16x16`, `32x32`, `48x48`, `128x128` (solid-background variant for store compatibility), and `300x300` (Edge Add-ons listing logo) from the master vector [`assets/logo.svg`](assets/logo.svg).
- **Screenshots**: Live 1280x800 browser screenshots captured using Chromium automation are located in [`assets/screenshots/`](assets/screenshots/). Re-run `node scripts/capture-screenshots.mjs` to regenerate.
- **Promotional Tiles**: High-resolution store featuring tiles are located in [`assets/promo/`](assets/promo/) (`440x280` small tile and `1400x560` large tile). Re-run `node scripts/generate-promos.mjs` to regenerate.
- **Landing Page & Privacy Policy**:
  - Landing page: [`landing-page.html`](landing-page.html) (responsive, light/dark mode aware, shows live screenshots and feature overview).
  - Privacy policy: [`privacy-policy.html`](privacy-policy.html) (details zero data collection, offline WASM architecture, and ephemeral memory model).
- **Packaging Zip**:
  ```bash
  npm run package
  ```
  Creates `word-to-latex-offline.zip` in the root folder, ready to upload to the Microsoft Edge Partner Center or Chrome Web Store Developer Dashboard.

## Running Tests

```bash
# 1. Run unit and browser scenario tests (100% offline)
npm test

# 2. Run real LaTeX compilation test suite (validates 100% compilation against local Tectonic engine)
# Setup pinned v0.17.0 Tectonic binary (dev-only tool, uses network once to download into .bin/):
npm run setup:tectonic

# Execute compile tests:
npm run test:compile
```


## Project Structure

```
word-to-latex-extension/
├── assets/
│   ├── logo.svg            # Master vector logo
│   ├── icons/              # 16, 32, 48, 128 (solid), 300 (solid) PNG icons
│   ├── screenshots/        # 1280x800 real browser UI screenshots
│   └── promo/              # 440x280 & 920x680 Edge Store promotional tiles
├── src/
│   ├── popup.html          # Extension popup UI (tabs, file input, contenteditable)
│   ├── popup.css           # Popup styling
│   ├── popup.ts            # UI controller, tab switching & clipboard handlers
│   ├── pandocCore.ts       # Pure Pandoc conversion logic & format branching
│   ├── pandocWasm.ts       # Pandoc WASM initializer & runtime loader
│   ├── cleanup.ts          # Pure-function LaTeX post-processing pipeline
│   ├── clipboardDetect.ts  # Clipboard data inspection (HTML vs Markdown)
│   └── manifest.json       # Manifest V3 configuration with icons & wasm CSP
├── scripts/
│   ├── generate-icons.mjs      # Vector-to-raster icon exporter
│   ├── generate-promos.mjs     # Promotional tile generator
│   └── capture-screenshots.mjs # Playwright browser screenshot automation
├── tests/
│   ├── cleanup.test.ts         # Unit tests for LaTeX cleanup routines
│   ├── clipboardDetect.test.ts # Unit tests for clipboard format detection
│   └── pandocWasm.test.ts      # Unit tests for convertToLatex branching
├── dist/                   # Built extension directory (load this in browser)
├── landing-page.html       # Self-contained marketing landing page
├── privacy-policy.html     # Static privacy policy
├── STORE.md                # Edge Add-ons Partner Center submission copy & checklist
├── esbuild.config.mjs      # Bundling script & asset copying
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
