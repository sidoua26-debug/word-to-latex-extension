/**
 * mathParser.ts — Mathematical OCR post-processor and LaTeX AST generator.
 * Converts raw OCR tokens, lines, and spatial layout data into clean, valid LaTeX.
 * Handles:
 * - Greek letters & mathematical symbols
 * - Fractions (\frac), square/nth roots (\sqrt)
 * - Superscripts and subscripts
 * - Summations, integrals, limits (\sum, \int, \lim)
 * - Systems of equations (\begin{cases})
 * - Aligned equations (\begin{align*})
 * - Matrices (\begin{pmatrix}, \begin{bmatrix})
 * - Mixed ordinary text (English / French) with inline math $...$
 */

import type {
  BoundingBox,
  OcrSymbol,
  OcrWord,
  OcrLine,
  OcrResultData,
} from './types.ts';

export type {
  BoundingBox,
  OcrSymbol,
  OcrWord,
  OcrLine,
  OcrResultData,
};

// Unicode math symbol mappings to LaTeX commands
const GREEK_MAP: Record<string, string> = {
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
  'ε': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
  'ι': '\\iota', 'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu',
  'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho',
  'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\phi',
  'ϕ': '\\phi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
  'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda',
  'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Υ': '\\Upsilon',
  'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
};

const GREEK_CHARS = Object.keys(GREEK_MAP).join('');
const GREEK_NAMES = 'alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega';

function normalizeMathOperand(token: string): string {
  let res = token;
  for (const [char, cmd] of Object.entries(GREEK_MAP)) {
    res = res.replaceAll(char, cmd);
  }
  return res;
}

const OPERATOR_MAP: Record<string, string> = {
  '±': '\\pm', '∓': '\\mp', '×': '\\times', '÷': '\\div',
  '·': '\\cdot', '•': '\\cdot', '∗': '*',
  '≤': '\\le', '≥': '\\ge', '≦': '\\le', '≧': '\\ge',
  '≠': '\\neq', '≈': '\\approx', '≡': '\\equiv', '∼': '\\sim',
  '∝': '\\propto', '∈': '\\in', '∉': '\\notin',
  '⊂': '\\subset', '⊆': '\\subseteq', '∪': '\\cup', '∩': '\\cap',
  '∅': '\\emptyset', '∀': '\\forall', '∃': '\\exists',
  '¬': '\\neg', '⇒': '\\implies', '⇔': '\\iff', '→': '\\to',
  '←': '\\leftarrow', '∂': '\\partial', '∇': '\\nabla',
  '∞': '\\infty', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint',
  '∮': '\\oint', '∑': '\\sum', '∏': '\\prod',
  '°': '^\\circ',
};

const SUPERSCRIPT_MAP: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')',
  'ⁿ': 'n', 'ⁱ': 'i',
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
  'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ᵢ': 'i',
  'ⱼ': 'j', 'ₙ': 'n', 'ₘ': 'm', 'ₖ': 'k',
};

const VULGAR_FRACTIONS_MAP: Record<string, string> = {
  '½': '\\frac{1}{2}',
  '⅓': '\\frac{1}{3}',
  '⅔': '\\frac{2}{3}',
  '¼': '\\frac{1}{4}',
  '¾': '\\frac{3}{4}',
  '⅕': '\\frac{1}{5}',
  '⅖': '\\frac{2}{5}',
  '⅗': '\\frac{3}{5}',
  '⅘': '\\frac{4}{5}',
  '⅙': '\\frac{1}{6}',
  '⅚': '\\frac{5}{6}',
  '⅛': '\\frac{1}{8}',
  '⅜': '\\frac{3}{8}',
  '⅝': '\\frac{5}{8}',
  '⅞': '\\frac{7}{8}',
};

/**
 * Replaces Unicode symbols, Greek letters, and exponents with proper LaTeX commands.
 */
