/**
 * cleanup.ts — Multi-stage LaTeX Quality Pipeline for clean, paste-ready fragments.
 * Framework-agnostic; no DOM or browser dependencies.
 *
 * Pipeline Stages:
 * 1. Structural & Artifact Removal (\tightlist, \pandocbounded, \foreignlanguage, redundant empty anchors)
 * 2. Environment Normalization & Table List Minipages (depth-aware wrapping)
 * 3. Typography & Unicode Normalization (French high punctuation, tildes, bullets, NBSP)
 * 4. Safe Brace Cleanup (depth-aware redundant brace unwrapping without damaging macro/math arguments)
 * 5. Whitespace & Blank-line Normalization (verbatim & math protected)
 * 6. Package Detection Comments (\usepackage recommendations)
 * 7. Structural Validation & Fallback Safety Net
 */

/**
 * Finds the index of the matching closing character (e.g. '}' for '{'),
 * taking into account nesting and escaped characters (e.g. '\}').
 * Returns -1 if unbalanced.
 */
export function findBalancedClose(
  str: string,
  openIdx: number,
  openChar = '{',
  closeChar = '}'
): number {
  if (str[openIdx] !== openChar) return -1;

  let depth = 1;
  let i = openIdx + 1;

  while (i < str.length && depth > 0) {
    if (str[i] === '\\') {
      // Skip escaped characters like \{ or \}
      i += 2;
      continue;
    }
    if (str[i] === openChar) {
      depth++;
    } else if (str[i] === closeChar) {
      depth--;
    }
    i++;
  }

  return depth === 0 ? i - 1 : -1;
}

/** Stage 1: Remove lines that are exactly `\tightlist` (with optional surrounding whitespace). */
export function removeTightlist(latex: string): string {
  return latex.replace(/^[ \t]*\\tightlist[ \t]*$/gm, '');
}

/**
 * Stage 1: Unwrap `\pandocbounded{...}` commands, keeping only the inner content.
 * Handles nested braces correctly using depth-aware scanning.
 */
export function unwrapPandocbounded(latex: string): string {
  const marker = '\\pandocbounded{';
  let result = latex;

  while (true) {
    const idx = result.indexOf(marker);
    if (idx === -1) break;

    const openIdx = idx + marker.length - 1;
    const closeIdx = findBalancedClose(result, openIdx);

    if (closeIdx === -1) {
      // Unbalanced braces — bail out safely to avoid corruption
      break;
    }

    const inner = result.substring(openIdx + 1, closeIdx);
    result = result.substring(0, idx) + inner + result.substring(closeIdx + 1);
  }

  return result;
}

/**
 * Stage 1: Unwraps `\foreignlanguage{<lang>}{<content>}` and `\begin{otherlanguage}{<lang>}` wrappers.
 * For paste-ready LaTeX fragments, redundant language annotations clutter output
 * and prevent seamless pasting into standard documents.
 * Uses depth-aware brace scanning for both language and content arguments.
 */
export function unwrapForeignLanguage(latex: string): string {
  let result = latex;
  const marker = '\\foreignlanguage{';

  while (true) {
    const idx = result.indexOf(marker);
    if (idx === -1) break;

    const langOpenIdx = idx + marker.length - 1;
    const langCloseIdx = findBalancedClose(result, langOpenIdx);
    if (langCloseIdx === -1 || result[langCloseIdx + 1] !== '{') {
      break;
    }

    const contentOpenIdx = langCloseIdx + 1;
    const contentCloseIdx = findBalancedClose(result, contentOpenIdx);
    if (contentCloseIdx === -1) {
      break;
    }

    const inner = result.substring(contentOpenIdx + 1, contentCloseIdx);
    result = result.substring(0, idx) + inner + result.substring(contentCloseIdx + 1);
  }

  // Also strip block-level otherlanguage environments
  result = result.replace(/\\begin\{otherlanguage\*?\}\{[^}]*\}\s*/g, '');
  result = result.replace(/\\end\{otherlanguage\*?\}\s*/g, '');

  // Remove bare empty braces {} left between unwrapped commands while preserving @{} and \macro{}
  result = result.replace(/(\\[a-zA-Z*]+|@)\{\}/g, '$1__PROTECTED_EMPTY__');
  result = result.replace(/\{\}/g, '');
  result = result.replace(/__PROTECTED_EMPTY__/g, '{}');

  return result;
}

