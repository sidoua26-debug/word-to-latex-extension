# Word to LaTeX Golden Evaluation Corpus

A standardized evaluation benchmark corpus (80 samples: 33 dev, 23 holdout, 24 stress) for validating offline OCR quality, mathematical structure parsing, French typography preservation, tabular grid detection, and LaTeX compilation.

## Directory Structure

- **`seed/`**: 15 baseline images (5 standard fixtures + 10 benchmark cases) covering core math, French accents, fractions, systems, matrices, and tables.
- **`synthetic/`**: Deterministically generated synthetic samples produced by `node corpus/generate.mjs` with seeded visual degradations (rotation, blur, noise, low contrast, downscaling, mixed typography).
- **`real/`**: Empty placeholder directory with privacy guidelines (`corpus/real/README.md`). Run `npm run corpus:add-real` to register local real fixtures without committing them.
- **`manifest.json`**: Ground-truth dataset metadata catalog defining expected text, expected LaTeX, line classification labels, expected/forbidden LaTeX tokens, and split sets.

## Dataset Splits

1. **`dev`** (33 samples): Targeted regression and hardening cases (symbol bounding-box superscripts, baseline preservation for chemical formulas like `H2O` and identifiers like `version2`, radical scoping, French action verbs, and table negative guards).
2. **`holdout`** (23 samples): Unbiased benchmark measurement across 12+ distinct mathematical and prose sources (polynomials, trigonometry, Euler identity, integrals, rotation matrix, French kinematics, chemistry table, logarithm identity, quadratic formula).
3. **`stress`** (24 samples): Severe image degradations (rotation 4–5°, blur 2px, heavy noise, contrast squeezed to [120, 180], downscaling to 45%, vignette lighting gradient, and multi-factor combinations) designed to measure model resilience and degradation response.

> [!IMPORTANT]
> **Evaluation Discipline**: Holdout and stress results must **NEVER** be inspected to adjust parser heuristic code. They serve purely as blind evaluation baselines.

## Determinism & Host Fonts

Synthetic PNG generation uses a seeded Mulberry32 PRNG for all pixel-level noise, contrast, and gradient transformations.
Because font rasterization depends on host font libraries (`DejaVu Sans`, `Liberation Sans`, `Arial`), the committed PNG files in `corpus/` are canonical and CI pipelines must NOT regenerate them on the fly.

## Evaluation & Metrics

Run fast evaluation:
```bash
npm run eval -- --skip-compile
```

Run full evaluation with Tectonic compiler verification and double-run variance:
```bash
npm run eval -- --double-run
```

Filter by split or sample IDs:
```bash
npm run eval -- --set dev
npm run eval -- --ids seed_french_sample,seed_math_equation
```

Compare against baseline:
```bash
npm run eval -- --compare baseline.json
```
