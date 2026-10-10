# Golden Evaluation Corpus Baseline Report
Generated: 2026-10-09T20:14:10.811Z
Git Commit: `785e200ee2af6ccdea5f921dd92bb8a2419dea8b` (dirty: true) | Node: `v24.20.0` | Tesseract.js: `^7.0.0`

## 1. Executive Summary
| Metric | Overall | Dev | Holdout | Stress | Gates / Target |
|---|---|---|---|---|---|
| **CER (OCR-only Mean)** | 30.45% | 28.92% | 24.62% | 38.12% | Recorded |
| **CER (OCR-only Median)** | 19.23% | 25.00% | 14.81% | 25.00% | Recorded |
| **LaTeX CER (Mean)** | 558.37% | 792.50% | 416.38% | 474.58% | Recorded |
| **LaTeX Token-F1** | 46.04% | 36.62% | 48.80% | 52.54% | Recorded |
| **Line Misclassification** | 32.12% | — | — | — | Recorded |
| **Hallucinations (Supported)** | 1 | 1 | 0 | 0 | **0 strictly** |
| **Hallucinations (Limitations)** | 0 | 0 | 0 | 0 | **0 strictly** |
| **Contains Assertions** | 54.3% | 52.5% | 48.0% | 68.8% | Recorded |
| **Forbids Assertions** | 100.0% | 100.0% | 100.0% | 100.0% | **100% strictly** |
| **Fragment Compile** | 97.5% | 100.0% | 100.0% | 91.7% | **100% strictly** |
| **Document Compile** | 97.5% | 100.0% | 100.0% | 91.7% | **100% strictly** |
| **Cold-Start OCR Time** | 3082 ms | — | — | — | Recorded |
| **Warm Median Runtime** | 100 ms | 87 ms | 100 ms | 112 ms | Recorded |

## 2. Structure Precision and Recall
| Structure | Precision | Recall | F1 Score | TP | FP | FN |
|---|---|---|---|---|---|---|
| **superscript** | 100.0% | 22.9% | 37.2% | 8 | 0 | 27 |
| **subscript** | 100.0% | 40.0% | 57.1% | 2 | 0 | 3 |
| **fraction** | 100.0% | 25.0% | 40.0% | 2 | 0 | 6 |
| **matrix** | 100.0% | 0.0% | 0.0% | 0 | 0 | 7 |
| **cases** | 80.0% | 100.0% | 88.9% | 4 | 1 | 0 |
| **table** | 100.0% | 12.5% | 22.2% | 1 | 0 | 7 |
| **radical** | 100.0% | 0.0% | 0.0% | 0 | 0 | 5 |

**Matrix Recall**: 0.0% (0/7 correct)