export function replaceMathSymbols(str: string): string {
  let result = str;

  // Replace Unicode vulgar fractions: e.g. ½ -> \frac{1}{2}, ¾ -> \frac{3}{4}
  for (const [char, cmd] of Object.entries(VULGAR_FRACTIONS_MAP)) {
    result = result.replaceAll(char, cmd);
  }

  // Replace Unicode superscripts: e.g. x² -> x^{2}, z⁻¹ -> z^{-1}
  result = result.replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]+)/g, (_match, group) => {
    const chars = [...group].map(c => SUPERSCRIPT_MAP[c] || c).join('');
    return `^{${chars}}`;
  });

  // Replace Unicode subscripts: e.g. a₁ -> a_{1}
  result = result.replace(/([₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓᵢⱼₙₘₖ]+)/g, (_match, group) => {
    const chars = [...group].map(c => SUBSCRIPT_MAP[c] || c).join('');
    return `_{${chars}}`;
  });

  // Replace Greek letters
  for (const [char, cmd] of Object.entries(GREEK_MAP)) {
    result = result.replaceAll(char, ` ${cmd} `);
  }

  // Replace operators
  for (const [char, cmd] of Object.entries(OPERATOR_MAP)) {
    result = result.replaceAll(char, ` ${cmd} `);
  }

  // Normalize Unicode dashes (em-dash, en-dash, horizontal bar, unicode minus) to minus sign
  result = result.replace(/[—–‒―−]/gu, ' - ');

  // Common root symbols:
  // 1. Parenthesized: √(expr) -> \sqrt{expr}
  // 2. Unparenthesized token with optional superscript: √x² -> \sqrt{x^{2}}, √2x -> \sqrt{2x}
  result = result.replace(/√\s*(\([^\)]+\)|[a-zA-Z0-9]+(?:\^\{[^\}]+\})?)/g, (_match, group) => {
    const inner = group.startsWith('(') && group.endsWith(')') ? group.slice(1, -1) : group;
    return `\\sqrt{${inner}}`;
  });

  return result;
}

/**
 * Determines whether a line is primarily a mathematical expression
 * versus a natural language text line.
 */
