import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

describe('Distribution Packaging & Licensing Integrity', () => {
  it('root repository contains required candidate licensing files', () => {
    const licensePath = join(ROOT, 'LICENSE');
    const noticesPath = join(ROOT, 'THIRD_PARTY_NOTICES.md');
    const packageJsonPath = join(ROOT, 'package.json');

    assert.ok(existsSync(licensePath), 'Root LICENSE file must exist');
    assert.ok(existsSync(noticesPath), 'Root THIRD_PARTY_NOTICES.md must exist');
    assert.ok(existsSync(packageJsonPath), 'package.json must exist');

    const licenseContent = readFileSync(licensePath, 'utf8');
    assert.ok(licenseContent.includes('MIT License'), 'LICENSE must declare MIT License');
    assert.ok(
      licenseContent.includes('Copyright (c) 2026 sidoua26-debug'),
      'LICENSE must contain confirmed copyright line: Copyright (c) 2026 sidoua26-debug',
    );

    const noticesContent = readFileSync(noticesPath, 'utf8');
    assert.ok(noticesContent.includes('Project Licensing Scope & Architecture'), 'THIRD_PARTY_NOTICES must have Scope section');
    assert.ok(noticesContent.includes('GNU GENERAL PUBLIC LICENSE'), 'THIRD_PARTY_NOTICES must include GPL text');
    assert.ok(noticesContent.includes('Apache License'), 'THIRD_PARTY_NOTICES must include Apache license text');

    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    assert.equal(pkg.license, 'MIT', 'package.json must specify license: MIT');
    assert.equal(pkg.version, '1.0.7', 'package.json version must be 1.0.7');

    const srcManifestPath = join(ROOT, 'src', 'manifest.json');
    const srcManifest = JSON.parse(readFileSync(srcManifestPath, 'utf8'));
    assert.equal(srcManifest.version, '1.0.7', 'src/manifest.json version must be 1.0.7');

    const manifestPath = join(ROOT, 'docs', 'PANDOC_WASM_SOURCE_MANIFEST.md');
    assert.ok(existsSync(manifestPath), 'docs/PANDOC_WASM_SOURCE_MANIFEST.md must exist');
    const manifestContent = readFileSync(manifestPath, 'utf8');
    assert.ok(manifestContent.includes('b47c9de52b5b45f103c2dac6fea52591aeafe3dd6cafed13331b67575233a2ff'), 'Manifest must verify binary SHA-256');
    assert.ok(manifestContent.includes('9376458c26d25d222e5a898ede254ebb2f47ffbe'), 'Manifest must document upstream Git commit');
  });

  it('dist/ build output contains all required legal, license, and attribution notices', () => {
    assert.ok(existsSync(DIST), 'dist directory must exist (run npm run build first)');

    const distLicense = join(DIST, 'LICENSE');
    const distNotices = join(DIST, 'THIRD_PARTY_NOTICES.md');
    const distWorkerLicense = join(DIST, 'vendor', 'tesseract', 'worker.min.js.LICENSE.txt');

    assert.ok(existsSync(distLicense), 'dist/LICENSE must exist');
    assert.ok(existsSync(distNotices), 'dist/THIRD_PARTY_NOTICES.md must exist');
    assert.ok(existsSync(distWorkerLicense), 'dist/vendor/tesseract/worker.min.js.LICENSE.txt must exist');

    const rootLicenseContent = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
    const distLicenseContent = readFileSync(distLicense, 'utf8');
    assert.equal(distLicenseContent, rootLicenseContent, 'dist/LICENSE must match root LICENSE exactly');

    const rootNoticesContent = readFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    const distNoticesContent = readFileSync(distNotices, 'utf8');
    assert.equal(distNoticesContent, rootNoticesContent, 'dist/THIRD_PARTY_NOTICES.md must match root notices exactly');
  });

  it('dist/ contains all runtime binaries, assets, and Manifest V3 metadata', () => {
    const manifestPath = join(DIST, 'manifest.json');
    assert.ok(existsSync(manifestPath), 'dist/manifest.json must exist');

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.manifest_version, 3, 'Must be Manifest V3');
    assert.equal(manifest.version, '1.0.7', 'dist/manifest.json version must be 1.0.7');
    assert.deepEqual(manifest.permissions, [], 'Permissions must be strictly empty (offline air-gap)');

    const wasmPath = join(DIST, 'wasm', 'pandoc.wasm');
    assert.ok(existsSync(wasmPath), 'dist/wasm/pandoc.wasm must exist');
    const wasmStat = statSync(wasmPath);
    assert.ok(wasmStat.size > 50_000_000, 'pandoc.wasm must be complete official binary (~58MB)');

    const runtimeFiles = [
      'popup.html',
      'popup.css',
      'popup.js',
      'background.js',
      'vendor/tesseract/worker.min.js',
      'vendor/tesseract/tesseract-core-lstm.wasm',
      'vendor/tesseract/tesseract-core-lstm.wasm.js',
      'tessdata/eng.traineddata',
      'tessdata/fra.traineddata',
      'tessdata/equ.traineddata',
      'icons/16.png',
      'icons/32.png',
      'icons/48.png',
      'icons/128.png',
    ];

    for (const relPath of runtimeFiles) {
      assert.ok(existsSync(join(DIST, relPath)), `dist/${relPath} must exist`);
    }
  });

  it('dist/ does not include development artifacts, sourcemaps, source code, or secrets', () => {
    function scanDir(dir: string): string[] {
      const results: string[] = [];
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...scanDir(fullPath));
        } else {
          results.push(fullPath);
        }
      }
      return results;
    }

    const allDistFiles = scanDir(DIST);

    for (const file of allDistFiles) {
      assert.ok(!file.endsWith('.ts'), `dist/ must not contain TypeScript source files: ${file}`);
      assert.ok(!file.endsWith('.map'), `dist/ must not contain sourcemap files: ${file}`);
      assert.ok(!file.endsWith('.env'), `dist/ must not contain env files: ${file}`);
      assert.ok(!file.includes('.git'), `dist/ must not contain git artifacts: ${file}`);
      assert.ok(!file.includes('node_modules'), `dist/ must not contain node_modules: ${file}`);
    }
  });

  it('dist/ contains verified Pandoc 3.10 corresponding-source archive and valid contents', () => {
    const archivePath = join(DIST, 'source', 'pandoc-3.10-corresponding-source.tar.gz');
    assert.ok(existsSync(archivePath), 'dist/source/pandoc-3.10-corresponding-source.tar.gz must exist');

    const content = readFileSync(archivePath);
    const hash = createHash('sha256').update(content).digest('hex');
    assert.equal(
      hash,
      'fc82815542c29802d087c25e2c1421146030806b71255ec40fc0e828fe1df877',
      'Bundled source archive SHA-256 must match verified value',
    );
    assert.equal(statSync(archivePath).size, 8_759_054, 'Exact byte size must be 8,759,054 bytes');

    // Verify archive contents using tar
    const tarEntries = execSync(`tar -tzf "${archivePath}"`, { encoding: 'utf8' }).split('\n');
    assert.ok(tarEntries.some((e) => e.includes('pandoc-3.10/cabal.project')), 'Must include cabal.project');
    assert.ok(tarEntries.some((e) => e.includes('pandoc-3.10/flake.nix')), 'Must include flake.nix');
    assert.ok(tarEntries.some((e) => e.includes('pandoc-3.10/Makefile')), 'Must include Makefile');
    assert.ok(tarEntries.some((e) => e.includes('pandoc-3.10/wasm/patches/conduit-extra.patch')), 'Must include conduit-extra.patch');
    assert.ok(tarEntries.some((e) => e.includes('pandoc-3.10/wasm/patches/lua.patch')), 'Must include lua.patch');
    assert.ok(tarEntries.some((e) => e.includes('pandoc-3.10/wasm/patches/memory.patch')), 'Must include memory.patch');
    assert.ok(tarEntries.some((e) => e.includes('pandoc-3.10/COPYING.md')), 'Must include COPYING.md (GPLv2)');
  });
});
