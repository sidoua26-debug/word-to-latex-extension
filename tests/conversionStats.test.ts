import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  countWords,
  countTables,
  countEquations,
  countImages,
  formatStats,
  analyzeDocxConversion,
  analyzePasteConversion,
  analyzeImageConversion,
  hasComplexTableStructure,
} from '../src/conversionStats.ts';
import type { RecognitionResult } from '../src/imageOcr/types.ts';

describe('conversionStats: countWords', () => {
  it('counts words from plain text accurately', () => {
    assert.equal(countWords(''), 0);
    assert.equal(countWords('   '), 0);
    assert.equal(countWords('Hello world'), 2);
    assert.equal(countWords('This is a four word sentence.'), 6);
  });

  it('counts words from French text with accents', () => {
    const french = "Bonjour le monde ! Voici l'œuvre de l'élève étudiant.";
    assert.equal(countWords(french), 8);
  });

  it('strips HTML tags and counts human words', () => {
    const html = '<p>This is <strong>bold</strong> and <em>italic</em> text in a <a href="#">link</a>.</p>';
    assert.equal(countWords(html), 9);
  });

  it('strips LaTeX environments, macros, and comments to count content words without packages', () => {
    const latex = [
      '% Required packages (add to your preamble):',
      '% \\usepackage{amsmath}',
      '% \\usepackage{booktabs}',
      '% \\usepackage{longtable}',
      '\\documentclass[11pt]{article}',
      '\\usepackage{amsmath}',
      '\\begin{document}',
      '\\section{Introduction}',
      'This is the \\textbf{first paragraph} with \\emph{important} points.',
      '\\begin{longtable}[]{@>{\\raggedright\\arraybackslash}p{(\\linewidth - 2\\tabcolsep) * \\real{0.5000}}@}',
      '\\toprule\\noalign',
      'Header A & Header B \\\\',
      '\\midrule',
      'Row 1 & Value 1 \\\\',
      '\\bottomrule',
      '\\end{longtable}',
      '\\end{document}',
    ].join('\n');

    // Expected words: "Introduction This is the first paragraph with important points Header A Header B Row 1 Value 1" = 17 words
    // None of booktabs, longtable, raggedright, arraybackslash, linewidth, tabcolsep, real, toprule, etc. should be counted.
    assert.equal(countWords(latex), 17);
  });
});

describe('conversionStats: countTables', () => {
  it('counts LaTeX longtable and tabular environments', () => {
    const latex = [
      '\\begin{longtable}[]{ll}',
      'A & B \\\\',
      '\\end{longtable}',
      'Some text',
      '\\begin{tabular}{cc}',
      '1 & 2 \\\\',
      '\\end{tabular}',
    ].join('\n');

    assert.equal(countTables(latex), 2);
  });

  it('returns 0 when no tables exist', () => {
    assert.equal(countTables('Just plain text with no tables.'), 0);
  });

  it('detects HTML table tags if provided', () => {
    const html = '<table><tr><td>A</td></tr></table><table><tr><td>B</td></tr></table>';
    assert.equal(countTables('', html), 2);
  });
});

describe('conversionStats: countEquations (display blocks only)', () => {
  it('counts display bracket equation as 1 equation', () => {
    const latex = '\\[ x^2 + y^2 = z^2 \\]';
    assert.equal(countEquations(latex), 1);
  });

  it('counts align* environment as 1 equation', () => {
    const latex = [
      '\\begin{align*}',
      'a &= b + c \\\\',
      'd &= e + f',
      '\\end{align*}',
    ].join('\n');
    assert.equal(countEquations(latex), 1);
  });

  it('does NOT count inline math expressions as equations', () => {
    const latex = 'This is $x^2$ and this is $y^2$ and \\(z^2\\).';
    assert.equal(countEquations(latex), 0);
  });

  it('correctly counts only display blocks in mixed inline and display math', () => {
    const latex = [
      'Here $a=1$ and $b=2$, so we have:',
      '\\[ a + b = 3 \\]',
      'And where $c=4$, we also have:',
      '\\begin{equation}',
      'c^2 = 16',
      '\\end{equation}',
    ].join('\n');

    assert.equal(countEquations(latex), 2);
  });
});

describe('conversionStats: countImages', () => {
  it('counts LaTeX includegraphics commands', () => {
    const latex = '\\includegraphics[width=0.8\\linewidth]{fig1.png}\n\\includegraphics{fig2.jpg}';
    assert.equal(countImages(latex), 2);
  });

  it('returns 0 when no images exist', () => {
    assert.equal(countImages('No images here.'), 0);
  });
});

describe('conversionStats: formatStats', () => {
  it('formats multiple metrics with bullets and proper pluralization', () => {
    const formatted = formatStats({
      words: 1248,
      tables: 3,
      equations: 2,
    });
    assert.equal(formatted, '1,248 words · 3 tables · 2 equations');
  });

  it('omits metrics with count 0 or undefined (no invented precision)', () => {
    const formatted = formatStats({
      words: 45,
      tables: 1,
    });
    assert.equal(formatted, '45 words · 1 table');
    assert.ok(!formatted.includes('0 equation'));
    assert.ok(!formatted.includes('0 image'));
  });

  it('returns empty string if all stats are empty or 0', () => {
    assert.equal(formatStats({}), '');
    assert.equal(formatStats({ words: 0, tables: 0 }), '');
  });
});

