/**
 * Unit tests for cleanup.ts
 * Run with: npx tsx --test tests/cleanup.test.ts
 * Or: node --loader tsx --test tests/cleanup.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupLatex,
  removeTightlist,
  unwrapPandocbounded,
  unwrapForeignLanguage,
  cleanFrenchPunctuationAndTildes,
  unwrapRedundantBraces,
  collapseBlankLines,
  trimTrailingWhitespace,
  prependPackageComments,
  findBalancedClose,
  normalizeWhitespaceProtected,
  validateLatexStructure,
  hasFrenchText,
  stripPackageComments,
  wrapCompleteDocument,
  sanitizeFilename,
  unwrapBidiCommands,
} from '../src/cleanup.ts';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore
import { createPandocInstance } from '../node_modules/pandoc-wasm/src/core.js';
import { runPandocConvert } from '../src/pandocCore.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('removeTightlist', () => {
  it('removes bare \\tightlist lines', () => {
    const input = '\\begin{itemize}\n\\tightlist\n\\item Hello\n\\end{itemize}';
    const expected = '\\begin{itemize}\n\n\\item Hello\n\\end{itemize}';
    assert.equal(removeTightlist(input), expected);
  });

  it('removes \\tightlist with surrounding whitespace', () => {
    const input = '  \\tightlist  ';
    assert.equal(removeTightlist(input), '');
  });

  it('does not remove \\tightlist embedded in other content', () => {
    const input = 'some \\tightlist thing';
    assert.equal(removeTightlist(input), 'some \\tightlist thing');
  });
});

describe('unwrapPandocbounded', () => {
  it('unwraps a simple \\pandocbounded{...}', () => {
    const input = '\\pandocbounded{hello world}';
    assert.equal(unwrapPandocbounded(input), 'hello world');
  });

  it('handles nested braces', () => {
    const input = '\\pandocbounded{\\textbf{nested {deep}}}';
    assert.equal(unwrapPandocbounded(input), '\\textbf{nested {deep}}');
  });

  it('handles multiple occurrences', () => {
    const input = '\\pandocbounded{first} and \\pandocbounded{second}';
    assert.equal(unwrapPandocbounded(input), 'first and second');
  });

  it('handles nested pandocbounded', () => {
    const input = '\\pandocbounded{outer \\pandocbounded{inner}}';
    assert.equal(unwrapPandocbounded(input), 'outer inner');
  });

  it('preserves content without pandocbounded', () => {
    const input = '\\textbf{hello}';
    assert.equal(unwrapPandocbounded(input), '\\textbf{hello}');
  });
});

describe('collapseBlankLines', () => {
  it('collapses 3+ blank lines to 2', () => {
    const input = 'a\n\n\n\nb';
    const result = collapseBlankLines(input);
    assert.equal(result, 'a\n\nb');
  });

  it('preserves 2 blank lines', () => {
    const input = 'a\n\nb';
    assert.equal(collapseBlankLines(input), 'a\n\nb');
  });

  it('collapses many blank lines', () => {
    const input = 'a\n\n\n\n\n\nb';
    const result = collapseBlankLines(input);
    assert.equal(result, 'a\n\nb');
  });
});

describe('trimTrailingWhitespace', () => {
  it('trims trailing spaces', () => {
    assert.equal(trimTrailingWhitespace('hello   '), 'hello');
  });

  it('trims trailing tabs', () => {
    assert.equal(trimTrailingWhitespace('hello\t\t'), 'hello');
  });

  it('works per line', () => {
    const input = 'line1   \nline2\t\nline3';
    assert.equal(trimTrailingWhitespace(input), 'line1\nline2\nline3');
  });
});

describe('prependPackageComments', () => {
  it('detects booktabs', () => {
    const input = '\\toprule\ncontent\n\\bottomrule';
    const result = prependPackageComments(input);
    assert.ok(result.includes('% \\usepackage{booktabs}'));
  });

  it('detects longtable', () => {
    const input = '\\begin{longtable}{ll}';
    const result = prependPackageComments(input);
    assert.ok(result.includes('% \\usepackage{longtable}'));
  });

  it('detects graphicx', () => {
    const input = '\\includegraphics[width=1cm]{img.png}';
    const result = prependPackageComments(input);
    assert.ok(result.includes('% \\usepackage{graphicx}'));
  });

  it('detects hyperref', () => {
    const input = '\\hyperref[sec:intro]{Introduction}';
    const result = prependPackageComments(input);
    assert.ok(result.includes('% \\usepackage{hyperref}'));
  });

  it('detects multiple packages', () => {
    const input = '\\toprule\n\\includegraphics{x}';
    const result = prependPackageComments(input);
    assert.ok(result.includes('% \\usepackage{booktabs}'));
    assert.ok(result.includes('% \\usepackage{graphicx}'));
  });

  it('adds no comment block when no packages needed', () => {
    const input = 'Hello world';
    assert.equal(prependPackageComments(input), input);
  });

  it('sorts packages alphabetically', () => {
    const input = '\\includegraphics{x}\n\\toprule';
    const result = prependPackageComments(input);
    const lines = result.split('\n');
    const pkgLines = lines.filter(l => l.startsWith('% \\usepackage'));
    assert.equal(pkgLines[0], '% \\usepackage{booktabs}');
    assert.equal(pkgLines[1], '% \\usepackage{graphicx}');
  });

  it('detects calc and array for longtable column specifications', () => {
    const input = '\\begin{longtable}[]{@{}>{\\raggedright\\arraybackslash}p{(\\linewidth - 2\\tabcolsep) * \\real{0.5000}}@{}}';
    const result = prependPackageComments(input);
    assert.ok(result.includes('% \\usepackage{array}'));
    assert.ok(result.includes('% \\usepackage{calc}'));
    assert.ok(result.includes('% \\usepackage{longtable}'));
  });

  it('detects ulem for underlined and strikethrough text', () => {
    const input = '\\uline{underlined text} and \\sout{strike}';
    const result = prependPackageComments(input);
    assert.ok(result.includes('% \\usepackage{ulem}'));
  });

  it('detects tabularx', () => {
    const input = '\\begin{tabularx}{\\linewidth}{lX}';
    const result = prependPackageComments(input);
    assert.ok(result.includes('% \\usepackage{tabularx}'));
  });
});

describe('fixTableLists', () => {
  it('wraps unwrapped itemize in a longtable cell with minipage', () => {
    const input = '\\begin{longtable}[]{@{}ll@{}}\nCell 1 & \\begin{itemize}\n\\item Item 1\n\\item Item 2\n\\end{itemize} \\\\\n\\end{longtable}';
    const result = cleanupLatex(input);
    assert.ok(result.includes('\\begin{minipage}[t]{\\linewidth}\\raggedright\n\\begin{itemize}'));
    assert.ok(result.includes('\\end{itemize}\n\\end{minipage}'));
  });

  it('wraps unwrapped enumerate in a tabular cell with minipage', () => {
    const input = '\\begin{tabular}{ll}\nA & \\begin{enumerate}\n\\item Step 1\n\\item Step 2\n\\end{enumerate} \\\\\n\\end{tabular}';
    const result = cleanupLatex(input);
    assert.ok(result.includes('\\begin{minipage}[t]{\\linewidth}\\raggedright\n\\begin{enumerate}'));
    assert.ok(result.includes('\\end{enumerate}\n\\end{minipage}'));
  });

  it('does not duplicate minipage if already wrapped', () => {
    const input = '\\begin{longtable}[]{@{}ll@{}}\nCell 1 & \\begin{minipage}[t]{\\linewidth}\\raggedright\n\\begin{itemize}\n\\item Item 1\n\\end{itemize}\n\\end{minipage} \\\\\n\\end{longtable}';
    const result = cleanupLatex(input);
    // Count occurrences of \begin{minipage}
    const matches = result.match(/\\begin\{minipage\}/g) || [];
    assert.equal(matches.length, 1);
  });

  it('does not wrap lists that are outside of tables', () => {
    const input = 'Here is a regular list:\n\n\\begin{itemize}\n\\item Bullet 1\n\\item Bullet 2\n\\end{itemize}';
    const result = cleanupLatex(input);
    assert.ok(!result.includes('\\begin{minipage}'));
    assert.ok(result.includes('\\begin{itemize}'));
  });

  it('wraps nested lists inside a table in a single outer minipage', () => {
    const input = '\\begin{longtable}[]{@{}ll@{}}\nCell 1 & \\begin{itemize}\n\\item Level 1\n\\begin{itemize}\n\\item Level 2\n\\end{itemize}\n\\end{itemize} \\\\\n\\end{longtable}';
    const result = cleanupLatex(input);
    const minipageMatches = result.match(/\\begin\{minipage\}/g) || [];
    assert.equal(minipageMatches.length, 1);
    assert.ok(result.includes('\\begin{minipage}[t]{\\linewidth}\\raggedright\n\\begin{itemize}'));
  });
});

describe('unwrapForeignLanguage', () => {
  it('unwraps simple \\foreignlanguage{french}{...}', () => {
    const input = '\\foreignlanguage{french}{Corps : laiton CW617N}';
    assert.equal(unwrapForeignLanguage(input), 'Corps : laiton CW617N');
  });

  it('handles nested braces inside content', () => {
    const input = '\\foreignlanguage{french}{\\textbf{Corps} : laiton {CW617N}}';
    assert.equal(unwrapForeignLanguage(input), '\\textbf{Corps} : laiton {CW617N}');
  });

  it('unwraps multiple occurrences and cleans empty braces', () => {
    const input = '\\foreignlanguage{french}{Ø}{}\\foreignlanguage{french}{Corps : laiton}';
    assert.equal(unwrapForeignLanguage(input), 'ØCorps : laiton');
  });

  it('unwraps \\begin{otherlanguage}{french} environments', () => {
    const input = '\\begin{otherlanguage}{french}\nTexte en français\n\\end{otherlanguage}';
    assert.equal(unwrapForeignLanguage(input).trim(), 'Texte en français');
  });

  it('preserves LaTeX column specifications @{} and macro braces \\noalign{} while cleaning bare empty braces', () => {
    const input = '\\begin{longtable}[]{@{}ll@{}}\n\\toprule\\noalign{}\n\\endhead\n\\foreignlanguage{french}{Ø}{}\\foreignlanguage{french}{Corps}\n\\end{longtable}';
    const result = unwrapForeignLanguage(input);
    assert.ok(result.includes('@{}ll@{}}'), 'Column spec @{} must be preserved');
    assert.ok(result.includes('\\toprule\\noalign{}'), '\\noalign{} must be preserved');
    assert.ok(result.includes('ØCorps'), 'Empty braces between foreignlanguage calls must be stripped');
  });
});

describe('cleanFrenchPunctuationAndTildes', () => {
  it('normalizes tildes before colons and high punctuation', () => {
    const input = 'Corps~: laiton; Pression~: 16 bars? Débit~: 70L/min! Vrai~; faux~: «~test~»';
    const expected = 'Corps : laiton; Pression : 16 bars? Débit : 70L/min! Vrai ; faux : « test »';
    assert.equal(cleanFrenchPunctuationAndTildes(input), expected);
  });

  it('unwraps redundant spacing groups like {~ }', () => {
    const input = 'Ø{~ }Corps : laiton';
    assert.equal(cleanFrenchPunctuationAndTildes(input), 'Ø Corps : laiton');
  });

  it('does not corrupt empty tabular column specifiers @{} or @{}ll@{}', () => {
    const input = '\\begin{longtable}[]{@{} >{\\raggedright\\arraybackslash}p{0.5\\linewidth} @{}}';
    const result = cleanFrenchPunctuationAndTildes(input);
    assert.ok(result.includes('@{}'), 'Must not replace @{} with @ space');
    assert.ok(!result.includes('@ '), 'Must not introduce spaces into @{}');
  });

  it('normalizes leading bullet symbols with tildes', () => {
    const input = 'Ø~ Corps : laiton\nØ~ Pression : 0.2 bars\nØ~ Débit : 70L/min';
    assert.ok(!cleanFrenchPunctuationAndTildes(input).includes('~'));
    assert.ok(cleanFrenchPunctuationAndTildes(input).includes('Ø Corps : laiton'));
  });

  it('preserves standard LaTeX semantic ties like Fig.~1 and p.~42', () => {
    const input = 'Voir Fig.~1 et p.~42 pour plus de détails.';
    assert.equal(cleanFrenchPunctuationAndTildes(input), input);
  });
});

describe('unwrapRedundantBraces', () => {
  it('unwraps bare braces around standalone symbols and Unicode characters', () => {
    const input = '{Ø} {€} {°} {±} {≤} {≥} {×} {μ} {é} {à}';
    assert.equal(unwrapRedundantBraces(input), 'Ø € ° ± ≤ ≥ × μ é à');
  });

  it('unwraps nested double braces {{...}}', () => {
    const input = '{{Ø}} et {{text}}';
    assert.equal(unwrapRedundantBraces(input), 'Ø et text');
  });

  it('preserves LaTeX macro arguments, math superscripts, and subscripts', () => {
    const input = '\\textbf{bold text} \\emph{italic} x^{2} y_{1} \\frac{1}{2}';
    assert.equal(unwrapRedundantBraces(input), input);
  });
});

describe('cleanupLatex (full pipeline)', () => {
  it('applies all cleanup steps including tightlist, pandocbounded, and package comments', () => {
    const input = [
      '\\pandocbounded{\\begin{itemize}}',
      '\\tightlist',
      '\\item First   ',
      '\\item Second\t',
      '\\pandocbounded{\\end{itemize}}',
      '',
      '',
      '',
      '',
      '\\toprule',
    ].join('\n');

    const result = cleanupLatex(input);

    // tightlist removed
    assert.ok(!result.includes('\\tightlist'));
    // pandocbounded unwrapped
    assert.ok(!result.includes('\\pandocbounded'));
    assert.ok(result.includes('\\begin{itemize}'));
    // trailing whitespace trimmed
    assert.ok(!result.includes('First   '));
    assert.ok(!result.includes('Second\t'));
    // blank lines collapsed
    assert.ok(!result.includes('\n\n\n'));
    // package comment added
    assert.ok(result.includes('% \\usepackage{booktabs}'));
  });

  it('cleans exact user French bug input with foreignlanguage and malformed Ø', () => {
    const rawInput = [
      '\\foreignlanguage{french}{{Ø{~ }}}{}\\foreignlanguage{french}{Corps~:',
      'laiton CW617N}',
      '',
      '\\foreignlanguage{french}{{Ø{~ }}}{}\\foreignlanguage{french}{Pression~:',
      '0.2 à 16 bars}',
      '',
      '\\foreignlanguage{french}{{Ø{~ }}}{}\\foreignlanguage{french}{Débit',
      'nominal~: 70L/min}',
    ].join('\n');

    const result = cleanupLatex(rawInput);

    // No foreignlanguage
    assert.ok(!result.includes('\\foreignlanguage'));
    // No malformed braces or tildes around Ø
    assert.ok(!result.includes('Ø{~ }'));
    assert.ok(!result.includes('{Ø}'));
    assert.ok(!result.includes('Corps~:'));
    assert.ok(!result.includes('nominal~:'));
    // Text and accents preserved
    assert.ok(result.includes('Corps :'));
    assert.ok(result.includes('Pression :'));
    assert.ok(result.includes('0.2 à 16 bars'));
    assert.ok(result.includes('Débit'));
    assert.ok(result.includes('70L/min'));
  });
});

describe('findBalancedClose', () => {
  it('finds matching closing brace for nested braces', () => {
    const input = '{\\textbf{hello {world}}} rest';
    const closeIdx = findBalancedClose(input, 0);
    assert.equal(closeIdx, 23);
    assert.equal(input.substring(0, closeIdx + 1), '{\\textbf{hello {world}}}');
  });

  it('skips escaped braces', () => {
    const input = '{item \\{with\\} escaped} after';
    const closeIdx = findBalancedClose(input, 0);
    assert.equal(closeIdx, 22);
    assert.equal(input.substring(0, closeIdx + 1), '{item \\{with\\} escaped}');
  });

  it('returns -1 for unbalanced braces', () => {
    const input = '{unclosed brace';
    assert.equal(findBalancedClose(input, 0), -1);
  });
});

describe('normalizeWhitespaceProtected', () => {
  it('protects whitespace inside verbatim environments', () => {
    const input = [
      'Normal text with too many blank lines\n\n\n\n',
      '\\begin{verbatim}',
      '  line 1   ',
      '    line 2 with exact spacing',
      '\\end{verbatim}',
      '\n\n\nMore normal text',
    ].join('\n');

    const result = normalizeWhitespaceProtected(input);
    assert.ok(result.includes('  line 1   \n    line 2 with exact spacing'));
    assert.ok(!result.includes('\n\n\n\n'));
  });

  it('protects whitespace inside display math', () => {
    const input = [
      'Equation below:',
      '\\[',
      '   x + y = z   ',
      '\\]',
      '\n\n\nAfter math',
    ].join('\n');

    const result = normalizeWhitespaceProtected(input);
    assert.ok(result.includes('\\[\n   x + y = z   \n\\]'));
    assert.ok(!result.includes('\n\n\nAfter math'));
  });
});

describe('validateLatexStructure', () => {
  it('validates well-formed LaTeX', () => {
    const input = '\\begin{itemize}\n\\item Item 1\n\\item Item 2\n\\end{itemize}';
    const res = validateLatexStructure(input);
    assert.equal(res.valid, true);
    assert.equal(res.errors.length, 0);
  });

  it('detects unclosed environment', () => {
    const input = '\\begin{itemize}\n\\item Item 1\n\\item Item 2';
    const res = validateLatexStructure(input);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('Unclosed environments: itemize')));
  });

  it('detects mismatched environment tags', () => {
    const input = '\\begin{itemize}\n\\item Test\n\\end{enumerate}';
    const res = validateLatexStructure(input);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('Mismatched environment')));
  });

  it('detects unbalanced braces', () => {
    const input = '\\textbf{hello';
    const res = validateLatexStructure(input);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('Unbalanced braces')));
  });
});

describe('hasFrenchText', () => {
  it('detects French accents and ligatures', () => {
    assert.equal(hasFrenchText('Bonjour le monde'), false);
    assert.equal(hasFrenchText('Voici un résumé'), true);
    assert.equal(hasFrenchText('L’œuvre de l’auteur'), true);
    assert.equal(hasFrenchText('« Citation »'), true);
    assert.equal(hasFrenchText('élève, déjà, ça, où'), true);
  });
});

describe('stripPackageComments', () => {
  it('strips package comments and leaves clean body', () => {
    const input = [
      '% Required packages (add to your preamble):',
      '% \\usepackage{booktabs}',
      '% \\usepackage{longtable}',
      '',
      '\\begin{longtable}{ll}',
      '\\toprule',
      'A & B \\\\',
      '\\bottomrule',
      '\\end{longtable}',
    ].join('\n');

    const result = stripPackageComments(input);
    assert.ok(!result.includes('% Required packages'));
    assert.ok(!result.includes('% \\usepackage'));
    assert.ok(result.startsWith('\\begin{longtable}'));
  });
});

describe('wrapCompleteDocument', () => {
  it('wraps a plain fragment into a compilable document', () => {
    const fragment = 'Hello world, this is a plain paragraph.';
    const doc = wrapCompleteDocument(fragment);

    assert.ok(doc.includes('\\documentclass[11pt,a4paper]{article}'));
    assert.ok(doc.includes('\\usepackage[utf8]{inputenc}'));
    assert.ok(doc.includes('\\usepackage[T1]{fontenc}'));
    assert.ok(doc.includes('\\usepackage[english]{babel}'));
    assert.ok(doc.includes('\\usepackage{amsmath,amssymb,amsfonts}'));
    assert.ok(doc.includes('\\begin{document}'));
    assert.ok(doc.includes(fragment));
    assert.ok(doc.includes('\\end{document}'));
  });

  it('detects French text and enables french babel', () => {
    const frenchFragment = 'Bonjour, voici un résumé avec des accents é, è, à.';
    const doc = wrapCompleteDocument(frenchFragment);

    assert.ok(doc.includes('\\usepackage[french,english]{babel}'));
  });

  it('extracts required packages from fragment comments and content', () => {
    const fragment = [
      '% Required packages (add to your preamble):',
      '% \\usepackage{array}',
      '% \\usepackage{booktabs}',
      '% \\usepackage{calc}',
      '% \\usepackage{longtable}',
      '',
      '\\begin{longtable}[]{@{}ll@{}}',
      '\\toprule',
      'Cell 1 & Cell 2 \\\\',
      '\\bottomrule',
      '\\end{longtable}',
    ].join('\n');

    const doc = wrapCompleteDocument(fragment);

    // Packages should be in preamble
    assert.ok(doc.includes('\\usepackage{booktabs}'));
    assert.ok(doc.includes('\\usepackage{longtable}'));
    assert.ok(doc.includes('\\usepackage{calc}'));
    assert.ok(doc.includes('\\usepackage{array}'));

    // Body inside \begin{document} should not contain the comment header
    const bodyPart = doc.split('\\begin{document}')[1].split('\\end{document}')[0];
    assert.ok(!bodyPart.includes('% Required packages'));
    assert.ok(!bodyPart.includes('% \\usepackage'));
    assert.ok(bodyPart.includes('\\begin{longtable}'));
  });
});

describe('sanitizeFilename', () => {
  it('strips extension and trims spaces', () => {
    assert.equal(sanitizeFilename('my_document.docx'), 'my_document');
    assert.equal(sanitizeFilename('report_2026.png'), 'report_2026');
  });

  it('sanitizes invalid filesystem characters', () => {
    assert.equal(sanitizeFilename('doc:with/invalid*chars?.docx'), 'doc_with_invalid_chars_');
    assert.equal(sanitizeFilename('file<name>|"test"'), 'file_name___test_');
  });

  it('falls back to converted on empty or invalid names', () => {
    assert.equal(sanitizeFilename(''), 'converted');
    assert.equal(sanitizeFilename('   .docx'), 'converted');
    assert.equal(sanitizeFilename('???'), 'converted');
  });

  it('preserves valid Unicode names and French accents', () => {
    assert.equal(sanitizeFilename('rapport_élève_2026.docx'), 'rapport_élève_2026');
    assert.equal(sanitizeFilename('théorème_de_pythagore.png'), 'théorème_de_pythagore');
  });

  it('full cleanup pipeline preserves Pandoc table column specifications and \\noalign{}', () => {
    const input = [
      '{\\def\\LTcaptype{none}',
      '\\begin{longtable}[]{@{}',
      '  >{\\raggedright\\arraybackslash}p{(\\linewidth - 2\\tabcolsep) * \\real{0.5000}}',
      '  >{\\raggedright\\arraybackslash}p{(\\linewidth - 2\\tabcolsep) * \\real{0.5000}}@{}}',
      '\\toprule\\noalign{}',
      '\\endhead',
      '\\bottomrule\\noalign{}',
      '\\endlastfoot',
      'Header A & Header B \\\\',
      'Row 1 & Bullet 1',
      '',
      'Bullet 2 \\\\',
      '\\end{longtable}',
      '}',
    ].join('\n');
    const clean = cleanupLatex(input);
    assert.ok(clean.includes('@{}'), 'Column spec @{} must stay intact');
    assert.ok(clean.includes('\\toprule\\noalign{}'), '\\toprule\\noalign{} must stay intact');
    assert.ok(!clean.includes('@\n'), 'Must not strip braces from @{}');
    assert.ok(!clean.includes('\\noalign\n'), 'Must not strip braces from \\noalign{}');
  });
});

describe('unwrapBidiCommands and RTL handling', () => {
  it('unwraps 65.8\\RL{\\%} to 65.8\\%', () => {
    const input = '65.8\\RL{\\%}';
    assert.equal(unwrapBidiCommands(input), '65.8\\%');
  });

  it('unwraps nested braces: \\RL{a \\textbf{b} c} -> a \\textbf{b} c', () => {
    const input = '\\RL{a \\textbf{b} c}';
    assert.equal(unwrapBidiCommands(input), 'a \\textbf{b} c');
  });

  it('leaves text without \\RL untouched', () => {
    const input = 'This is normal text without bidi macros.';
    assert.equal(unwrapBidiCommands(input), input);
  });

  it('unwraps \\LR correctly', () => {
    const input = '\\LR{some ltr text in rtl context}';
    assert.equal(unwrapBidiCommands(input), 'some ltr text in rtl context');
  });

  it('handles multiple occurrences on one line', () => {
    const input = 'Values: \\RL{10\\%} and \\RL{20\\%} with \\LR{note}';
    assert.equal(unwrapBidiCommands(input), 'Values: 10\\% and 20\\% with note');
  });

  it('handles nested bidi wrappers \\RL{outer \\LR{inner}}', () => {
    const input = '\\RL{outer \\LR{inner}}';
    assert.equal(unwrapBidiCommands(input), 'outer inner');
  });

  it('full cleanupLatex unwraps \\RL{\\%} in Gran 65.8 context', () => {
    const input = 'Gran 65.8\\RL{\\%}\n';
    const clean = cleanupLatex(input);
    assert.equal(clean, 'Gran 65.8\\%\n');
  });

  it('adds visible review note when genuine RTL (Arabic/Hebrew) text is present', () => {
    const arabicInput = 'نص عربي';
    const commented = prependPackageComments(arabicInput);
    assert.ok(commented.includes('% Note: Right-to-Left (Arabic/Hebrew) text detected'));

    const doc = wrapCompleteDocument(arabicInput);
    assert.ok(doc.includes('% Note: Right-to-Left (Arabic/Hebrew) text detected'));
  });

  it('converts tiny DOCX fixture with <w:rtl/> run to clean LaTeX without \\RL', async () => {
    // DOCX with "Gran 65.8" and a rtl "%" run (<w:rPr><w:rtl/><w:lang w:bidi="ar-DZ"/></w:rPr><w:t>%</w:t>)
    const docxB64 = 'UEsDBBQAAAAAAONRSl3XeYTquAEAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz4KPFR5cGVzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L2NvbnRlbnQtdHlwZXMiPgogIDxEZWZhdWx0IEV4dGVuc2lvbj0icmVscyIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1wYWNrYWdlLnJlbGF0aW9uc2hpcHMreG1sIi8+CiAgPERlZmF1bHQgRXh0ZW5zaW9uPSJ4bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi94bWwiLz4KICA8T3ZlcnJpZGUgUGFydE5hbWU9Ii93b3JkL2RvY3VtZW50LnhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC53b3JkcHJvY2Vzc2luZ21sLmRvY3VtZW50Lm1haW4reG1sIi8+CjwvVHlwZXM+UEsDBBQAAAAAAONRSl0gG4bqLgEAAC4BAAALAAAAX3JlbHMvLnJlbHM8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+CjxSZWxhdGlvbnNoaXBzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L3JlbGF0aW9uc2hpcHMiPgogIDxSZWxhdGlvbnNoaXAgSWQ9InJJZDEiIFR5cGU9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L3JlbGF0aW9uc2hpcHMvb2ZmaWNlRG9jdW1lbnQiIFRhcmdldD0id29yZC9kb2N1bWVudC54bWwiLz4KPC9SZWxhdGlvbnNoaXBzPlBLAwQUAAAAAADjUUpdjdoyh3ABAABwAQAAEQAAAHdvcmQvZG9jdW1lbnQueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pgo8dzpkb2N1bWVudCB4bWxuczp3PSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvd29yZHByb2Nlc3NpbmdtbC8yMDA2L21haW4iPgogIDx3OmJvZHk+CiAgICA8dzpwPgogICAgICA8dzpyPjx3OnQ+R3JhbiA2NS44PC93OnQ+PC93OnI+CiAgICAgIDx3OnI+CiAgICAgICAgPHc6clByPgogICAgICAgICAgPHc6cnRsLz4KICAgICAgICAgIDx3OmxhbmcgdzpiaWRpPSJhci1EWiIvPgogICAgICAgIDwvdzpyUHI+CiAgICAgICAgPHc6dD4lPC93OnQ+CiAgICAgIDwvdzpyPgogICAgPC93OnA+CiAgPC93OmJvZHk+Cjwvdzpkb2N1bWVudD5QSwECFAMUAAAAAADjUUpd13mE6rgBAAC4AQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAAAONRSl0gG4bqLgEAAC4BAAALAAAAAAAAAAAAAACAAekBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAAAONRSl2N2jKHcAEAAHABAAARAAAAAAAAAAAAAACAAUADAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAADfBAAAAAA=';
    const buffer = Buffer.from(docxB64, 'base64');

    const wasmPath = path.resolve(__dirname, '../node_modules/pandoc-wasm/src/pandoc.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const pandoc = await createPandocInstance(wasmBuffer);

    const raw = await runPandocConvert(pandoc, {
      format: 'docx',
      bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    });

    assert.ok(raw.includes('\\RL{\\%}'), 'Raw pandoc output must contain \\RL{\\%}');
    const clean = cleanupLatex(raw);
    assert.ok(!clean.includes('\\RL'), 'Cleaned output must not contain \\RL');
    assert.equal(clean.trim(), 'Gran 65.8\\%');
  });
});

