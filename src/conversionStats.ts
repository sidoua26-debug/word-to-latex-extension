/**
 * conversionStats.ts — Reliable, honest conversion statistics and review warnings.
 * Framework-agnostic; no DOM or browser dependencies.
 */

import type { RecognitionResult } from './imageOcr/types.ts';

export interface ConversionStats {
  words?: number;
  tables?: number;
  equations?: number;
  images?: number;
}

export type WarningSeverity = 'info' | 'review' | 'warning';

export interface ConversionWarning {
  severity: WarningSeverity;
  message: string;
  suggestion?: string;
}

export interface ConversionMetadata {
  stats: ConversionStats;
  warnings: ConversionWarning[];
  formattedStats: string;
}

/**
 * Counts words from clean text or source representation.
 * Strips HTML tags, LaTeX environments, preambles, comments, and formatting macros
 * to count only genuine prose words.
 */
export function countWords(text: string): number {
  if (!text) return 0;

  // 1. Strip HTML tags if present
  let clean = text.replace(/<[^>]+>/g, ' ');

  // 2. Strip LaTeX comments (% ...)
  clean = clean.replace(/(^|[^\\])%.*$/gm, '$1');

  // 3. Strip LaTeX document-level declarations (\documentclass, \usepackage)
  clean = clean.replace(/\\(documentclass|usepackage)(\[[^\]]*\])?\{[^}]*\}/g, ' ');

  // 4. Strip graphic commands, URLs, dimensions, and minipage declarations
  clean = clean.replace(/\\(includegraphics|url|href|real|fontsize|vspace|hspace|minipage)(\[[^\]]*\])?\{[^}]*\}/g, ' ');

  // 5. Strip table column format specifications, column specifiers, and environment headers
  clean = clean.replace(/\\begin\{(longtable|tabular|tabularx|tabulary|table|array)\*?\}(\[[^\]]*\])?(\{[^}]*\})?/g, ' ');
  clean = clean.replace(/\\(raggedright|raggedleft|centering|arraybackslash|linewidth|tabcolsep|toprule|midrule|bottomrule|noalign|endhead|endlastfoot)/g, ' ');
  clean = clean.replace(/\\(begin|end|label|ref|pageref|def|LTcaptype)\{[^}]*\}/g, ' ');
  clean = clean.replace(/[@>|][^@>|]*[@>|]/g, ' ');
  clean = clean.replace(/[pmb]\{[^}]*\}/g, ' ');

  // 6. Replace inline formatting macros (\textbf{hello} -> hello, \emph{world} -> world)
  clean = clean.replace(/\\[a-zA-Z@]+(\[[^\]]*\])?(\{([^}]*)\})?/g, (_match, _p1, _p2, p3) => {
    return p3 ? ` ${p3} ` : ' ';
  });

  // 7. Strip leftover LaTeX symbols, alignment ampersands, math delimiters, and braces
  clean = clean.replace(/[\$\{\}\\\&\_]/g, ' ');

  // 8. Tokenize by whitespace and keep tokens containing at least one alphanumeric/letter character
  const tokens = clean.split(/\s+/).filter(t => /[a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]/.test(t));
  return tokens.length;
}

/**
 * Count tables in LaTeX or HTML.
 */
export function countTables(latex: string, html?: string): number {
  if (html) {
    const htmlTableMatches = html.match(/<table\b/gi);
    if (htmlTableMatches && htmlTableMatches.length > 0) {
      return htmlTableMatches.length;
    }
  }

  const matches = latex.match(/\\begin\{(longtable|tabular|table)\*?\}/g);
  return matches ? matches.length : 0;
}

/**
 * Count display mathematical equations or blocks in LaTeX.
 * Only counts display mathematical environments and \[ ... \] blocks.
 * Inline math ($...$, \(...\)) is strictly excluded to avoid overstating equation counts.
 */
export function countEquations(latex: string): number {
  // Count display environments: equation, equation*, align, align*, gather, gather*, multline, multline*, cases, bmatrix, pmatrix, vmatrix
  const displayEnvs = (latex.match(/\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|cases|bmatrix|pmatrix|vmatrix)\}/g) || []).length;
  // Count \[ ... \] display blocks
  const displayBrackets = (latex.match(/\\\[[\s\S]*?\\\]/g) || []).length;

  return displayEnvs + displayBrackets;
}

