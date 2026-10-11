# Changelog

All notable changes to the Word to LaTeX (Offline) browser extension are documented in this file.

## [1.0.4] - 2026-10-11

### Fixed
- Improved OCR table recognition via multi-PSM retry (running both PSM 3 and PSM 4 on 1.5x scaled, cropped, and padded images, picking best by higher confidence and length criteria).
- Preserved tabular data rows (e.g. `label | range`) as unwrapped plain text lines instead of erroneously wrapping in LaTeX display math `\[ ... \]`.
- Added honest quality warnings when numbers are present with confidence < 85% ("Numbers may be misread...") and capped quality accordingly.
- Added warning indicating table borders and column alignments are not reconstructed.

## [1.0.3] - 2026-10-11

### Fixed
- Tightened OCR retry rule to reject retries whose recognized text is shorter than first pass by more than 30% (character count).
- Decoupled Sharp image preprocessing into a Node-only helper so that Sharp is zero-referenced in the client browser extension bundle.
- Enhanced currency dollar sign escaping in natural language text (`$300` -> `\$300`) while preserving balanced inline math pairs (`$x$`) and preventing double-escaping (`\$`).
- Added browser canvas retry test on synthetic reference table in unpacked extension verification.
- Added test coverage for dollar escaping, blank image handling, and retry character length thresholds.

## [1.0.2] - 2026-10-11

### Fixed
- Fixed OCR recognition failures on bordered 2-column tables with wide white margins (e.g. medical reference tables) by adding automatic retry with auto PSM (3) on content-cropped, padded images when initial confidence is < 60% or recognized text is empty.
- Added informative diagnostic warning and output message when no text is recognized ("No text recognized: crop to the content, enlarge the image, and avoid screenshots with large empty margins") instead of an empty result with only a header.
- Added synthetic reference table test and retry logic unit test suite with stub recognition engine.

## [1.0.1] - 2026-10-11

### Fixed
- Fixed LaTeX compilation error on older LaTeX engines (TeX Live, MiKTeX, TeXnicCenter) for unnumbered tables by defining `\newcounter{none}` in Complete Document preambles when `\LTcaptype`, `\begin{longtable}`, or `\real{` is present.
- Added `\usepackage{calc}` and ensuring `longtable`, `booktabs`, `array` are loaded for longtables with column width specifications.
- Added preamble package and unnumbered longtable notes to Fragment mode comment header (`% For unnumbered longtables: \newcounter{none}`).

## [1.0.0] - 2026-10-10

### Added

#### DOCX Conversion
- Local .docx conversion using Pandoc WebAssembly without remote network requests.
- Extraction of headings, bold/italic text, bulleted/numbered lists, and tables with nested paragraphs.
- Document preprocessing for layout fidelity:
  - Paragraph alignment preservation: centered (`\begin{center}`) and right-aligned (`\begin{flushright}`) paragraphs.
  - Page break preservation: honors hard page breaks (`w:br type="page"`), `pageBreakBefore`, section breaks, and approximate page breaks from Word's saved layout metadata (`lastRenderedPageBreak`).
  - Approximate page breaks UI toggle (default ON when markers are present, with review notice in stats banner).
  - Floating text box extraction: de-duplicates `mc:AlternateContent`, inserts text box content at anchor point in reading order, wraps in minipage sized proportionally from anchor extent (`0.25\linewidth` to `0.90\linewidth`), and applies horizontal alignment.
  - Page geometry extraction: reads `pgSz` and `pgMar` in Complete Document mode to emit matching `\usepackage[...]{geometry}` options.
  - Invariance: documents without layout markers pass through byte-identical.

#### Paste Mode
- Rich text and formatted table conversion from clipboard HTML data.
- Fallback to Markdown and plain text conversion when HTML clipboard data is absent.
- Table conversion using `booktabs` and `longtable` environments.

#### Image to LaTeX (Experimental)
- Client-side OCR using Tesseract.js with bundled offline trained data (`eng`, `fra`, `equ`).
- Line-by-line classification into natural language prose and display math equations.
- Recognition of single-line equations, Greek letters, basic arithmetic operators, and French accents (`é`, `è`, `à`, `ç`, `œ`, `ù`).
- Unicode superscript/subscript mapping and simple fraction parsing.
- Definite integral reconstruction for narrow stacked 3-line layouts with bounding-box geometry validation and terminal standalone differential (`dx`, `dy`, etc.).
- Piecewise condition spacing formatting (`\;\text{if}\;`, `\;\text{for}\;`).
- Low-confidence and unrecognized character flagging (`?` with diagnostic `% [Warning]` comments).
- Benchmarked on an 80-sample evaluation corpus (33 dev, 23 holdout, 24 stress): median Character Error Rate 19.2% (mean 30.4%), LaTeX token F1 46.0%, document compile rate 97.5%.

#### Output Modes & Post-Processing
- Two output formats: Fragment (paste-ready snippet) and Complete Document (compilable LaTeX document with preambles).
- Post-processing cleanup pipeline: removes bare `\tightlist`, unwraps `\pandocbounded{}`, collapses extra blank lines, and prepends `% \usepackage{...}` comments for detected packages (`booktabs`, `longtable`, `graphicx`, `hyperref`, `amsmath`).
- Unwrapping of bidirectional text macros (`\RL{...}`, `\LR{...}`) with review notice when RTL content is present.
- Dynamic conversion statistics and review warning banner.
- One-click clipboard copy and `.tex` file download.

### Known Limitations
- Exact 2D spatial positioning, overlapping shapes, and Word desktop canvas coordinates are flattened into linear document flow.
- Images nested inside drawing text boxes or complex DrawingML shapes may be skipped.
- Graphical stamps, drawn shapes, and handwritten signature images are not converted.
- Word line spacing metrics and paragraph inter-spacing are not replicated; LaTeX line breaking rules apply.
- Legacy Word binary format (`.doc`) is not supported; OpenXML (`.docx`) only.
- Image OCR is experimental and requires manual inspection and editing:
  - Square roots (`√`) are frequently recognized as the letter `V`.
  - Matrix grid reconstruction from raw images without clear bracket boundaries is unreliable.
  - Vertical summation limits (`\sum`) are often transcribed as inline text.
  - Systems of equations require explicit brace characters or piecewise keywords (`if`, `otherwise`) for reconstruction.
  - Handwritten notes, blackboard images, and degraded scans are outside supported scope.
