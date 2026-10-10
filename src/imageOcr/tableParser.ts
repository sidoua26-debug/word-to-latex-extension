/**
 * tableParser.ts — Detects and converts tabular structures from OCR text and bounding boxes.
 * Produces standard LaTeX tabular/longtable environments with booktabs styling.
 */

import type { OcrResultData } from './mathParser.ts';

export interface TableDetectionResult {
  isTable: boolean;
  latex?: string;
}

interface Segment {
  text: string;
  start: number;
  end: number;
}

function getLineSegments(line: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /\S(?:.*?\S)?(?=\s{2,}|\t|$)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    const text = match[0].trim();
    if (text.length > 0) {
      segments.push({
        text,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  return segments;
}

function parsePipeLine(line: string, numCols?: number): string[] {
  const trimmed = line.trim();
  if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 1) {
    const inner = trimmed.slice(1, -1);
    return inner.split('|').map(c => c.trim());
  }

  const rawCells = line.split('|').map(c => c.trim());
  if (numCols !== undefined) {
    if (rawCells.length === numCols) {
      return rawCells;
    }
    if (trimmed.startsWith('|') && rawCells.length === numCols + 1 && rawCells[0] === '') {
      return rawCells.slice(1);
    }
    if (trimmed.endsWith('|') && rawCells.length === numCols + 1 && rawCells[rawCells.length - 1] === '') {
      return rawCells.slice(0, -1);
    }
  }

  let cells = rawCells;
  if (trimmed.startsWith('|') && cells.length > 1 && cells[0] === '') {
    cells = cells.slice(1);
  }
  if (trimmed.endsWith('|') && cells.length > 1 && cells[cells.length - 1] === '') {
    cells = cells.slice(0, -1);
  }
  return cells;
}

/**
 * Checks if OCR output represents a table:
 * - Either has pipe delimiters (| col1 | col2 |)
 * - Or has 2+ lines with consistent tab / multi-column spacing
 */
export function detectAndParseTable(ocr: OcrResultData): TableDetectionResult {
  const rawLines = ocr.lines?.length ? ocr.lines.map(l => l.text) : ocr.text.split('\n');
  const lines = rawLines.filter(l => l.trim().length > 0);

  if (lines.length < 2) {
    return { isTable: false };
  }

  // Case 1: Explicit pipe-delimited table (e.g. Markdown or ASCII table)
  const pipeLines = lines.filter(l => l.includes('|'));
  if (pipeLines.length >= 2 && pipeLines.length >= lines.length * 0.7) {
    const rawLines = pipeLines.filter(l => !/^[\|\s\-:]+$/.test(l)); // Filter out markdown separator row |---|---|
    if (rawLines.length >= 2) {
      const headerCells = parsePipeLine(rawLines[0]);
      const numCols = headerCells.length;

      if (numCols >= 2) {
        const parsedRows = rawLines.map((line, idx) => {
          if (idx === 0) return headerCells;
          const cells = parsePipeLine(line, numCols);
          while (cells.length < numCols) cells.push('');
          if (cells.length > numCols) return cells.slice(0, numCols);
          return cells;
        });

        return {
          isTable: true,
          latex: generateLatexTable(parsedRows),
        };
      }
    }
  }

  // Case 2A: Tab-separated table
  if (lines.some(l => l.includes('\t'))) {
    const tabRows = lines.map(l => l.split('\t').map(c => c.trim()));
    const numCols = Math.max(...tabRows.map(r => r.length));
    if (numCols >= 2 && tabRows.length >= 2 && tabRows.length <= 50) {
      const normalizedRows = tabRows.map(row => {
        const padded = [...row];
        while (padded.length < numCols) padded.push('');
        return padded;
      });
      return {
        isTable: true,
        latex: generateLatexTable(normalizedRows),
      };
    }
  }

  // Case 2B: Multi-column space-aligned text
  const lineSegments = lines.map(getLineSegments);
  const maxSegs = Math.max(...lineSegments.map(s => s.length));
  const multiColLines = lineSegments.filter(s => s.length >= 2);

  if (maxSegs >= 2 && multiColLines.length >= 2 && multiColLines.length >= lines.length * 0.5 && lines.length <= 50) {
    const fullLines = lineSegments.filter(s => s.length === maxSegs);
    const boundaries: number[] = [];
    for (let c = 0; c < maxSegs - 1; c++) {
      const colEnds = fullLines.map(s => s[c].end);
      const nextColStarts = fullLines.map(s => s[c + 1].start);
      const avgEnd = colEnds.reduce((a, b) => a + b, 0) / colEnds.length;
      const avgStart = nextColStarts.reduce((a, b) => a + b, 0) / nextColStarts.length;
      boundaries.push((avgEnd + avgStart) / 2);
    }

    const alignedRows = lineSegments.map(segments => {
      const row = new Array<string>(maxSegs).fill('');
      for (const seg of segments) {
        let colIdx = maxSegs - 1;
        for (let b = 0; b < boundaries.length; b++) {
          if (seg.start < boundaries[b]) {
            colIdx = b;
            break;
          }
        }
        row[colIdx] = row[colIdx] ? `${row[colIdx]} ${seg.text}` : seg.text;
      }
      return row;
    });

    return {
      isTable: true,
      latex: generateLatexTable(alignedRows),
    };
  }

  // Case 2C: Word-aligned grid from OCR tokens (e.g. space-separated table columns)
  if (ocr.lines && ocr.lines.length >= 2 && ocr.lines.length <= 50) {
    const wordRows = ocr.lines.map(l => (l.words?.map(w => w.text) || []).filter(Boolean));
    const numCols = wordRows[0]?.length || 0;
    if (numCols >= 2 && wordRows.every(r => r.length === numCols)) {
      // 1. Guard against numbered or bulleted lists (e.g. "1. Compute x", "2. Compute y")
      const isList = lines.some(l => /^\s*(?:\d+[\.\)]|[•\-\*])\s+/.test(l));
      if (isList) return { isTable: false };

      // 2. Guard against equations or arithmetic expressions (e.g. "x + 1", "y + 2", "a = b")
      const hasEquations = lines.some(l => /[=<>≤≥]/.test(l));
      const hasExpressions = lines.some(l => /[+\-*/^]/.test(l) && !/[a-zA-Z]{3,}/.test(l));
      if (hasEquations || hasExpressions) return { isTable: false };

      // 3. Guard against prose stopwords and instructional action verbs
      const PROSE_STOPWORDS = /\b(the|and|or|for|with|that|this|are|were|from|have|has|had|let|use|see|which|then|they|their|there|what|when|where|we|be|of|in|is|set|an|as|to|by|if|all|not|into|on|at|but|le|la|les|un|une|des|et|en|est|dans|pour|avec|sur|par|qui|que|donc|alors|tout|tous|cette|sont|voici|ce|ces|mais|ou|où|du|de|au|aux|se|sa|son|ses|soient|il|elle|ils|elles|prix|payé|payer)\b/gui;
      const MATH_ACTION_VERBS = /\b(calculer|montrer|démontrer|théorème|définition|exercice|soit|soient|supposons|considérons|vérifier|compute|solve|prove)\b/gui;

      const fullText = lines.join(' ');
      const stopwordCount = (fullText.match(PROSE_STOPWORDS) || []).length;
      const hasActionVerbs = MATH_ACTION_VERBS.test(fullText);
      if (hasActionVerbs || stopwordCount >= 2) return { isTable: false };

      // 4. Structural requirement for "numeric tabular data":
      // "Numeric tabular data" is defined as a uniform 2D token grid (>=2 columns, 2-50 rows)
      // where either:
      // (a) Header + Data: Row 0 is an alphabetic header (no digits) and at least one subsequent row
      //     contains numeric/monetary/unit data tokens matching /\d|\$|%|€|£|¥/, OR
      // (b) 3+ Data Rows: 3 or more rows where every row contains numeric/monetary tokens,
      // while strictly excluding sentence-forming stopwords (<2 in total), equations, and lists.
      const row0HasNoDigits = !/\d/.test(wordRows[0].join(''));
      const subsequentRowsHaveData = wordRows.slice(1).some(row => row.some(cell => /\d|\$|%|€|£|¥/.test(cell)));
      const isHeaderWithData = row0HasNoDigits && subsequentRowsHaveData;

      const is3PlusDataRows = wordRows.length >= 3 && wordRows.every(row => row.some(cell => /\d|\$|%|€|£|¥/.test(cell)));

      if (isHeaderWithData || is3PlusDataRows) {
        return {
          isTable: true,
          latex: generateLatexTable(wordRows),
        };
      }
    }
  }

  return { isTable: false };
}

/**
 * Generates LaTeX tabular environment with booktabs styling.
 */
function generateLatexTable(rows: string[][]): string {
  const numCols = Math.max(...rows.map(r => r.length));
  const colSpec = 'l'.repeat(numCols);

  const header = rows[0].map(c => escapeLatexCell(c)).join(' & ');
  const dataRows = rows.slice(1).map(row => {
    // Pad row if needed
    const padded = [...row];
    while (padded.length < numCols) padded.push('');
    return padded.map(c => escapeLatexCell(c)).join(' & ') + ' \\\\';
  });

  return [
    '\\begin{table}[htbp]',
    '\\centering',
    `\\begin{tabular}{${colSpec}}`,
    '\\toprule',
    `${header} \\\\`,
    '\\midrule',
    ...dataRows,
    '\\bottomrule',
    '\\end{tabular}',
    '\\end{table}',
  ].join('\n');
}

function escapeLatexCell(text: string): string {
  if (!text) return '';
  // If the cell contains math signs, wrap in $...$
  if (/[=+\-*/^_{}]/.test(text) && !text.includes('$')) {
    return `$${text}$`;
  }
  // Escape literal currency $ as \$
  return text.replace(/(?<!\\)\$/g, '\\$');
}