export function isMathExpression(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // 1. Bilingual prose-stopword guard (true function words only)
  // Words with length >= 2 (Unicode letters)
  const words2Plus = trimmed.match(/\b\p{L}{2,}\b/gu) || [];

  const PROSE_STOPWORDS = /\b(the|and|or|for|with|that|this|are|were|from|have|has|had|let|use|see|which|then|they|their|there|what|when|where|we|be|of|in|is|set|an|as|to|by|if|all|not|into|on|at|but|le|la|les|un|une|des|et|en|est|dans|pour|avec|sur|par|qui|que|donc|alors|tout|tous|cette|sont|voici|ce|ces|mais|ou|où|du|de|au|aux|se|sa|son|ses|soient)\b/gui;
  const stopwordMatches = (trimmed.match(PROSE_STOPWORDS) || []).length;

  // French instructional math action verbs / structural keywords
  const MATH_ACTION_VERBS = /\b(calculer|montrer|démontrer|théorème|définition|exercice|soit|soient|supposons|considérons)\b/gui;

  if (
    (stopwordMatches >= 2 && words2Plus.length >= 3) ||
    (MATH_ACTION_VERBS.test(trimmed) && words2Plus.length >= 2)
  ) {
    return false; // Natural language text containing inline math / formulas
  }

  // Common units or prose slashed terms without strong mathematical context
  const UNIT_OR_PROSE_SLASH = /\b(km\/h|m\/s|m\/min|kg\/m3|mg\/mL|L\/min|N\/m2|J\/mol|W\/m2|and\/or|w\/o|n\/a)\b/i;

  // 2. STRONG math characters:
  // = ≠ < > ≤ ≥ + ^ _ { } \ √ ∫ ∑ ∏ and Greek letters, operators, superscripts, subscripts, vulgar fractions
  const strongMathRegex = /[=≠<>≤≥\+\^_{}\\√∫∑∏α-ωΑ-Ω±∓×÷·•∗≈≡∼∝∈∉⊂⊆∪∩∅∀∃¬⇒⇔→←∂∇∞°⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓᵢⱼₙₘₖ½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/u;
  if (strongMathRegex.test(trimmed)) {
    return true;
  }

  // If matched unit/prose slash and no strong math chars, it's prose
  if (UNIT_OR_PROSE_SLASH.test(trimmed)) {
    return false;
  }

  // 3. WEAK math characters:
  // / ( ) [ ] - *
  // Lines with only weak math characters wrap only if they contain fewer than 2 alphabetic words of 3+ letters
  const weakMathRegex = /[\/()\[\]\-\*]/;
  if (weakMathRegex.test(trimmed)) {
    const alphaWords3 = trimmed.match(/\b\p{L}{3,}\b/gu) || [];
    return alphaWords3.length < 2;
  }

  // Lines with neither strong nor weak math characters are prose
  return false;
}

/**
 * Parses fractions from text expressions like:
 * (a + b) / (c + d) -> \frac{a+b}{c+d}
 * (1/2) -> \frac{1}{2}
 * x = 1/2 -> x = \frac{1}{2}
 * 1/2 + 3/4 -> \frac{1}{2} + \frac{3}{4}
 * Standalone/ambiguous 1/2, 12/05 and full dates 2026/10/08 remain unchanged.
 */
export function parseFractionsInLine(line: string): string {
  let result = line;

  // 1. Pattern: (expr) / (expr) -> \frac{expr1}{expr2}
  result = result.replace(/\(([^\)]+)\)\s*\/\s*\(([^\)]+)\)/g, '\\frac{$1}{$2}');

  // 2. Pattern: Parenthesized single numeric fraction (1/2) -> \frac{1}{2}
  result = result.replace(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)/g, '\\frac{$1}{$2}');

  // 3. Date detection patterns
  const hasThreePartDate = /\b\d{1,4}\/\d{1,2}\/\d{1,4}\b/;
  const isYearMonthDate = /^(?:19|20)\d{2}\/(?:0?[1-9]|1[0-2])$/;

  // Check if line contains clear mathematical context (operators, equations, relations)
  const mathContextRegex = /[=≠<>≤≥\+\-±×÷\*·•≈]|\\(pm|mp|times|div|cdot|le|ge|neq|approx|equiv|sim|to|leftarrow|int|sum|prod|sqrt)\b/;
  const hasMathContext = mathContextRegex.test(result);

  // 4. Pattern: word / word or symbol / symbol
  const tokenSlashRegex = new RegExp(`([a-zA-Z0-9\\^\\_\\+\\-\\\\\\${GREEK_CHARS}]+)\\s*\\/\\s*([a-zA-Z0-9\\^\\_\\+\\-\\\\\\${GREEK_CHARS}]+)`, 'g');
  result = result.replace(tokenSlashRegex, (match, num, den, _offset, fullStr) => {
    const trimmedNum = num.trim();
    const trimmedDen = den.trim();

    // Check if both num and den are pure digits
    const isPureDigits = /^\d+$/.test(trimmedNum) && /^\d+$/.test(trimmedDen);

    if (isPureDigits) {
      // If part of a 3-part date like 2026/10/08 or 12/05/2026 anywhere on line
      if (hasThreePartDate.test(fullStr)) return match;

      // If valid year/month date (e.g. 2026/10, 2026/1, 2026/12), protect even in math context
      if (isYearMonthDate.test(`${trimmedNum}/${trimmedDen}`)) {
        return match;
      }

      // Pure numeric slash (e.g. 1/2, 3/4, 10/20, 1234/5): convert ONLY if in clear math context
      if (!hasMathContext) {
        return match;
      }

      return `\\frac{${trimmedNum}}{${trimmedDen}}`;
    }

    // Non-numeric slash handling:
    // Block common shorthand prose abbreviations / units (e.g. w/o, n/a, m/s)
    if (/^(?:w\/o|n\/a|m\/s)$/i.test(`${trimmedNum}/${trimmedDen}`)) {
      return match;
    }

    // Both operands must have clearly mathematical token shapes
    // (single letter, Greek symbol, subscript, exponent, digit coefficient, or LaTeX Greek command)
    const isMathOperand = (t: string) => new RegExp(
      '^(?:' +
      `[a-zA-Z${GREEK_CHARS}]|` +
      '\\d+|' +
      `[a-zA-Z${GREEK_CHARS}]_[a-zA-Z0-9${GREEK_CHARS}]+|` +
      `[a-zA-Z${GREEK_CHARS}]\\^[a-zA-Z0-9${GREEK_CHARS}]+|` +
      `\\d+[a-zA-Z${GREEK_CHARS}](?:\\^[a-zA-Z0-9${GREEK_CHARS}]+)?|` +
      `\\d*\\\\(?:${GREEK_NAMES})(?:\\^[a-zA-Z0-9]+|_[a-zA-Z0-9]+)?|` +
      `(?:${GREEK_NAMES})` +
      ')$'
    ).test(t);

    if (isMathOperand(trimmedNum) && isMathOperand(trimmedDen)) {
      return `\\frac{${normalizeMathOperand(trimmedNum)}}{${normalizeMathOperand(trimmedDen)}}`;
    }

    return match;
  });

  return result;
}

