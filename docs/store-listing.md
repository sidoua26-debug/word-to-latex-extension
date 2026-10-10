# Word to LaTeX (Offline) — Store Listing & Description

## Short Description (max 100 chars)
Convert Word docs, pasted text, and images to clean LaTeX — 100% offline with zero data collection.

## Detailed Description

**Word to LaTeX (Offline)** converts Microsoft Word (.docx) files, pasted rich text, formatted tables, and typed math images directly into clean, paste-ready LaTeX fragments — entirely client-side inside your browser.

Powered by Pandoc WASM and an offline Tesseract OCR engine with French, English, and math datasets, all conversions run locally on your device. No external APIs, no remote servers, no telemetry, and no account required. Manifest permissions: `[]`.

---

### Features & Supported Formats

1. **Word Document Conversion (.docx)**:
   - Compiles Word files directly into clean LaTeX fragments.
   - Preserves headings, bold, italics, bullet/numbered lists, and tables with nested content.
   - Automatically removes Pandoc `\tightlist` artifacts and unneeded `\pandocbounded{}` wrappers.

2. **Paste Content Mode**:
   - Paste rich text or tables copied from Word, Google Docs, or web pages.
   - Converts HTML tables into clean `booktabs` and `longtable` syntax.

3. **Image to LaTeX (Experimental)**:
   - Built-in offline OCR engine (Tesseract.js with `eng`, `fra`, and `equ` traineddata).
   - Recognizes simple typed equations, Greek letters, basic operators, and French accents.
   - Detects Unicode superscripts/subscripts and simple inline fractions (e.g. `1/2`).
   - Line classification heuristics distinguish prose paragraphs from display math equations.
   - Preserves unreadable glyphs as `?` and prepends diagnostic review headers.

---

### Important Scope & Limitations

The Image to LaTeX feature is designed for basic assistance and is **experimental**. Users must review and edit generated LaTeX before publication or compilation:

- **Supported in Image OCR**:
  - Simple, high-contrast, typed single-line equations.
  - French language text and accented characters (`é`, `è`, `à`, `ç`, `œ`, `ù`).
  - Definite integrals in a narrow stacked 3-line layout (operator bracket/symbol, bounds, integrand with standalone differential `dx`).
- **Limited or Unsupported**:
  - **Radicals / Square roots**: Standard OCR frequently transcribes square root symbols `√` as the letter `V`.
  - **Matrices & Grids**: Image-based matrix grid reconstruction is limited; complex multi-column math grids are not guaranteed.
  - **Summations**: Vertical limits above and below `\sum` are frequently read as inline text.
  - **Systems of Equations**: Only reconstructed if an explicit left brace `{` or piecewise keyword (`if`, `otherwise`) is recognized.
  - **Handwriting & Stylized Math**: Handwritten notes, chalkboard scans, cursive text, or rotated images are not supported.
  - **Unrecognized Glyphs**: Unclear symbols are preserved as `?` with a `% [Warning]` header rather than guessed.

### Corpus Evaluation Transparency
Our golden evaluation corpus consists of 52 synthetic and curated test samples (including dev, holdout, and stress slices). On clean, high-resolution typed equations and French prose, the engine achieves strong baseline character accuracy; however, complex multi-line math and degraded images require manual review.

---

### Privacy & Permissions
- **Permissions**: `[]` (Zero browser permissions requested).
- **Network Access**: 100% offline. Zero external network requests.