/**
 * Stage 1: Unwraps Pandoc bidi direction commands `\RL{...}` and `\LR{...}`,
 * keeping only the inner content.
 * Pandoc emits these wrappers when Word runs have `<w:rtl/>` flags,
 * but standard LaTeX preambles do not load bidi packages, causing undefined control sequence errors.
 * Handles nested braces depth-aware via findBalancedClose.
 */
export function unwrapBidiCommands(latex: string): string {
  const markers = ['\\RL{', '\\LR{'];
  let result = latex;

  for (const marker of markers) {
    let startSearch = 0;
    while (true) {
      const idx = result.indexOf(marker, startSearch);
      if (idx === -1) break;

      const openIdx = idx + marker.length - 1;
      const closeIdx = findBalancedClose(result, openIdx);

      if (closeIdx === -1) {
        startSearch = idx + marker.length;
        continue;
      }

      const inner = result.substring(openIdx + 1, closeIdx);
      result = result.substring(0, idx) + inner + result.substring(closeIdx + 1);
      startSearch = idx;
    }
  }

  return result;
}

/**
 * Stage 1: Unwraps layout fidelity markers injected by docxPreprocess:
 * - %%LATEX_CENTER_START%%...%%LATEX_CENTER_END%% -> \begin{center} ... \end{center}
 * - %%LATEX_FLUSHRIGHT_START%%...%%LATEX_FLUSHRIGHT_END%% -> \begin{flushright} ... \end{flushright}
 * - %%LATEX_NEWPAGE%% -> \newpage
 * - %%LATEX_TEXTBOX_START%%...%%LATEX_TEXTBOX_END%% -> % Text box \begin{flushright}\begin{minipage}{0.48\linewidth}\raggedright ... \end{minipage}\end{flushright}
 */
export function unwrapLayoutMarkers(latex: string): string {
  let result = latex;

  // Merge consecutive centered paragraphs into one center environment with \\ line breaks
  result = result.replace(
    /\\?%\\?%LATEX\\?_CENTER\\?_END\\?%\\?%\s*\\?%\\?%LATEX\\?_CENTER\\?_START\\?%\\?%/g,
    '\\\\\n'
  );

  // Center
  result = result.replace(
    /\\?%\\?%LATEX\\?_CENTER\\?_START\\?%\\?%([\s\S]*?)\\?%\\?%LATEX\\?_CENTER\\?_END\\?%\\?%/g,
    (_, content) => {
      let clean = content.trim();
      clean = clean.replace(/^\\\\\s*/, '').replace(/\s*\\\\$/, '');
      if (!clean) return '';
      return `\\begin{center}\n${clean}\n\\end{center}`;
    }
  );

  // Merge consecutive flushright paragraphs if any
  result = result.replace(
    /\\?%\\?%LATEX\\?_FLUSHRIGHT\\?_END\\?%\\?%\s*\\?%\\?%LATEX\\?_FLUSHRIGHT\\?_START\\?%\\?%/g,
    '\\\\\n'
  );

  // Flushright
  result = result.replace(
    /\\?%\\?%LATEX\\?_FLUSHRIGHT\\?_START\\?%\\?%([\s\S]*?)\\?%\\?%LATEX\\?_FLUSHRIGHT\\?_END\\?%\\?%/g,
    (_, content) => {
      let clean = content.trim();
      clean = clean.replace(/^\\\\\s*/, '').replace(/\s*\\\\$/, '');
      if (!clean) return '';
      return `\\begin{flushright}\n${clean}\n\\end{flushright}`;
    }
  );

  // Newpage
  result = result.replace(/\\?%\\?%LATEX\\?_NEWPAGE\\?%\\?%/g, '\\newpage\n');

  // Textbox with left, center, right alignment and width
  result = result.replace(
    /\\?%\\?%LATEX\\?_TEXTBOX\\?_LEFT(?:\\?_WIDTH\\?_([0-9.]+))?\\?_START\\?%\\?%([\s\S]*?)\\?%\\?%LATEX\\?_TEXTBOX\\?_END\\?%\\?%/g,
    (_, width, content) => {
      const w = width || '0.48';
      return `\n% Text box\n\\begin{flushleft}\n\\begin{minipage}{${w}\\linewidth}\\raggedright\n${content.trim()}\n\\end{minipage}\n\\end{flushleft}\n`;
    }
  );

  result = result.replace(
    /\\?%\\?%LATEX\\?_TEXTBOX\\?_CENTER(?:\\?_WIDTH\\?_([0-9.]+))?\\?_START\\?%\\?%([\s\S]*?)\\?%\\?%LATEX\\?_TEXTBOX\\?_END\\?%\\?%/g,
    (_, width, content) => {
      const w = width || '0.48';
      return `\n% Text box\n\\begin{center}\n\\begin{minipage}{${w}\\linewidth}\\centering\n${content.trim()}\n\\end{minipage}\n\\end{center}\n`;
    }
  );

  result = result.replace(
    /\\?%\\?%LATEX\\?_TEXTBOX(?:\\?_RIGHT)?(?:\\?_WIDTH\\?_([0-9.]+))?\\?_START\\?%\\?%([\s\S]*?)\\?%\\?%LATEX\\?_TEXTBOX\\?_END\\?%\\?%/g,
    (_, width, content) => {
      const w = width || '0.48';
      return `\n% Text box\n\\begin{flushright}\n\\begin{minipage}{${w}\\linewidth}\\raggedright\n${content.trim()}\n\\end{minipage}\n\\end{flushright}\n`;
    }
  );

  return result;
}