/**
 * Detects 2D stacked fractions across adjacent lines:
 * Line 0: numerator
 * Line 1: horizontal bar (--- or ___)
 * Line 2: denominator
 */
export function parseStackedFractions(lines: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const cur = lines[i].trim();
    const next = lines[i + 1]?.trim();
    const nextNext = lines[i + 2]?.trim();

    // Check for a horizontal divider line like ---, ____, ===
    if (next && /^[-—_=]{2,}$/.test(next) && nextNext) {
      result.push(`\\frac{${cur}}{${nextNext}}`);
      i += 3;
      continue;
    }

    result.push(lines[i]);
    i++;
  }

  return result;
}

/**
 * Detects matrix notation:
 * Lines bounded by [ ... ] or ( ... ) containing multiple rows & columns,
 * or a strict unbracketed numeric grid.
 */
export function parseMatrix(lines: string[]): { isMatrix: boolean; latex?: string } {
  if (lines.length < 2) return { isMatrix: false };

  const trimmed = lines.map(l => l.trim()).filter(Boolean);
  if (trimmed.length < 2 || trimmed.length > 6) return { isMatrix: false };

  const isBracketed = (
    trimmed.every(l => (l.startsWith('[') && l.endsWith(']')) || (l.startsWith('(') && l.endsWith(')'))) ||
    ((trimmed[0].startsWith('[') || trimmed[0].startsWith('(')) &&
     (trimmed[trimmed.length - 1].endsWith(']') || trimmed[trimmed.length - 1].endsWith(')')))
  );

  const env = (trimmed.some(l => l.startsWith('[') || l.endsWith(']')))
    ? 'bmatrix'
    : 'pmatrix';

  // Extract cells per row
  const rows = trimmed.map(l =>
    l.replace(/^[\[\(]\s*/, '').replace(/\s*[\]\)]$/, '').trim().split(/\s*,\s*|\s{2,}|\s+/)
  );
  const colCounts = rows.map(r => r.length);
  const uniformCols = colCounts.length >= 2 && colCounts.every(c => c >= 2 && c === colCounts[0]);

  if (!uniformCols) {
    return { isMatrix: false };
  }

  // Never match equations as matrices
  const hasEquations = trimmed.some(l => /[=<>≤≥]/.test(l));
  if (hasEquations) {
    return { isMatrix: false };
  }

  const processedRows = rows.map(r => r.map(c => replaceMathSymbols(c)));

  if (isBracketed) {
    const matrixBody = processedRows.map(r => r.join(' & ')).join(' \\\\\n');
    return {
      isMatrix: true,
      latex: `\\[\n\\begin{${env}}\n${matrixBody}\n\\end{${env}}\n\\]`,
    };
  }

  // Strict unbracketed numeric grid check
  const isStrictNumericCell = (cell: string) =>
    /^-?(?:\d+(?:\.\d+)?|\d+\/\d+|[a-zA-Z](?:_\d+)?|\\[a-zA-Z]+|[α-ωΑ-Ω])$/.test(cell);

  const isStrictNumericGrid = rows.every(r => r.every(cell => isStrictNumericCell(cell)));

  if (isStrictNumericGrid) {
    const matrixBody = processedRows.map(r => r.join(' & ')).join(' \\\\\n');
    return {
      isMatrix: true,
      latex: `\\[\n\\begin{${env}}\n${matrixBody}\n\\end{${env}}\n\\]`,
    };
  }

  return { isMatrix: false };
}

