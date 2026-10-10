import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, 'dist');
const SRC = join(__dirname, 'src');
const ASSETS = join(__dirname, 'assets');
const NODE_MODULES = join(__dirname, 'node_modules');

// Ensure dist directory exists
mkdirSync(DIST, { recursive: true });

// Plugin to allow importing unexported core.js from pandoc-wasm
const pandocWasmCorePlugin = {
  name: 'pandoc-wasm-core',
  setup(build) {
    build.onResolve({ filter: /^pandoc-wasm\/src\/core\.js$/ }, () => ({
      path: join(NODE_MODULES, 'pandoc-wasm', 'src', 'core.js'),
    }));
  },
};

// 1. Bundle popup.ts -> dist/popup.js (IIFE bundle containing popup logic, WASI shim, core pandoc logic, and cleanup)
await esbuild.build({
  entryPoints: [join(SRC, 'popup.ts')],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outfile: join(DIST, 'popup.js'),
  sourcemap: false,
  minify: false, // Keep readable for Chrome/Edge Store review
  plugins: [pandocWasmCorePlugin],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});
console.log('✓ Bundled popup.js');

// 1b. Bundle background.ts -> dist/background.js
await esbuild.build({
  entryPoints: [join(SRC, 'background.ts')],
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outfile: join(DIST, 'background.js'),
  minify: false,
});
console.log('✓ Bundled background.js');

// 2. Copy static assets from src/ to dist/
const staticFiles = ['popup.html', 'popup.css', 'manifest.json'];
for (const file of staticFiles) {
  const srcPath = join(SRC, file);
  if (existsSync(srcPath)) {
    cpSync(srcPath, join(DIST, file));
    console.log(`✓ Copied ${file}`);
  }
}

// 3. Copy icons from assets/icons/ to dist/icons/
const iconsSrcDir = join(ASSETS, 'icons');
const iconsDestDir = join(DIST, 'icons');
if (existsSync(iconsSrcDir)) {
  mkdirSync(iconsDestDir, { recursive: true });
  cpSync(iconsSrcDir, iconsDestDir, { recursive: true });
  console.log('✓ Copied icons to dist/icons/');
}

// 4. Copy official pandoc.wasm binary into dist/wasm/
const wasmSrc = join(NODE_MODULES, 'pandoc-wasm', 'src', 'pandoc.wasm');
const wasmDestDir = join(DIST, 'wasm');
const wasmDest = join(wasmDestDir, 'pandoc.wasm');

if (existsSync(wasmSrc)) {
  mkdirSync(wasmDestDir, { recursive: true });
  cpSync(wasmSrc, wasmDest);
  console.log('✓ Bundled pandoc.wasm to dist/wasm/pandoc.wasm');
} else {
  console.error('✗ pandoc.wasm not found in node_modules/pandoc-wasm/src/ — please run npm install');
  process.exit(1);
}

// 5. Copy Tesseract worker and WASM into dist/vendor/tesseract/
const tesseractVendorDest = join(DIST, 'vendor', 'tesseract');
mkdirSync(tesseractVendorDest, { recursive: true });

const tesseractWorkerSrc = join(NODE_MODULES, 'tesseract.js', 'dist', 'worker.min.js');
if (existsSync(tesseractWorkerSrc)) {
  cpSync(tesseractWorkerSrc, join(tesseractVendorDest, 'worker.min.js'));
}

const tesseractCoreFiles = [
  'tesseract-core-lstm.wasm',
  'tesseract-core-lstm.wasm.js',
];
for (const file of tesseractCoreFiles) {
  const src = join(NODE_MODULES, 'tesseract.js-core', file);
  if (existsSync(src)) {
    cpSync(src, join(tesseractVendorDest, file));
  }
}
console.log('✓ Bundled active Tesseract worker & WASM core to dist/vendor/tesseract/');

// 6. Copy offline tessdata models into dist/tessdata/
const tessdataSrc = join(ASSETS, 'tessdata');
const tessdataDest = join(DIST, 'tessdata');
if (existsSync(tessdataSrc)) {
  mkdirSync(tessdataDest, { recursive: true });
  cpSync(tessdataSrc, tessdataDest, { recursive: true });
  console.log('✓ Bundled offline traineddata to dist/tessdata/');
}

console.log('✓ Build complete → dist/');