/**
 * Stage 2: Wraps list environments (\begin{itemize} or \begin{enumerate}) located inside table environments
 * (longtable, tabular, tabularx, etc.) in a minipage if they are not already wrapped.
 * Guarantees valid, compilable LaTeX for tables containing lists.
 */
export function fixTableLists(latex: string): string {
  const tableRegex = /(\\begin\{(?:longtable|tabular\*?|tabularx|tabulary)\}[\s\S]*?\\end\{(?:longtable|tabular\*?|tabularx|tabulary)\})/g;

  return latex.replace(tableRegex, (tableBlock) => {
    const tokenRegex = /(\\begin\{(?:minipage|itemize|enumerate)\}|\\end\{(?:minipage|itemize|enumerate)\})/g;

    if (!/\\begin\{(?:itemize|enumerate)\}/.test(tableBlock)) {
      return tableBlock;
    }

    let minipageDepth = 0;
    let listDepth = 0;
    let currentListStart = -1;
    let currentListType = '';
    let result = '';
    let lastIdx = 0;

    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(tableBlock)) !== null) {
      const token = match[1];
      const matchIdx = match.index;

      if (token.startsWith('\\begin{minipage}')) {
        minipageDepth++;
      } else if (token.startsWith('\\end{minipage}')) {
        if (minipageDepth > 0) minipageDepth--;
      } else if (token.startsWith('\\begin{itemize}') || token.startsWith('\\begin{enumerate}')) {
        const type = token.includes('itemize') ? 'itemize' : 'enumerate';
        if (minipageDepth === 0 && listDepth === 0) {
          currentListStart = matchIdx;
          currentListType = type;
        }
        listDepth++;
      } else if (token.startsWith('\\end{itemize}') || token.startsWith('\\end{enumerate}')) {
        const type = token.includes('itemize') ? 'itemize' : 'enumerate';
        if (listDepth > 0) {
          listDepth--;
          if (minipageDepth === 0 && listDepth === 0 && currentListStart !== -1 && currentListType === type) {
            const listEnd = matchIdx + token.length;
            const beforeList = tableBlock.substring(lastIdx, currentListStart);
            const listContent = tableBlock.substring(currentListStart, listEnd);

            result += beforeList;
            result += `\\begin{minipage}[t]{\\linewidth}\\raggedright\n${listContent}\n\\end{minipage}`;
            lastIdx = listEnd;
            currentListStart = -1;
            currentListType = '';
          }
        }
      }
    }

    result += tableBlock.substring(lastIdx);
    return result;
  });
}

/**
 * Stage 3: Cleans unnecessary tildes introduced by Word French typography metadata
 * without affecting standard semantic LaTeX ties like Fig.~1 or math.
 */
export function cleanFrenchPunctuationAndTildes(latex: string): string {
  let result = latex;

  // 1. Unwrap empty/spacing groups containing tildes like {~ } or {~} or { ~ }
  result = result.replace(/\{\s*~+\s*\}/g, ' ');

  // 2. Normalize tildes before French high punctuation marks: ~: -> " :", ~; -> " ;", ~! -> " !", ~? -> " ?"
  result = result.replace(/~([:;!?»])/g, ' $1');
  result = result.replace(/(«)~/g, '$1 ');

  // 3. Normalize tilde followed by whitespace: "~ " -> " "
  result = result.replace(/~[ \t]+/g, ' ');

  // 4. Normalize tildes following bullet symbols or non-ASCII characters at line start
  result = result.replace(/(^[ \t]*[^\w\s\\])[ \t]*~[ \t]*/gmu, '$1  ');

  return result;
}