/**
 * Detects system of equations or piecewise functions (cases environment):
 * Requires real evidence:
 * 1. Leading left-brace glyph or symbol: '{', '\{', or '\begin{cases}'
 * 2. Piecewise condition keywords: 'if', 'si', 'when', 'otherwise', 'sinon', 'for', 'pour', 'quand'
 */
export function parseCases(lines: string[]): { isCases: boolean; latex?: string } {
  const trimmed = lines.map(l => l.trim()).filter(Boolean);
  if (trimmed.length < 2) return { isCases: false };

  const hasLeadingBrace = trimmed.some(l => /^(\{|\\\{|\\begin\{cases\})/.test(l));
  const piecewiseRowsCount = trimmed.filter(l => /\b(if|si|when|quand)\b/i.test(l)).length;
  const hasOtherwise = trimmed.some(l => /\b(otherwise|sinon)\b/i.test(l));

  if (hasLeadingBrace || piecewiseRowsCount >= 2 || hasOtherwise) {
    const cleanedRows = trimmed.map(l => {
      let r = l.replace(/^\{\s*/, '');
      r = replaceMathSymbols(r);
      r = wrapConditionWords(r);
      return r;
    });
    return {
      isCases: true,
      latex: `\\[\n\\begin{cases}\n${cleanedRows.join(' \\\\\n')}\n\\end{cases}\n\\]`,
    };
  }

  return { isCases: false };
}

/**
 * Wraps standalone English condition words ('for', 'if', 'otherwise', 'where') inside LaTeX math in \text{ ... }.
 * Adds spaces inside \text{ ... } (e.g. \text{ for }) so the word is visually separated from surrounding math
 * without running words together in the compiled PDF.
 * Does NOT touch LaTeX commands (\forall, \iff, \infty) or words already inside an existing \text{...}.
 */
export function wrapConditionWords(line: string): string {
  return line.replace(/(\\text\{[^}]*\})|(?<!\\)\b(for|if|otherwise|where)\b/g, (match, textGroup, wordGroup) => {
    if (textGroup) return textGroup;
    return `\\text{ ${wordGroup} }`;
  });
}

/**
 * Detects multi-line equation alignment:
 * Requires alignment evidence: continuation line starting with '=' or '&=' (e.g. '= (x+1)^2') or explicit '&=' in a row
 */
export function parseAlignedEquations(lines: string[]): { isAlign: boolean; latex?: string } {
  const trimmed = lines.map(l => l.trim()).filter(Boolean);
  if (trimmed.length < 2) return { isAlign: false };

  const hasContinuationEquals = trimmed.slice(1).some(l => l.startsWith('=') || l.startsWith('&='));
  const hasAmpersandEquals = trimmed.some(l => l.includes('&='));

  if (hasContinuationEquals || hasAmpersandEquals) {
    const alignedRows = trimmed.map(line => {
      if (line.includes('&=')) return replaceMathSymbols(line);
      return replaceMathSymbols(line).replace(/=/, '&=');
    });
    return {
      isAlign: true,
      latex: `\\begin{align*}\n${alignedRows.join(' \\\\\n')}\n\\end{align*}`,
    };
  }

  return { isAlign: false };
}

/**
 * Classifies symbols in a word as superscript or subscript using spatial bounding boxes.
 * Conservative: only transforms when symbol is clearly elevated or depressed relative to base symbol.
 */
export function classifyWordSymbols(word: OcrWord): string {
  const symbols = word.symbols;
  if (!symbols || symbols.length === 0) {
    return word.text;
  }

  // If symbols lack bounding boxes, return word.text directly
  if (!symbols.some(s => Boolean(s.bbox))) {
    return word.text;
  }

  type Placement = 'normal' | 'super' | 'sub';
  const placements: Placement[] = new Array(symbols.length).fill('normal');

  let activeBaseIdx = -1;

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    if (!sym.bbox) continue;

    if (activeBaseIdx === -1) {
      activeBaseIdx = i;
      continue;
    }

    const baseSym = symbols[activeBaseIdx];
    if (!baseSym.bbox) {
      activeBaseIdx = i;
      continue;
    }

    const hBase = baseSym.bbox.y1 - baseSym.bbox.y0;
    const hSym = sym.bbox.y1 - sym.bbox.y0;

    if (hBase < 4 || hSym < 2) {
      activeBaseIdx = i;
      continue;
    }

    const isPlausibleSuperBase = /^[a-zA-Zα-ωΑ-Ω\d\)\]]$/.test(baseSym.text);
    const isPlausibleSubBase = /^[a-zA-Zα-ωΑ-Ω\)\]]$/.test(baseSym.text);
    // Plausible candidate must be a valid alphanumeric/math character, never punctuation or unrecognized character '?'
    const isPlausibleCandidate = /^[\d\+\-a-zA-Zα-ωΑ-Ω]$/.test(sym.text);

    if (isPlausibleCandidate && sym.bbox.x0 >= baseSym.bbox.x0) {
      const isElevated =
        isPlausibleSuperBase &&
        (baseSym.bbox.y1 - sym.bbox.y1 >= 0.35 * hBase) &&
        (sym.bbox.y0 <= baseSym.bbox.y0 + 0.15 * hBase) &&
        (hSym <= 0.95 * hBase);

      const isDepressed =
        isPlausibleSubBase &&
        (sym.bbox.y1 - baseSym.bbox.y1 >= 0.25 * hBase) &&
        (sym.bbox.y0 - baseSym.bbox.y0 >= 0.30 * hBase) &&
        (hSym <= 0.95 * hBase);

      if (isElevated) {
        placements[i] = 'super';
        continue;
      } else if (isDepressed) {
        placements[i] = 'sub';
        continue;
      }
    }

    // Normal baseline symbol becomes the new potential base
    activeBaseIdx = i;
  }

  // Assemble result string
  let result = '';
  let i = 0;
  while (i < symbols.length) {
    const sym = symbols[i];
    const placement = placements[i];

    if (placement === 'normal') {
      result += sym.text;
      i++;
    } else if (placement === 'super') {
      let superGroup = '';
      while (i < symbols.length && placements[i] === 'super') {
        superGroup += symbols[i].text;
        i++;
      }
      result += `^{${superGroup}}`;
    } else if (placement === 'sub') {
      let subGroup = '';
      while (i < symbols.length && placements[i] === 'sub') {
        subGroup += symbols[i].text;
        i++;
      }
      result += `_{${subGroup}}`;
    }
  }

  return result;
}