## 3. Slice Breakdown (Language & Degradations)
| Slice | Count | OCR CER (Mean) | LaTeX CER (Mean) | Frag Compile | Doc Compile | Hallucinations |
|---|---|---|---|---|---|---|
| **English (en)** | 63 | 36.13% | 558.37% | 96.8% | 96.8% | 1 |
| **French (fr)** | 17 | 9.40% | N/A | 100.0% | 100.0% | 0 |
| `accents` | 3 | 2.80% | N/A | 100.0% | 100.0% | 0 |
| `action-verb` | 3 | 0.74% | N/A | 100.0% | 100.0% | 0 |
| `algebra` | 3 | 15.10% | 342.26% | 100.0% | 100.0% | 1 |
| `baseline-preservation` | 2 | 0.00% | N/A | 100.0% | 100.0% | 0 |
| `booktabs` | 1 | 0.00% | N/A | 100.0% | 100.0% | 0 |
| `calculus` | 3 | 56.79% | 1570.54% | 100.0% | 100.0% | 0 |
| `cases` | 4 | 39.04% | 150.80% | 100.0% | 100.0% | 0 |
| `chemistry` | 2 | 37.27% | N/A | 100.0% | 100.0% | 0 |
| `complex` | 1 | 40.00% | 40.00% | 100.0% | 100.0% | 0 |
| `currency` | 1 | 80.00% | N/A | 100.0% | 100.0% | 0 |
| `degradation:blur` | 1 | 14.81% | 14.81% | 100.0% | 100.0% | 0 |
| `degradation:blur_2` | 4 | 28.31% | 246.19% | 75.0% | 75.0% | 0 |
| `degradation:clean` | 11 | 29.23% | 687.73% | 100.0% | 100.0% | 0 |
| `degradation:combined_noise_contrast` | 1 | 162.96% | 1966.67% | 100.0% | 100.0% | 0 |
| `degradation:combined_rot_blur` | 1 | 18.52% | 774.07% | 100.0% | 100.0% | 0 |
| `degradation:contrast_squeezed` | 2 | 48.66% | 14.81% | 100.0% | 100.0% | 0 |
| `degradation:downscale_45` | 1 | 14.81% | 14.81% | 100.0% | 100.0% | 0 |
| `degradation:extreme` | 1 | 44.44% | 1866.67% | 100.0% | 100.0% | 0 |
| `degradation:low-contrast` | 1 | 14.81% | 14.81% | 100.0% | 100.0% | 0 |
| `degradation:low-dpi` | 1 | 18.52% | 877.78% | 100.0% | 100.0% | 0 |
| `degradation:noise` | 1 | 14.81% | 14.81% | 100.0% | 100.0% | 0 |
| `degradation:noise_heavy` | 3 | 25.45% | 366.50% | 100.0% | 100.0% | 0 |
| `degradation:rotation` | 2 | 14.25% | 28.41% | 100.0% | 100.0% | 0 |
| `degradation:rotation_4` | 6 | 33.50% | 43.78% | 83.3% | 83.3% | 0 |
| `degradation:rotation_5` | 2 | 44.96% | 884.68% | 100.0% | 100.0% | 0 |
| `degradation:vignette` | 3 | 32.11% | 14.81% | 100.0% | 100.0% | 0 |
| `dev` | 18 | 18.75% | 186.34% | 100.0% | 100.0% | 0 |
| `distinct-source` | 6 | 25.56% | 253.50% | 100.0% | 100.0% | 0 |
| `euler` | 1 | 58.33% | 2031.25% | 100.0% | 100.0% | 0 |
| `fraction` | 4 | 43.38% | 466.82% | 100.0% | 100.0% | 0 |
| `french` | 16 | 5.32% | N/A | 100.0% | 100.0% | 0 |
| `geometry` | 1 | 73.33% | 3140.00% | 100.0% | 100.0% | 0 |
| `holdout` | 23 | 24.62% | 416.38% | 100.0% | 100.0% | 0 |
| `integral` | 1 | 85.71% | 2946.67% | 100.0% | 100.0% | 0 |
| `limitation` | 4 | 65.85% | 2306.03% | 100.0% | 100.0% | 0 |
| `math` | 52 | 36.41% | 558.37% | 98.1% | 98.1% | 1 |
| `math-cells` | 1 | 31.52% | N/A | 100.0% | 100.0% | 0 |
| `matrix` | 7 | 47.69% | 338.42% | 85.7% | 85.7% | 0 |
| `mixed-math` | 1 | 10.56% | N/A | 100.0% | 100.0% | 0 |
| `negative-table` | 4 | 9.38% | 36.36% | 100.0% | 100.0% | 0 |
| `physics` | 2 | 13.40% | 844.00% | 100.0% | 100.0% | 0 |
| `polynomial` | 6 | 14.81% | 158.02% | 100.0% | 100.0% | 0 |
| `prose` | 15 | 1.96% | N/A | 100.0% | 100.0% | 0 |
| `pythagoras` | 1 | 73.33% | 3140.00% | 100.0% | 100.0% | 0 |
| `radical` | 3 | 39.74% | 869.05% | 100.0% | 100.0% | 0 |
| `seed` | 15 | 41.12% | 1216.82% | 100.0% | 100.0% | 1 |
| `stress` | 24 | 38.12% | 474.58% | 91.7% | 91.7% | 0 |
| `subscript` | 1 | 33.33% | 20.00% | 100.0% | 100.0% | 0 |
| `summation` | 2 | 49.18% | 1090.25% | 100.0% | 100.0% | 0 |
| `superscript` | 1 | 31.25% | 33.33% | 100.0% | 100.0% | 0 |
| `symbols` | 1 | 2.70% | N/A | 100.0% | 100.0% | 0 |
| `system` | 1 | 60.00% | 564.00% | 100.0% | 100.0% | 0 |
| `table` | 8 | 60.72% | N/A | 87.5% | 87.5% | 0 |
| `trigonometry` | 2 | 26.09% | 114.29% | 100.0% | 100.0% | 0 |
| `typography` | 1 | 0.00% | N/A | 100.0% | 100.0% | 0 |