/**
 * Count images in LaTeX or HTML.
 */
export function countImages(latex: string, html?: string): number {
  if (html) {
    const htmlImgs = (html.match(/<img\b/gi) || []).length;
    if (htmlImgs > 0) return htmlImgs;
  }

  const latexImgs = (latex.match(/\\includegraphics(\[[^\]]*\])?\{[^}]*\}/g) || []).length;
  return latexImgs;
}

/**
 * Checks if any table environment inside the LaTeX content contains complex structures
 * such as nested lists (\item, itemize, enumerate) or minipages.
 */
export function hasComplexTableStructure(latex: string): boolean {
  const tableRegex = /\\begin\{(longtable|tabular|table)\*?\}[\s\S]*?\\end\{\1\*?\}/g;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(latex)) !== null) {
    const tableBody = match[0];
    if (
      tableBody.includes('\\item') ||
      tableBody.includes('\\begin{itemize}') ||
      tableBody.includes('\\begin{enumerate}') ||
      tableBody.includes('\\begin{minipage}') ||
      tableBody.includes('\\multicolumn') ||
      tableBody.includes('\\multirow') ||
      /\bBullet \d+\b/.test(tableBody)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Formats statistics into a compact bulleted line: "1,248 words · 3 tables · 2 equations"
 * Omits any metric with count <= 0 or undefined.
 */
export function formatStats(stats: ConversionStats): string {
  const parts: string[] = [];

  if (stats.words && stats.words > 0) {
    parts.push(`${stats.words.toLocaleString()} ${stats.words === 1 ? 'word' : 'words'}`);
  }

  if (stats.tables && stats.tables > 0) {
    parts.push(`${stats.tables.toLocaleString()} ${stats.tables === 1 ? 'table' : 'tables'}`);
  }

  if (stats.equations && stats.equations > 0) {
    parts.push(`${stats.equations.toLocaleString()} ${stats.equations === 1 ? 'equation' : 'equations'}`);
  }

  if (stats.images && stats.images > 0) {
    parts.push(`${stats.images.toLocaleString()} ${stats.images === 1 ? 'image' : 'images'}`);
  }

  return parts.join(' · ');
}

/**
 * Analyzes DOCX conversion output to compute statistics and review warnings.
 *
 * Word Counting Architecture:
 * - When `sourceText` is provided, words are counted directly from the source prose.
 * - In the standard DOCX WASM pipeline, Pandoc operates directly on binary file bytes
 *   inside WebAssembly and does not emit an intermediate plain text representation.
 *   Therefore, when `sourceText` is omitted, the word count is an honest approximation
 *   derived from `cleanLatex` by stripping all LaTeX commands, preambles, and package names.
 * - It is intentionally not claimed to be a bit-exact Word document count.
 *
 * @param rawLatex — Raw LaTeX emitted by Pandoc
 * @param cleanLatex — Post-processed LaTeX fragment
 * @param sourceText — Optional source text if extracted upstream
 */
export interface DocxAnalysisOptions {
  approximatePageBreaks?: boolean;
  foundApproximateBreaks?: boolean;
}

export function analyzeDocxConversion(
  rawLatex: string,
  cleanLatex: string,
  sourceText?: string,
  options?: DocxAnalysisOptions
): ConversionMetadata {
  const words = sourceText ? countWords(sourceText) : countWords(cleanLatex);
  const tables = countTables(cleanLatex);
  const equations = countEquations(cleanLatex);
  const images = countImages(cleanLatex);

  const stats: ConversionStats = {};
  if (words > 0) stats.words = words;
  if (tables > 0) stats.tables = tables;
  if (equations > 0) stats.equations = equations;
  if (images > 0) stats.images = images;

  const warnings: ConversionWarning[] = [];

  // Check if floating text boxes were moved into flow
  if (cleanLatex.includes('% Text box') || rawLatex.includes('%%LATEX_TEXTBOX_START%%')) {
    warnings.push({
      severity: 'review',
      message: 'Floating text boxes were moved into the flow; check positions.',
      suggestion: 'Verify the vertical alignment and surrounding text flow in your LaTeX editor.',
    });
  }

  // Check if approximate page breaks were actually found and converted
  const hasApproximateBreaks = options?.foundApproximateBreaks !== undefined
    ? options.foundApproximateBreaks
    : (options?.approximatePageBreaks !== false && (rawLatex.includes('LATEX_NEWPAGE') || (rawLatex.includes('LATEX') && rawLatex.includes('NEWPAGE'))));

  if (hasApproximateBreaks) {
    warnings.push({
      severity: 'info',
      message: "Page breaks follow Word's last saved layout; uncheck if the document was edited after saving.",
      suggestion: "Review page breaks against your intended layout or uncheck 'Approximate page breaks' to let LaTeX flow naturally.",
    });
  }

  // Check specifically if any table contains complex nested list structure
  if (hasComplexTableStructure(cleanLatex)) {
    warnings.push({
      severity: 'review',
      message: 'Table containing nested paragraphs or lists was converted using p-columns and unwrapped cell content.',
      suggestion: 'Verify table cell alignments and line breaks in your LaTeX editor.',
    });
  }

  return {
    stats,
    warnings,
    formattedStats: formatStats(stats),
  };
}

/**
 * Analyzes Paste conversion output to compute statistics and review warnings.
 */
export function analyzePasteConversion(
  inputFormat: 'html' | 'markdown',
  inputContent: string,
  cleanLatex: string
): ConversionMetadata {
  const words = countWords(inputContent);
  const tables = countTables(cleanLatex, inputFormat === 'html' ? inputContent : undefined);
  const equations = countEquations(cleanLatex);
  const images = countImages(cleanLatex, inputFormat === 'html' ? inputContent : undefined);

  const stats: ConversionStats = {};
  if (words > 0) stats.words = words;
  if (tables > 0) stats.tables = tables;
  if (equations > 0) stats.equations = equations;
  if (images > 0) stats.images = images;

  const warnings: ConversionWarning[] = [];

  // Check if pasted HTML table was simplified
  if (inputFormat === 'html' && (inputContent.includes('<table') || inputContent.includes('<td'))) {
    if (inputContent.includes('colspan') || inputContent.includes('rowspan')) {
      warnings.push({
        severity: 'review',
        message: 'HTML table with row/column spans was flattened into standard LaTeX table cells.',
        suggestion: 'You may use \\multicolumn or \\multirow if custom spanning is required.',
      });
    }
  }

  return {
    stats,
    warnings,
    formattedStats: formatStats(stats),
  };
}

/**
 * Analyzes Image OCR conversion output to compute statistics and review warnings.
 * Omits redundant "1 image" metric so UI remains clean and focused on recognized content.
 */
export function analyzeImageConversion(
  ocrResult: RecognitionResult,
  cleanLatex: string
): ConversionMetadata {
  const words = countWords(ocrResult.rawText || '');
  const tables = ocrResult.isTable ? 1 : countTables(cleanLatex);
  const equations = ocrResult.hasMath ? (countEquations(cleanLatex) || (ocrResult.latex.includes('\\[') ? 1 : 0)) : countEquations(cleanLatex);

  const stats: ConversionStats = {};
  if (words > 0) stats.words = words;
  if (tables > 0) stats.tables = tables;
  if (equations > 0) stats.equations = equations;

  const warnings: ConversionWarning[] = [];

  // Map existing upstream OCR quality warnings from resultQuality.ts
  if (ocrResult.warnings && ocrResult.warnings.length > 0) {
    for (const w of ocrResult.warnings) {
      let severity: WarningSeverity = 'review';
      if (ocrResult.confidence < 50 || w.message.includes('Low OCR recognition')) {
        severity = 'warning';
      } else if (w.message.includes('Moderate recognition') || w.message.includes('Table structure')) {
        severity = 'info';
      }
      warnings.push({
        severity,
        message: w.message,
        suggestion: w.suggestion,
      });
    }
  } else if (ocrResult.hasMath) {
    warnings.push({
      severity: 'review',
      message: 'Mathematical OCR is experimental; review equations carefully.',
      suggestion: 'Check fractions, exponents, and operator signs against the source image.',
    });
  }

  return {
    stats,
    warnings,
    formattedStats: formatStats(stats),
  };
}