/**
 * Applies spatial superscript and subscript classification across a line of OCR words.
 */
export function applySpatialSuperSubscripts(line: OcrLine): string {
  if (!line.words || line.words.length === 0) {
    return line.text;
  }

  const processedWords = line.words.map(w => classifyWordSymbols(w));
  return processedWords.join(' ');
}

function mergeBBoxes(...bboxes: (BoundingBox | undefined)[]): BoundingBox | undefined {
  const valid = bboxes.filter((b): b is BoundingBox => Boolean(b));
  if (valid.length === 0) return undefined;
  return {
    x0: Math.min(...valid.map(b => b.x0)),
    y0: Math.min(...valid.map(b => b.y0)),
    x1: Math.max(...valid.map(b => b.x1)),
    y1: Math.max(...valid.map(b => b.y1)),
  };
}

/**
 * Checks whether a 3-line sequence (l0=upper, l1=operator+body, l2=lower)
 * meets strict spatial, geometric, and differential-anchor conditions to be
 * reconstructed into a definite integral.
 */
function checkStackedIntegral(
  l0: OcrLine,
  l1: OcrLine,
  l2: OcrLine
): { match: boolean; reconstructedText: string } {
  if (!l0.bbox || !l1.bbox || !l2.bbox) {
    return { match: false, reconstructedText: '' };
  }

  if (!l1.words || l1.words.length === 0) {
    return { match: false, reconstructedText: '' };
  }

  const opWord = l1.words[0];
  if (!opWord.bbox) {
    return { match: false, reconstructedText: '' };
  }

  const opWidth = Math.max(1, opWord.bbox.x1 - opWord.bbox.x0);
  const opHeight = opWord.bbox.y1 - opWord.bbox.y0;
  const l0Height = l0.bbox.y1 - l0.bbox.y0;
  const l2Height = l2.bbox.y1 - l2.bbox.y0;

  // Tall operator: must be >= 30px tall and at least 1.6x taller than upper & lower limits
  if (opHeight < 30 || opHeight < 1.6 * l0Height || opHeight < 1.6 * l2Height) {
    return { match: false, reconstructedText: '' };
  }

  // Operator candidates:
  // - Keep "∫" and "[" as primary candidates
  // - Drop plain "l", "I", "f", "|" unless aspect ratio >= 2.5 (slender tall glyph)
  const isPrimaryOp = opWord.text.startsWith('∫') || opWord.text.startsWith('[');
  const isAmbiguousOp = /^[\|lIf]$/.test(opWord.text);

  if (!isPrimaryOp && !isAmbiguousOp) {
    return { match: false, reconstructedText: '' };
  }

  if (isAmbiguousOp) {
    const aspectRatio = opHeight / opWidth;
    if (aspectRatio < 2.5) {
      return { match: false, reconstructedText: '' };
    }
  }

  // Extract integrand body from l1
  let bodyText = '';
  let bodyBBox: BoundingBox | undefined;

  if (l1.words.length > 1) {
    const bodyWords = l1.words.slice(1);
    bodyText = bodyWords.map(w => classifyWordSymbols(w)).join(' ').trim();
    bodyBBox = mergeBBoxes(...bodyWords.map(w => w.bbox));
  } else if (opWord.text.length > 1 && /^[\[∫]/.test(opWord.text)) {
    bodyText = opWord.text.slice(1).trim();
    bodyBBox = opWord.bbox;
  }

  if (!bodyText) {
    return { match: false, reconstructedText: '' };
  }

  // Differential check: standalone differential at the end of the body, no /i flag
  // Must NOT match French "de", "du", "do" or embedded letters inside words
  const hasDifferential = /(^|[\s\)\?])d(x|y|z|t|u|v|s|r|\\theta|\\phi)\s*$/.test(bodyText);
  if (!hasDifferential) {
    return { match: false, reconstructedText: '' };
  }

  // Horizontal proximity: both limit lines' x-range must overlap or sit within 1 operator width
  const minX = opWord.bbox.x0 - opWidth;
  const maxX = opWord.bbox.x1 + opWidth;

  const l0WithinX = l0.bbox.x0 <= maxX && l0.bbox.x1 >= minX;
  const l2WithinX = l2.bbox.x0 <= maxX && l2.bbox.x1 >= minX;
  if (!l0WithinX || !l2WithinX) {
    return { match: false, reconstructedText: '' };
  }

  // Vertical positioning:
  // l0 must be at/above operator top, and not overlap vertically with the body line
  // l2 must be at/below operator bottom, and not overlap vertically with the body line
  const bodyTop = bodyBBox ? bodyBBox.y0 : opWord.bbox.y0 + 0.25 * opHeight;
  const bodyBottom = bodyBBox ? bodyBBox.y1 : opWord.bbox.y1 - 0.25 * opHeight;

  if (l0.bbox.y0 > opWord.bbox.y0 + 0.35 * opHeight || l0.bbox.y1 > bodyTop) {
    return { match: false, reconstructedText: '' };
  }

  if (l2.bbox.y1 < opWord.bbox.y1 - 0.35 * opHeight || l2.bbox.y0 < bodyBottom) {
    return { match: false, reconstructedText: '' };
  }

  // Concise limits check (<= 3 words)
  const l0WordCount = Math.max(l0.words?.length || 0, l0.text.trim() ? l0.text.trim().split(/\s+/).length : 0);
  const l2WordCount = Math.max(l2.words?.length || 0, l2.text.trim() ? l2.text.trim().split(/\s+/).length : 0);
  if (l0WordCount > 3 || l2WordCount > 3) {
    return { match: false, reconstructedText: '' };
  }

  const upper = replaceMathSymbols(applySpatialSuperSubscripts(l0)).trim();
  const lower = replaceMathSymbols(applySpatialSuperSubscripts(l2)).trim();

  return {
    match: true,
    reconstructedText: `\\int_{${lower}}^{${upper}} ${bodyText}`,
  };
}

