/**
 * add_real_sample.mjs — Interactive & CLI validator for local real-document benchmark samples.
 *
 * Usage:
 *   npm run corpus:add-real -- --file <path_to_image> --id <sample_id> --lang fr|en --text "<expected_text>" --labels prose,math
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CORPUS_DIR = path.join(ROOT, 'corpus');
const REAL_DIR = path.join(CORPUS_DIR, 'real');
const REAL_MANIFEST = path.join(REAL_DIR, 'manifest.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      options[key] = args[i + 1] || true;
      i++;
    }
  }
  return options;
}

function main() {
  const options = parseArgs();
  console.log('================================================================');
  console.log('REAL SAMPLE REGISTRATION & VALIDATION');
  console.log('================================================================\n');

  if (!options.file || !options.id) {
    console.log('Usage: npm run corpus:add-real -- --file <path_to_image> --id <id> --lang <fr|en> --text "<expected_text>" --labels <prose,math>');
    console.log('Example: npm run corpus:add-real -- --file ./my_scan.png --id real_exam_01 --lang fr --text "f(x) = x^2" --labels math');
    process.exit(0);
  }

  const srcFile = path.resolve(process.cwd(), options.file);
  if (!fs.existsSync(srcFile)) {
    console.error(`✗ Error: Source image not found at ${srcFile}`);
    process.exit(1);
  }

  const stat = fs.statSync(srcFile);
  if (stat.size === 0) {
    console.error('✗ Error: Source image file is empty');
    process.exit(1);
  }

  const destFilename = `${options.id}${path.extname(srcFile)}`;
  const destPath = path.join(REAL_DIR, destFilename);

  fs.copyFileSync(srcFile, destPath);
  console.log(`✓ Copied image to ${destPath}`);

  let manifest = { version: '1.0.0', description: 'Local real-document evaluation corpus', samples: [] };
  if (fs.existsSync(REAL_MANIFEST)) {
    try {
      manifest = JSON.parse(fs.readFileSync(REAL_MANIFEST, 'utf8'));
    } catch {}
  }

  const lineLabels = options.labels ? options.labels.split(',').map(s => s.trim()) : ['prose'];
  const newSample = {
    id: options.id,
    file: `real/${destFilename}`,
    set: 'dev',
    lang: options.lang || 'en',
    tags: ['real', options.lang || 'en'],
    ground_truth: {
      expected_text: options.text || '',
      expected_latex: options.latex || null,
      line_labels: lineLabels,
      expected_latex_contains: options.contains ? options.contains.split(',') : [],
      expected_latex_forbids: [],
      status: 'supported',
    },
  };

  manifest.samples = manifest.samples.filter(s => s.id !== options.id);
  manifest.samples.push(newSample);

  fs.writeFileSync(REAL_MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`✓ Registered ${options.id} in ${REAL_MANIFEST}`);
}

main();
