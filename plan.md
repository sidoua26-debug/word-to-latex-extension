# Plan for Step 6.13

## 1. Trace Impact & Blast Radius (impact-map)
- Files to modify:
  1. src/imageOcr/ocrEngine.ts: PSM 3 & PSM 4 in retry pass, select best by confidence & not shorter by >30%; gate retry logic if needed.
  2. src/imageOcr/imagePreprocessorNode.ts & src/imageOcr/imagePreprocessorBrowser.ts: Tuning if scaling/binarization is chosen.
  3. src/imageOcr/resultQuality.ts: Capping quality at "medium" and adding warning when confidence < 85 with numbers; warning for 3+ consecutive digits next to decimals.
  4. src/imageOcr/mathParser.ts: Prevent wrapping table row patterns in \[ \] math blocks; emit table unconstructed warning.
  5. package.json, src/manifest.json, CHANGELOG.md: Bump to 1.0.4.
  6. Test suites: tests/imageOcr/resultQuality.test.ts, tests/imageOcr/mathParser.test.ts, tests/imageOcr/ocrEngine.test.ts.
- Blast Radius: 7 files + tests, well within Tier 2 limit (3-8 files).

## 2. Experiments
- Item 1: Preprocess local/table_ref.png, run OCR with PSM 3 and PSM 4. Measure confidence and raw text. Evaluate match against 8 exact source rows.
- Item 2: Test scaling (1x, 1.5x, 2x, 3x LANCZOS with crop+pad), PSM 4 and PSM 3, Otsu vs grayscale on real and synthetic images. Tabulate exact-match counts. Pick best setting across both.
- Item 5: Test case_10_table_math.png BEFORE vs AFTER retry against exact tokens. If worse, gate retry to confidence < 40 or empty text. Show effect on all 12 fixtures.

## 3. Implementation
- Implement chosen retry multi-PSM and preprocessing in ocrEngine.ts and preprocessors.
- Implement quality honesty rules in resultQuality.ts.
- Implement table row plain text preservation in mathParser.ts.
- Add tests for all new behaviors.

## 4. Verification & Release
- Verify all unit tests (npm test).
- Typecheck (npx tsc --noEmit).
- Run corpus eval compare against baseline.json.
- Package zip, verify with unzipped checks.
- Commit, clean worktree build, copy to ~/release/word-to-latex-offline-1.0.4.zip.