/**
 * Conservative reconstruction of vertically-stacked definite integrals.
 */
export function reconstructStackedIntegrals(lines: OcrLine[]): OcrLine[] {
  if (lines.length < 3) return lines;

  const result: OcrLine[] = [];
  let i = 0;

  while (i < lines.length) {
    if (i + 2 < lines.length) {
      const l0 = lines[i];     // Upper bound candidate
      const l1 = lines[i + 1]; // Middle operator + integrand candidate
      const l2 = lines[i + 2]; // Lower bound candidate

      const isReconstructible = checkStackedIntegral(l0, l1, l2);
      if (isReconstructible.match) {
        const mergedBBox = mergeBBoxes(l0.bbox, l1.bbox, l2.bbox);
        const reconstructedLine: OcrLine = {
          text: isReconstructible.reconstructedText,
          confidence: Math.min(l0.confidence, l1.confidence, l2.confidence),
          bbox: mergedBBox,
          words: [
            {
              text: isReconstructible.reconstructedText,
              confidence: Math.min(l0.confidence, l1.confidence, l2.confidence),
              bbox: mergedBBox,
            },
          ],
        };
        result.push(reconstructedLine);
        i += 3;
        continue;
      }
    }

    result.push(lines[i]);
    i++;
  }

  return result;
}