## 4. Line Classification Confusion Matrix
| Actual \ Pred | prose | math | table | matrix | cases |
|---|---|---|---|---|---|
| **prose** | 35 | 1 | 0 | 0 | 0 |
| **math** | 12 | 47 | 0 | 0 | 2 |
| **table** | 19 | 2 | 3 | 0 | 0 |
| **matrix** | 1 | 7 | 0 | 0 | 0 |
| **cases** | 0 | 0 | 0 | 0 | 8 |

**Total Lines Evaluated**: 137, **Correct**: 93 (67.88%)

## 5. Worst Samples by Set
### Dev Set Worst Samples
| ID | Status | OCR CER | LaTeX CER | Runtime | Raw OCR Preview | Missing Contains |
|---|---|---|---|---|---|---|
| `seed_case_04_integral` | known_limitation | 85.7% | 2946.7% | 41ms | 1 [ x?dx 0  | none |
| `synth_dev_table_currency` | supported | 80.0% | N/A | 79ms | [item \| @ty \| cost  | \begin{tabular}, Monitor, \$300, \$150 |
| `seed_case_05_summation` | known_limitation | 76.9% | 1464.3% | 44ms | n > i=1  | none |
| `seed_case_01_pythagoras` | supported | 73.3% | 3140.0% | 56ms | ety? = 2?  | x^{2}, y^{2}, z^{2} |
| `seed_case_03_sqrt` | known_limitation | 69.2% | 2507.1% | 42ms | Vzæx? +1  | none |

### Holdout Set Worst Samples
| ID | Status | OCR CER | LaTeX CER | Runtime | Raw OCR Preview | Missing Contains |
|---|---|---|---|---|---|---|
| `synth_hold_table_elements` | supported | 74.6% | N/A | 159ms | Hydrogene CRE 1.008  | \begin{tabular}, Helium |
| `synth_hold_table_data` | supported | 72.2% | N/A | 85ms | [Name \| Age \| score  | \begin{tabular}, Alice, Bob |
| `synth_hold_euler_identity` | supported | 58.3% | 2031.3% | 40ms | e™+1=0  | e^{i, + 1 = 0 |
| `synth_hold_gaussian_integral` | supported | 43.8% | 706.9% | 61ms | Jex*2 dx = vn  | \int, e^{-x^{2}} |
| `synth_hold_fraction_division` | supported | 40.0% | 806.1% | 119ms | (at+b)/(c+d)=x/y  | \frac{a + b}{c + d} |

### Stress Set Worst Samples
| ID | Status | OCR CER | LaTeX CER | Runtime | Raw OCR Preview | Missing Contains |
|---|---|---|---|---|---|---|
| `synth_stress_poly_combined_noise_contrast` | supported | 163.0% | 1966.7% | 879ms | DS EG renee CG a nn  . P(x) ee oe 2ae 7 I EN i ae Ns ea  | none |
| `synth_stress_table_contrast` | supported | 82.5% | N/A | 80ms | [item \| \| cost  | Monitor |
| `synth_stress_table_vignette` | supported | 80.0% | N/A | 77ms | “item \| @ty \| cost  | Monitor |
| `synth_stress_table_rot4` | supported | 65.0% | N/A | 112ms | \| Monitor \| 2 \| $300  | Desk |
| `synth_stress_fraction_rot5` | supported | 64.0% | 987.9% | 154ms | B+b/(c+d ex,  | a + b |

## 7. Complete Corpus Inventory
| ID | Set | Lang | Tags | Status | OCR CER | LaTeX CER | Frag | Doc |
|---|---|---|---|---|---|---|---|---|
| `seed_french_sample` | dev | fr | seed, french, accents, prose | supported | 3.1% | — | ✓ | ✓ |
| `seed_math_equation` | dev | en | seed, math, algebra | supported | 25.0% | 950.0% | ✓ | ✓ |
| `seed_math_fraction` | dev | en | seed, math, fraction | supported | 5.9% | 0.0% | ✓ | ✓ |
| `seed_math_matrix` | dev | en | seed, math, matrix | supported | 40.0% | 90.9% | ✓ | ✓ |
| `seed_table_sample` | dev | en | seed, table, booktabs | supported | 0.0% | — | ✓ | ✓ |
| `seed_case_01_pythagoras` | dev | en | seed, math, pythagoras, geometry | supported | 73.3% | 3140.0% | ✓ | ✓ |
| `seed_case_02_fraction` | dev | en | seed, math, fraction | supported | 63.6% | 73.3% | ✓ | ✓ |
| `seed_case_03_sqrt` | dev | en | seed, math, radical, limitation | known_limitation | 69.2% | 2507.1% | ✓ | ✓ |
| `seed_case_04_integral` | dev | en | seed, math, calculus, integral, limitation | known_limitation | 85.7% | 2946.7% | ✓ | ✓ |
| `seed_case_05_summation` | dev | en | seed, math, summation, limitation | known_limitation | 76.9% | 1464.3% | ✓ | ✓ |
| `seed_case_06_matrix` | dev | en | seed, math, matrix | supported | 66.7% | 431.8% | ✓ | ✓ |
| `seed_case_07_system` | dev | en | seed, math, cases, system | supported | 60.0% | 564.0% | ✓ | ✓ |
| `seed_case_08_french_math` | dev | fr | seed, french, mixed-math, prose | supported | 10.6% | — | ✓ | ✓ |
| `seed_case_09_french_accents` | dev | fr | seed, french, accents, prose | supported | 5.3% | — | ✓ | ✓ |
| `seed_case_10_table_math` | dev | fr | seed, table, math-cells, french, limitation | known_limitation | 31.5% | — | ✓ | ✓ |
| `synth_dev_superscript` | dev | en | dev, math, superscript | supported | 31.3% | 33.3% | ✓ | ✓ |
| `synth_dev_subscript` | dev | en | dev, math, subscript | supported | 33.3% | 20.0% | ✓ | ✓ |
| `synth_dev_baseline_id` | dev | en | dev, prose, baseline-preservation | supported | 0.0% | — | ✓ | ✓ |
| `synth_dev_chemical` | dev | en | dev, prose, chemistry, baseline-preservation | supported | 0.0% | — | ✓ | ✓ |
| `synth_dev_calculus_dx` | dev | en | dev, math, calculus | supported | 40.9% | 1058.1% | ✓ | ✓ |
| `synth_dev_matrix_bracket` | dev | en | dev, math, matrix | supported | 46.2% | 90.9% | ✓ | ✓ |
| `synth_dev_system_cases` | dev | en | dev, math, cases | supported | 38.5% | 15.7% | ✓ | ✓ |
| `synth_dev_sqrt_scoping` | dev | en | dev, math, radical | supported | 25.0% | 50.0% | ✓ | ✓ |
| `synth_dev_french_action_calc` | dev | fr | dev, french, action-verb, prose | supported | 0.0% | — | ✓ | ✓ |
| `synth_dev_french_action_montrer` | dev | fr | dev, french, action-verb, prose | supported | 2.2% | — | ✓ | ✓ |
| `synth_dev_french_action_soit` | dev | fr | dev, french, action-verb, prose | supported | 0.0% | — | ✓ | ✓ |
| `synth_dev_french_accents` | dev | fr | dev, french, accents, prose | supported | 0.0% | — | ✓ | ✓ |
| `synth_dev_diameter_spec` | dev | en | dev, prose, symbols | supported | 2.7% | — | ✓ | ✓ |
| `synth_dev_table_currency` | dev | en | dev, table, currency | supported | 80.0% | — | ✓ | ✓ |
| `synth_dev_prose_uniform_words` | dev | en | dev, prose, negative-table | supported | 0.0% | — | ✓ | ✓ |
| `synth_dev_french_prose_uniform_numbers` | dev | fr | dev, french, negative-table, prose | supported | 1.2% | — | ✓ | ✓ |
| `synth_dev_numbered_list` | dev | en | dev, prose, negative-table | supported | 0.0% | — | ✓ | ✓ |
| `synth_dev_short_expr_no_eq` | dev | en | dev, math, negative-table | supported | 36.4% | 36.4% | ✓ | ✓ |
| `synth_hold_poly_clean` | holdout | en | holdout, math, polynomial, degradation:clean | supported | 14.8% | 14.8% | ✓ | ✓ |
| `synth_hold_poly_rot2` | holdout | en | holdout, math, polynomial, degradation:rotation | supported | 11.1% | 11.1% | ✓ | ✓ |
| `synth_hold_poly_blur` | holdout | en | holdout, math, polynomial, degradation:blur | supported | 14.8% | 14.8% | ✓ | ✓ |
| `synth_hold_poly_noise` | holdout | en | holdout, math, polynomial, degradation:noise | supported | 14.8% | 14.8% | ✓ | ✓ |
| `synth_hold_poly_low_contrast` | holdout | en | holdout, math, polynomial, degradation:low-contrast | supported | 14.8% | 14.8% | ✓ | ✓ |
| `synth_hold_poly_low_dpi` | holdout | en | holdout, math, polynomial, degradation:low-dpi | supported | 18.5% | 877.8% | ✓ | ✓ |
| `synth_hold_trig_identity` | holdout | en | holdout, math, trigonometry, degradation:clean | supported | 34.8% | 182.9% | ✓ | ✓ |
| `synth_hold_trig_rot3` | holdout | en | holdout, math, trigonometry, degradation:rotation | supported | 17.4% | 45.7% | ✓ | ✓ |
| `synth_hold_euler_identity` | holdout | en | holdout, math, euler, degradation:clean | supported | 58.3% | 2031.3% | ✓ | ✓ |
| `synth_hold_fraction_division` | holdout | en | holdout, math, fraction, degradation:clean | supported | 40.0% | 806.1% | ✓ | ✓ |
| `synth_hold_summation_limit` | holdout | en | holdout, math, summation, degradation:clean | supported | 21.4% | 716.2% | ✓ | ✓ |
| `synth_hold_french_paragraph` | holdout | fr | holdout, french, prose, degradation:clean | supported | 1.3% | — | ✓ | ✓ |
| `synth_hold_french_quote` | holdout | fr | holdout, french, typography, degradation:clean | supported | 0.0% | — | ✓ | ✓ |
| `synth_hold_table_data` | holdout | en | holdout, table, degradation:clean | supported | 72.2% | — | ✓ | ✓ |
| `synth_hold_physics_formula` | holdout | en | holdout, math, physics, degradation:clean | supported | 23.8% | 844.0% | ✓ | ✓ |
| `synth_hold_mixed_font_math` | holdout | en | holdout, math, degradation:clean | supported | 14.8% | 866.7% | ✓ | ✓ |
| `synth_hold_complex_equation` | holdout | en | holdout, math, complex, degradation:clean | supported | 40.0% | 40.0% | ✓ | ✓ |
| `synth_hold_gaussian_integral` | holdout | en | holdout, math, calculus, distinct-source | supported | 43.8% | 706.9% | ✓ | ✓ |
| `synth_hold_matrix_rotation` | holdout | en | holdout, math, matrix, distinct-source | supported | 11.8% | 230.3% | ✓ | ✓ |
| `synth_hold_french_cinematics` | holdout | fr | holdout, french, prose, physics, distinct-source | supported | 3.0% | — | ✓ | ✓ |
| `synth_hold_table_elements` | holdout | fr | holdout, table, chemistry, distinct-source | supported | 74.5% | — | ✓ | ✓ |
| `synth_hold_logarithm_identity` | holdout | en | holdout, math, algebra, distinct-source | supported | 13.6% | 24.0% | ✓ | ✓ |
| `synth_hold_quadratic_formula` | holdout | en | holdout, math, algebra, distinct-source | supported | 6.7% | 52.8% | ✓ | ✓ |
| `synth_stress_poly_rot4` | stress | en | stress, math, degradation:rotation_4 | supported | 18.5% | 18.5% | ✓ | ✓ |
| `synth_stress_poly_rot5` | stress | en | stress, math, degradation:rotation_5 | supported | 25.9% | 781.5% | ✓ | ✓ |
| `synth_stress_poly_blur2` | stress | en | stress, math, degradation:blur_2 | supported | 14.8% | 14.8% | ✓ | ✓ |
| `synth_stress_poly_heavy_noise` | stress | en | stress, math, degradation:noise_heavy | supported | 14.8% | 14.8% | ✓ | ✓ |
| `synth_stress_poly_contrast_squeezed` | stress | en | stress, math, degradation:contrast_squeezed | supported | 14.8% | 14.8% | ✓ | ✓ |
| `synth_stress_poly_downscale45` | stress | en | stress, math, degradation:downscale_45 | supported | 14.8% | 14.8% | ✓ | ✓ |
| `synth_stress_poly_vignette` | stress | en | stress, math, degradation:vignette | supported | 14.8% | 14.8% | ✓ | ✓ |
| `synth_stress_poly_combined_rot_blur` | stress | en | stress, math, degradation:combined_rot_blur | supported | 18.5% | 774.1% | ✓ | ✓ |
| `synth_stress_poly_combined_noise_contrast` | stress | en | stress, math, degradation:combined_noise_contrast | supported | 163.0% | 1966.7% | ✓ | ✓ |
| `synth_stress_french_rot4` | stress | fr | stress, french, degradation:rotation_4 | supported | 7.8% | — | ✓ | ✓ |
| `synth_stress_french_blur2` | stress | fr | stress, french, degradation:blur_2 | supported | 17.6% | — | ✓ | ✓ |
| `synth_stress_french_noise` | stress | fr | stress, french, degradation:noise_heavy | supported | 0.0% | — | ✓ | ✓ |
| `synth_stress_french_vignette` | stress | fr | stress, french, degradation:vignette | supported | 1.5% | — | ✓ | ✓ |
| `synth_stress_matrix_rot4` | stress | en | stress, math, matrix, degradation:rotation_4 | supported | 46.2% | 90.9% | ✓ | ✓ |
| `synth_stress_matrix_blur2` | stress | en | stress, math, matrix, degradation:blur_2 | supported | 61.5% | 715.9% | ✗ | ✗ |
| `synth_stress_matrix_noise` | stress | en | stress, math, matrix, degradation:noise_heavy | supported | 61.5% | 718.2% | ✓ | ✓ |
| `synth_stress_table_rot4` | stress | en | stress, table, degradation:rotation_4 | supported | 65.0% | — | ✗ | ✗ |
| `synth_stress_table_contrast` | stress | en | stress, table, degradation:contrast_squeezed | supported | 82.5% | — | ✓ | ✓ |
| `synth_stress_table_vignette` | stress | en | stress, table, degradation:vignette | supported | 80.0% | — | ✓ | ✓ |
| `synth_stress_cases_rot4` | stress | en | stress, math, cases, degradation:rotation_4 | supported | 38.5% | 15.7% | ✓ | ✓ |
| `synth_stress_cases_blur2` | stress | en | stress, math, cases, degradation:blur_2 | supported | 19.2% | 7.8% | ✓ | ✓ |
| `synth_stress_sqrt_rot4` | stress | en | stress, math, radical, degradation:rotation_4 | supported | 25.0% | 50.0% | ✓ | ✓ |
| `synth_stress_fraction_rot5` | stress | en | stress, math, fraction, degradation:rotation_5 | supported | 64.0% | 987.9% | ✓ | ✓ |
| `synth_stress_combined_extreme` | stress | en | stress, math, degradation:extreme | supported | 44.4% | 1866.7% | ✓ | ✓ |
