import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';
import { parseOcrToLatex } from '../src/imageOcr/mathParser.ts';
import { detectAndParseTable } from '../src/imageOcr/tableParser.ts';

const fixturesDir = path.resolve('tests/fixtures/real');

const testCases = [
  { id: 'case_01_pythagoras', name: 'x^2 + y^2 = z^2', expected: 'x^2 + y^2 = z^2' },
  { id: 'case_02_fraction', name: '(a+b)/c', expected: '\\frac{a + b}{c}' },
  { id: 'case_03_sqrt', name: 'sqrt(x^2 + 1)', expected: '\\sqrt{x^2 + 1}' },
  { id: 'case_04_integral', name: '∫_0^1 x^2 dx', expected: '\\int_{0}^{1} x^2 dx' },
  { id: 'case_05_summation', name: 'Σ_{i=1}^n i', expected: '\\sum_{i=1}^{n} i' },
  { id: 'case_06_matrix', name: '2x2 matrix', expected: '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}' },
  { id: 'case_07_system', name: 'system of equations', expected: '\\begin{cases} 2x + y = 5 \\\\ x - 3y = 2 \\end{cases}' },
  { id: 'case_08_french_math', name: 'French paragraph with math', expected: 'Soit f une fonction... I = \\int...' },
  { id: 'case_09_french_accents', name: 'French accents é è à ç œ ù', expected: 'é, è, à, ç, œ, ù... élève... où...' },
  { id: 'case_10_table_math', name: 'Table with math', expected: '\\begin{tabular} ... f(x) = x^2 ... \\end{tabular}' },
];

async function runEvaluation() {
  console.log('--- Initializing Tesseract Worker (eng+fra+equ) ---');
  const worker = await createWorker(['eng', 'fra', 'equ'], 1, {
    cacheMethod: 'none',
    gzip: false,
    langPath: 'assets/tessdata',
  });

  const report = [];

  for (const tc of testCases) {
    const imgPath = path.join(fixturesDir, `${tc.id}.png`);
    const buffer = fs.readFileSync(imgPath);

    const res = await worker.recognize(buffer);
    const rawText = res.data.text.trim();
    const confidence = res.data.confidence;

    const ocrData = {
      text: res.data.text,
      confidence: res.data.confidence,
      lines: res.data.lines?.map(l => ({
        text: l.text,
        confidence: l.confidence,
      })),
    };

    const tableCheck = detectAndParseTable(ocrData);
    let parsedLatex = '';
    if (tableCheck.isTable && tableCheck.latex) {
      parsedLatex = tableCheck.latex;
    } else {
      parsedLatex = parseOcrToLatex(ocrData);
    }

    report.push({
      id: tc.id,
      name: tc.name,
      expected: tc.expected,
      confidence: Math.round(confidence),
      rawText: rawText.replace(/\n+/g, ' \\n '),
      parsedLatex: parsedLatex.replace(/\n+/g, ' \\n '),
    });
  }

  await worker.terminate();

  console.log('\n=== REAL FIXTURE EVALUATION RESULTS ===\n');
  for (const r of report) {
    console.log(`[${r.id}] ${r.name}`);
    console.log(`  Confidence : ${r.confidence}%`);
    console.log(`  Expected   : ${r.expected}`);
    console.log(`  Raw OCR    : ${r.rawText}`);
    console.log(`  Parsed LaTeX: ${r.parsedLatex}`);
    console.log('--------------------------------------------------');
  }

  fs.writeFileSync('benchmark_results.json', JSON.stringify(report, null, 2));
}

runEvaluation().catch(console.error);