/**
 * Full mathematical OCR parser:
 * Takes raw OCR lines and metadata, and produces clean LaTeX code.
 */
export function parseOcrToLatex(ocrResult: OcrResultData): string {
  let ocrLines = ocrResult.lines;
  if (ocrLines && ocrLines.length >= 3) {
    ocrLines = reconstructStackedIntegrals(ocrLines);
  }

  const rawLines = ocrLines?.length
    ? ocrLines.map(l => applySpatialSuperSubscripts(l))
    : ocrResult.text.split('\n');

  // Strip empty whitespace lines
  const cleanedLines = rawLines.map(l => l.trim()).filter(Boolean);
  if (cleanedLines.length === 0) return '';

  // 1. Check for stacked fractions
  const fractionProcessed = parseStackedFractions(cleanedLines);

  // 2. Check for matrix environment
  const matrixCheck = parseMatrix(fractionProcessed);

  if (matrixCheck.isMatrix && matrixCheck.latex) {
    return matrixCheck.latex;
  }

  // 3. Check for system of equations (cases)
  const casesCheck = parseCases(fractionProcessed);
  if (casesCheck.isCases && casesCheck.latex) {
    return casesCheck.latex;
  }

  // 4. Check for aligned equations
  const alignCheck = parseAlignedEquations(fractionProcessed);
  if (alignCheck.isAlign && alignCheck.latex) {
    return alignCheck.latex;
  }

  // 5. Line-by-line processing
  const outputBlocks: string[] = [];

  for (let i = 0; i < fractionProcessed.length; i++) {
    let line = fractionProcessed[i];

    // Symbol and fraction replacements
    line = parseFractionsInLine(line);
    line = replaceMathSymbols(line);

    // Confidence warning
    const ocrLineObj = ocrResult.lines?.[i];
    let warningComment = '';
    if (ocrLineObj && ocrLineObj.confidence > 0 && ocrLineObj.confidence < 60) {
      warningComment = `% Note: Low recognition confidence (${Math.round(ocrLineObj.confidence)}%) on line below\n`;
    }

    if (isMathExpression(line)) {
      // Wrap plain English condition words inside math lines in \text{ ... } with surrounding spaces
      let safeMathLine = wrapConditionWords(line);

      // Standalone equation line: wrap unmapped Unicode letter words and symbols in \text{...} to prevent math font glyph dropping
      safeMathLine = safeMathLine.replace(/(?<!\\[a-zA-Z]*)([\p{L}\p{N}]+|[^\x00-\x7F]+)/gu, (match) =>
        /[^\x00-\x7F]/.test(match) ? `\\text{${match}}` : match
      );
      // Escape raw unescaped $ inside display math
      safeMathLine = safeMathLine.replace(/(?<!\\)\$/g, '\\$');
      outputBlocks.push(`${warningComment}\\[\n${safeMathLine}\n\\]`);
    } else {
      // Natural language text: keep French accents and wrap any isolated single math symbols
      outputBlocks.push(`${warningComment}${line}`);
    }
  }

  return outputBlocks.join('\n\n');
}