/**
 * Stage 4: Unwraps redundant grouping braces around plain text and Unicode symbols
 * introduced by Pandoc's span/mso-spacerun mapping (e.g. {{Ø}} or {Ø } -> Ø).
 * Does NOT touch arguments to LaTeX commands (\textbf{...}), math sub/superscripts (^2, _1),
 * or protected macro arguments.
 */
export function unwrapRedundantBraces(latex: string): string {
  let result = latex;

  // Unwrap double braces {{...}} -> {...}
  while (/\{\{([^{}]+)\}\}/.test(result)) {
    result = result.replace(/\{\{([^{}]+)\}\}/g, '{$1}');
  }

  // Unwrap bare braces around content not preceded by a backslash macro, ^, _, or =
  result = result.replace(/(^|[\s\n(])\{([^{}\\]+)\}/gu, '$1$2');
  result = result.replace(/(^|[\s\n(])\{([^{}\\]+)\}/gu, '$1$2');

  return result;
}

/**
 * Stage 5: Normalizes whitespace and blank lines while strictly protecting
 * verbatim environments, code listings, and display math.
 */
export function normalizeWhitespaceProtected(latex: string): string {
  // Identify protected regions: verbatim, lstlisting, equation, align, display math
  const protectedPattern = /(\\begin\{(?:verbatim\*?|lstlisting|minted|equation\*?|align\*?|gather\*?|multline\*?)\}[\s\S]*?\\end\{(?:verbatim\*?|lstlisting|minted|equation\*?|align\*?|gather\*?|multline\*?)\}|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$)/g;

  const segments: string[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = protectedPattern.exec(latex)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    // Normalize unprotected text before this block
    if (start > lastIdx) {
      const unprotected = latex.substring(lastIdx, start);
      segments.push(normalizeStandardWhitespace(unprotected));
    }

    // Keep protected block intact
    segments.push(match[0]);
    lastIdx = end;
  }

  if (lastIdx < latex.length) {
    segments.push(normalizeStandardWhitespace(latex.substring(lastIdx)));
  }

  return segments.join('');
}

function normalizeStandardWhitespace(text: string): string {
  let res = text;
  // Collapse 3+ consecutive blank lines down to 2
  res = res.replace(/([ \t]*\n){3,}/g, '\n\n');
  // Trim trailing whitespace from each line
  res = res.replace(/[ \t]+$/gm, '');
  return res;
}

/** Collapse 3+ consecutive blank lines down to at most 2. */
export function collapseBlankLines(latex: string): string {
  return normalizeStandardWhitespace(latex);
}

/** Trim trailing whitespace from each line. */
export function trimTrailingWhitespace(latex: string): string {
  return latex.replace(/[ \t]+$/gm, '');
}

/** Stage 6: Package detection rules: pattern → package name. */
const PACKAGE_RULES: Array<{ pattern: RegExp; pkg: string }> = [
  { pattern: /\\(toprule|midrule|bottomrule)\b/, pkg: 'booktabs' },
  { pattern: /\\begin\{longtable\}/, pkg: 'longtable' },
  { pattern: /\\begin\{tabularx\}/, pkg: 'tabularx' },
  { pattern: /\\real\{/, pkg: 'calc' },
  { pattern: />\{.*?\\arraybackslash\}|\\arraybackslash\b/, pkg: 'array' },
  { pattern: /\\includegraphics/, pkg: 'graphicx' },
  { pattern: /\\(hyperlink|hyperref|href|url)\b/, pkg: 'hyperref' },
  { pattern: /\\(uline|sout)\b/, pkg: 'ulem' },
  { pattern: /\\begin\{(?:align\*?|gather\*?|pmatrix|bmatrix|cases|matrix)\}|\\text\{/, pkg: 'amsmath' },
  { pattern: /\\(mathbb|mathcal|mathfrak)\b/, pkg: 'amssymb' },
];

/**
 * Scan LaTeX for constructs needing specific packages and prepend a comment block
 * listing the required \usepackage lines.
 */
export function prependPackageComments(latex: string): string {
  const needed = new Set<string>();

  for (const rule of PACKAGE_RULES) {
    if (rule.pattern.test(latex)) {
      needed.add(rule.pkg);
    }
  }

  const notes: string[] = [];
  if (/[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(latex)) {
    notes.push('% Note: Right-to-Left (Arabic/Hebrew) text detected. Standard LaTeX requires a bidi package (e.g. polyglossia or babel) and an RTL font in your preamble.');
  }
  if (latex.includes('% Text box')) {
    notes.push('% Note: Floating text boxes were moved into the flow; check positions.');
  }

  if (needed.size === 0 && notes.length === 0) return latex;

  const sorted = [...needed].sort();
  const lines: string[] = [];
  if (sorted.length > 0) {
    lines.push(
      '% Required packages (add to your preamble):',
      ...sorted.map((pkg) => `% \\usepackage{${pkg}}`)
    );
  }
  if (notes.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(...notes);
  }
  lines.push('', '');

  return lines.join('\n') + latex;
}

/**
 * Stage 7: Lightweight Structural Validation
 * Verifies balanced braces and matched environment blocks to detect any corruption early.
 */
export function validateLatexStructure(latex: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. Check brace balance
  let braceDepth = 0;
  for (let i = 0; i < latex.length; i++) {
    if (latex[i] === '\\') {
      i++; // Skip escaped character like \{ or \}
      continue;
    }
    if (latex[i] === '{') {
      braceDepth++;
    } else if (latex[i] === '}') {
      braceDepth--;
      if (braceDepth < 0) {
        errors.push(`Unmatched closing brace '}' at position ${i}`);
        break;
      }
    }
  }
  if (braceDepth !== 0) {
    errors.push(`Unbalanced braces: final depth was ${braceDepth}`);
  }

  // 2. Check environment matches (\begin{env} ... \end{env})
  const envStack: string[] = [];
  const envTokenRegex = /\\(begin|end)\{([a-zA-Z0-9*_-]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = envTokenRegex.exec(latex)) !== null) {
    const action = match[1];
    const envName = match[2];

    if (action === 'begin') {
      envStack.push(envName);
    } else if (action === 'end') {
      const last = envStack.pop();
      if (last !== envName) {
        errors.push(`Mismatched environment: expected \\end{${last || 'none'}}, found \\end{${envName}}`);
      }
    }
  }

  if (envStack.length > 0) {
    errors.push(`Unclosed environments: ${envStack.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Full cleanup pipeline. Applies all transformations in order with structural validation.
 * @param raw — Raw LaTeX string from Pandoc.
 * @returns Cleaned, paste-ready LaTeX fragment.
 */
export function cleanupLatex(raw: string): string {
  let result = raw;

  // Stage 1: Pandoc artifact removal
  result = removeTightlist(result);
  result = unwrapPandocbounded(result);
  result = unwrapForeignLanguage(result);
  result = unwrapBidiCommands(result);
  result = unwrapLayoutMarkers(result);

  // Stage 2: Typography & French punctuation
  result = cleanFrenchPunctuationAndTildes(result);

  // Stage 3: Safe brace unwrapping
  result = unwrapRedundantBraces(result);

  // Stage 4: Table list minipages
  result = fixTableLists(result);

  // Stage 5: Protected whitespace normalization
  result = normalizeWhitespaceProtected(result);

  // Stage 6: Package detection comments
  result = prependPackageComments(result);

  // Stage 7: Structural validation (safety net)
  const validation = validateLatexStructure(result);
  if (!validation.valid) {
    console.warn('[LaTeX Cleanup Pipeline] Structural validation warning:', validation.errors);
    // If transformed result introduced unclosed environments or broken braces,
    // safely return raw input with basic minimal cleanup to avoid corrupting output
    const fallbackValidation = validateLatexStructure(raw);
    if (fallbackValidation.valid) {
      let safeFallback = removeTightlist(raw);
      safeFallback = trimTrailingWhitespace(safeFallback);
      safeFallback = prependPackageComments(safeFallback);
      return safeFallback;
    }
  }

  return result;
}

/**
 * Detects if a string contains French text (accents, ligatures, guillemets, or French keywords).
 */
export function hasFrenchText(text: string): boolean {
  return /[éèêëàâîïôùûüçœæÉÈÊËÀÂÎÏÔÙÛÜÇŒÆ«»]/u.test(text);
}

/**
 * Strips package comments generated by prependPackageComments from a LaTeX fragment.
 */
export function stripPackageComments(latex: string): string {
  let result = latex.replace(/^% Required packages \(add to your preamble\):\s*\n/gm, '');
  result = result.replace(/^% \\usepackage\{[^}]+\}\s*\n?/gm, '');
  result = result.replace(/^% Note: Right-to-Left[^\n]*\n?/gm, '');
  result = result.replace(/^% Note: Floating text boxes[^\n]*\n?/gm, '');
  return result.replace(/^\n+/, '');
}

export interface WrapCompleteDocumentOptions {
  hasFrench?: boolean;
  geometry?: {
    paperWidthMm?: number;
    paperHeightMm?: number;
    topMm?: number;
    bottomMm?: number;
    leftMm?: number;
    rightMm?: number;
    baseFontSizePt?: number;
  };
}

/**
 * Wraps a LaTeX fragment into a complete, standalone, compilable LaTeX document.
 */
export function wrapCompleteDocument(
  latexFragment: string,
  options?: WrapCompleteDocumentOptions
): string {
  const isFrench = options?.hasFrench ?? hasFrenchText(latexFragment);
  const neededPackages = new Set<string>();
  const geometry = options?.geometry;

  for (const rule of PACKAGE_RULES) {
    if (rule.pattern.test(latexFragment)) {
      neededPackages.add(rule.pkg);
    }
  }

  // Also check if any % \usepackage{...} was already present in the fragment comments
  const commentMatches = latexFragment.match(/^% \\usepackage\{([^}]+)\}/gm);
  if (commentMatches) {
    for (const line of commentMatches) {
      const match = line.match(/^% \\usepackage\{([^}]+)\}/);
      if (match && match[1]) {
        neededPackages.add(match[1]);
      }
    }
  }

  const preamblePackages: string[] = [
    '\\usepackage{iftex}',
    '\\ifPDFTeX',
    '  \\usepackage[utf8]{inputenc}',
    '  \\usepackage[T1]{fontenc}',
    '\\fi',
    isFrench ? '\\usepackage[french,english]{babel}' : '\\usepackage[english]{babel}',
    '\\usepackage{amsmath,amssymb,amsfonts}',
  ];

  if (geometry) {
    const geoOpts: string[] = [];
    if (geometry.paperWidthMm && geometry.paperHeightMm) {
      geoOpts.push(`paperwidth=${geometry.paperWidthMm}mm`);
      geoOpts.push(`paperheight=${geometry.paperHeightMm}mm`);
    }
    if (geometry.topMm !== undefined) geoOpts.push(`top=${geometry.topMm}mm`);
    if (geometry.bottomMm !== undefined) geoOpts.push(`bottom=${geometry.bottomMm}mm`);
    if (geometry.leftMm !== undefined) geoOpts.push(`left=${geometry.leftMm}mm`);
    if (geometry.rightMm !== undefined) geoOpts.push(`right=${geometry.rightMm}mm`);
    if (geoOpts.length > 0) {
      preamblePackages.push(`\\usepackage[${geoOpts.join(',')}]{geometry}`);
    }
  }

  const candidatePackages = ['graphicx', 'booktabs', 'longtable', 'calc', 'array', 'ulem', 'tabularx', 'hyperref'];
  for (const pkg of candidatePackages) {
    if (neededPackages.has(pkg)) {
      preamblePackages.push(`\\usepackage{${pkg}}`);
    }
  }

  for (const pkg of neededPackages) {
    if (!candidatePackages.includes(pkg) && pkg !== 'amsmath' && pkg !== 'amssymb') {
      preamblePackages.push(`\\usepackage{${pkg}}`);
    }
  }

  if (/[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(latexFragment)) {
    preamblePackages.push('% Note: Right-to-Left (Arabic/Hebrew) text detected: compiling RTL text requires a bidi package (babel/polyglossia) and an RTL font');
  }

  if (latexFragment.includes('% Text box')) {
    preamblePackages.push('% Note: Floating text boxes were moved into the flow; check positions.');
  }

  const cleanBody = stripPackageComments(latexFragment).trim();
  const fontSize = geometry?.baseFontSizePt || 11;

  const lines = [
    `\\documentclass[${fontSize}pt,a4paper]{article}`,
    ...preamblePackages,
    '',
    '\\begin{document}',
    '',
    cleanBody,
    '',
    '\\end{document}',
  ];

  return lines.join('\n');
}

/**
 * Sanitize filename for safe filesystem export.
 * Strips existing extensions and invalid characters.
 */
export function sanitizeFilename(name: string): string {
  let base = name.replace(/\.[^/.]+$/, '');
  base = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  base = base.trim().replace(/^\.+/, '').replace(/\.+$/, '');
  base = base.substring(0, 64);
  if (!base || base.replace(/[_.]/g, '').length === 0) {
    return 'converted';
  }
  return base;
}