describe('conversionStats: table warning heuristics', () => {
  it('does NOT produce table warning for normal documents with blank lines', () => {
    const latex = [
      '\\section{Normal Document}',
      '',
      'First paragraph here.',
      '',
      'Second paragraph after blank lines.',
      '',
      '\\begin{tabular}{cc}',
      'A & B \\\\',
      '1 & 2 \\\\',
      '\\end{tabular}',
      '',
      'Third paragraph.',
    ].join('\n');

    assert.equal(hasComplexTableStructure(latex), false);
    const meta = analyzeDocxConversion(latex, latex);
    assert.equal(meta.warnings.length, 0);
  });

  it('produces review warning only when a table actually contains lists or items', () => {
    const latex = [
      '\\begin{longtable}[]{@{}p{0.5\\linewidth}@{}}',
      '\\begin{itemize}',
      '\\item Nested item 1',
      '\\item Nested item 2',
      '\\end{itemize} \\\\',
      '\\end{longtable}',
    ].join('\n');

    assert.equal(hasComplexTableStructure(latex), true);
    const meta = analyzeDocxConversion(latex, latex);
    assert.equal(meta.warnings.length, 1);
    assert.equal(meta.warnings[0].severity, 'review');
    assert.ok(meta.warnings[0].message.includes('nested paragraphs or lists'));
  });
});

describe('conversionStats: analyzePasteConversion', () => {
  it('produces clean metadata for plain text paste with inline math', () => {
    const text = 'Ø Corps : laiton CW617N with $E=mc^2$';
    const meta = analyzePasteConversion('markdown', text, text);

    assert.equal(meta.stats.words, 6);
    assert.equal(meta.stats.equations, undefined); // Inline math is not an equation
    assert.equal(meta.warnings.length, 0);
  });

  it('detects table simplification in complex HTML paste with colspan', () => {
    const html = '<table><tr><td colspan="2">Merged Header</td></tr></table>';
    const latex = '\\begin{tabular}{ll}\nMerged Header \\\\\n\\end{tabular}';
    const meta = analyzePasteConversion('html', html, latex);

    assert.equal(meta.stats.tables, 1);
    assert.equal(meta.warnings.length, 1);
    assert.equal(meta.warnings[0].severity, 'review');
    assert.ok(meta.warnings[0].message.includes('row/column spans'));
  });
});

describe('conversionStats: analyzeImageConversion', () => {
  it('omits redundant 1 image statistic and preserves existing OCR quality warnings', () => {
    const ocrResult: RecognitionResult = {
      engine: 'tesseract-v7',
      rawText: 'x^2 + y^2 = z^2',
      latex: '\\[ x^2 + y^2 = z^2 \\]',
      confidence: 47,
      quality: 'uncertain',
      warnings: [
        {
          message: 'Low OCR recognition confidence (47%). Image may be blurry, low-resolution, or handwritten.',
          suggestion: 'Please verify the output carefully against your original source.',
        },
      ],
      isTable: false,
      hasMath: true,
    };

    const meta = analyzeImageConversion(ocrResult, ocrResult.latex);

    // Image OCR should report words and equations, but omit the redundant "1 image" badge
    assert.equal(meta.stats.images, undefined);
    assert.equal(meta.stats.equations, 1);
    assert.equal(meta.warnings.length, 1);
    assert.equal(meta.warnings[0].severity, 'warning');
    assert.ok(meta.warnings[0].message.includes('Low OCR recognition confidence'));
    assert.ok(!meta.formattedStats.includes('image'));
  });
});

describe('conversionStats: analyzeDocxConversion architecture & regression', () => {
  it('counts French/Unicode prose and ignores conversion-injected packages and macros', () => {
    const rawLatex = [
      '% \\usepackage{amsmath}',
      '% \\usepackage{booktabs}',
      '% \\usepackage{longtable}',
      '% \\usepackage{calc}',
      '% \\usepackage{array}',
      '\\section{Rapport de stage}',
      'Voici l\'analyse complète de l\'élève concernant le théorème où apparaît le paramètre déjà défini.',
    ].join('\n');

    const cleanLatex = rawLatex; // No tables, clean prose with French accents
    const meta = analyzeDocxConversion(rawLatex, cleanLatex);

    // Expected words: "Rapport de stage Voici l'analyse complète de l'élève concernant le théorème où apparaît le paramètre déjà défini" = 17 words
    assert.equal(meta.stats.words, 17);
    assert.equal(meta.stats.tables, undefined);
    assert.equal(meta.stats.equations, undefined);
    assert.equal(meta.warnings.length, 0);
  });

  it('uses sourceText directly when provided in analyzeDocxConversion', () => {
    const rawLatex = '\\section{Hello} \\textbf{World}';
    const cleanLatex = rawLatex;
    const sourceText = 'Hello World from source file';

    const meta = analyzeDocxConversion(rawLatex, cleanLatex, sourceText);
    assert.equal(meta.stats.words, 5);
  });
});
