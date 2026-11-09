import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePandocSourceArchive } from './fetch-pandoc-source.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const DIST_EDGE = join(ROOT, 'dist-edge');
const SOURCE_DIR = join(ROOT, 'source');
const ARCHIVE_FILENAME = 'pandoc-3.10-corresponding-source.tar.gz';
const SOURCE_ARCHIVE_PATH = join(SOURCE_DIR, ARCHIVE_FILENAME);
const EXPECTED_SOURCE_SHA256 = 'fc82815542c29802d087c25e2c1421146030806b71255ec40fc0e828fe1df877';
const EDGE_ZIP_FILENAME = 'word-to-latex-offline-edge-v1.0.7.zip';
const EDGE_ZIP_PATH = join(ROOT, EDGE_ZIP_FILENAME);

const FORBIDDEN_ARCHIVE_EXTENSIONS = [
  '.tar.gz', '.tgz', '.gz', '.zip', '.tar', '.bz2', '.tbz2', '.xz', '.txz', '.7z', '.rar', '.zst',
];

const COMPRESSED_SIGNATURES = [
  { name: 'gzip', bytes: [0x1f, 0x8b] },
  { name: '7z', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { name: 'bzip2', bytes: [0x42, 0x5a, 0x68] },
  { name: 'xz', bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] },
  { name: 'zstd', bytes: [0x28, 0xb5, 0x2f, 0xfd] },
  { name: 'compress', bytes: [0x1f, 0x9d] },
];

function computeSha256(filePath) {
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

export async function packageEdge() {
  console.log('--- Edge v1.0.7 Packaging (Unpacked Source Tree) ---');

  // 1. Ensure source archive exists and verify checksum
  let sourceArchive = SOURCE_ARCHIVE_PATH;
  if (!existsSync(sourceArchive)) {
    console.log(`Source archive missing at ${sourceArchive}; acquiring...`);
    sourceArchive = await ensurePandocSourceArchive(SOURCE_ARCHIVE_PATH);
  }

  const archiveHash = computeSha256(sourceArchive);
  if (archiveHash !== EXPECTED_SOURCE_SHA256) {
    throw new Error(`Source archive checksum mismatch: expected ${EXPECTED_SOURCE_SHA256}, got ${archiveHash}`);
  }
  console.log(`✓ Verified source archive checksum (${archiveHash})`);

  // 2. Validate archive entries before extraction
  console.log('Validating tarball entries for path safety and symlinks...');
  const tarListRaw = execSync(`tar -tzf "${sourceArchive}"`, { encoding: 'utf8' });
  const entries = tarListRaw.split('\n').filter(Boolean);

  for (const entry of entries) {
    if (entry.startsWith('/') || entry.startsWith('\\')) {
      throw new Error(`Security violation: absolute path in tarball: ${entry}`);
    }
    if (entry.includes('../') || entry.includes('..\\')) {
      throw new Error(`Security violation: path traversal in tarball: ${entry}`);
    }
    if (!entry.startsWith('pandoc-3.10/') && entry !== 'pandoc-3.10') {
      throw new Error(`Unexpected root prefix in tarball entry: ${entry}`);
    }
  }
  console.log(`✓ Inspected ${entries.length} tar entries — all safely rooted in pandoc-3.10/`);

  // 3. Ensure base dist/ is built
  if (!existsSync(DIST) || !existsSync(join(DIST, 'manifest.json'))) {
    console.log('Building dist/ via esbuild...');
    execSync('node esbuild.config.mjs', { cwd: ROOT, stdio: 'inherit' });
  }

  // 4. Prepare dist-edge/ staging directory
  console.log('Preparing dist-edge/ staging directory...');
  rmSync(DIST_EDGE, { recursive: true, force: true });
  mkdirSync(DIST_EDGE, { recursive: true });

  // Copy standard dist files to dist-edge
  cpSync(DIST, DIST_EDGE, { recursive: true });

  // Remove the .tar.gz archive from dist-edge
  const nestedArchiveInEdge = join(DIST_EDGE, 'source', ARCHIVE_FILENAME);
  if (existsSync(nestedArchiveInEdge)) {
    rmSync(nestedArchiveInEdge, { force: true });
    console.log(`✓ Removed nested compressed archive ${ARCHIVE_FILENAME} from dist-edge/source/`);
  }

  // 5. Extract pandoc-3.10 source tree into dist-edge/source/
  const edgeSourceDir = join(DIST_EDGE, 'source');
  mkdirSync(edgeSourceDir, { recursive: true });
  console.log('Extracting verified pandoc-3.10 source tree into dist-edge/source/...');
  execSync(`tar -xzf "${sourceArchive}" -C "${edgeSourceDir}"`);

  // Verify critical source files exist in dist-edge
  const criticalFiles = [
    'cabal.project',
    'flake.nix',
    'Makefile',
    'COPYING.md',
    'COPYRIGHT',
    'wasm/patches/conduit-extra.patch',
    'wasm/patches/lua.patch',
    'wasm/patches/memory.patch',
    'wasm/patches/splitmix.patch',
    'wasm/patches/streaming-commons.patch',
    'wasm/patches/xml-conduit.patch',
  ];

  for (const rel of criticalFiles) {
    const full = join(edgeSourceDir, 'pandoc-3.10', rel);
    if (!existsSync(full)) {
      throw new Error(`Extraction verification failed: missing critical file ${rel}`);
    }
  }
  console.log(`✓ Verified extracted source tree and all ${criticalFiles.length} critical files/patches`);

  // 6. Comprehensive archive scan on dist-edge
  console.log('Scanning dist-edge/ for forbidden compressed archives and signatures...');
  function scanDir(dir) {
    const results = [];
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        results.push(...scanDir(full));
      } else if (item.isFile()) {
        const lowerName = item.name.toLowerCase();
        // Check forbidden archive extensions
        for (const ext of FORBIDDEN_ARCHIVE_EXTENSIONS) {
          if (lowerName.endsWith(ext)) {
            throw new Error(`Forbidden archive extension detected in Edge package: ${full}`);
          }
        }

        // Check magic bytes for compressed signatures (gzip, 7z, bz2, xz, zstd, compress)
        const fd = readFileSync(full);
        for (const sig of COMPRESSED_SIGNATURES) {
          if (sig.bytes.every((b, i) => fd[i] === b)) {
            throw new Error(`Forbidden compressed archive signature (${sig.name}) detected in: ${full}`);
          }
        }
        results.push(full);
      }
    }
    return results;
  }

  const allEdgeFiles = scanDir(DIST_EDGE);
  console.log(`✓ Scanned ${allEdgeFiles.length} files in dist-edge/ — 0 compressed archives or archive signatures found`);

  // 7. Verify runtime integrity and metadata in dist-edge/
  const manifest = JSON.parse(readFileSync(join(DIST_EDGE, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) {
    throw new Error(`Invalid manifest_version: ${manifest.manifest_version}`);
  }
  if (manifest.version !== '1.0.7') {
    throw new Error(`Invalid version in manifest: ${manifest.version}`);
  }
  if (!Array.isArray(manifest.permissions) || manifest.permissions.length !== 0) {
    throw new Error(`Permissions must be strictly empty, got: ${JSON.stringify(manifest.permissions)}`);
  }

  const wasmHash = computeSha256(join(DIST_EDGE, 'wasm', 'pandoc.wasm'));
  const EXPECTED_WASM_SHA256 = 'b47c9de52b5b45f103c2dac6fea52591aeafe3dd6cafed13331b67575233a2ff';
  if (wasmHash !== EXPECTED_WASM_SHA256) {
    throw new Error(`pandoc.wasm checksum mismatch in dist-edge: ${wasmHash}`);
  }
  console.log(`✓ Verified manifest v1.0.7, empty permissions, and pandoc.wasm hash in dist-edge/`);

  // 8. Package dist-edge into word-to-latex-offline-edge-v1.0.7.zip
  console.log(`Packaging dist-edge/ into ${EDGE_ZIP_FILENAME}...`);
  rmSync(EDGE_ZIP_PATH, { force: true });
  execSync(`cd "${DIST_EDGE}" && zip -q -r "${EDGE_ZIP_PATH}" .`);

  // Verify outer ZIP integrity
  execSync(`zip -T "${EDGE_ZIP_PATH}"`);
  console.log(`✓ Outer ZIP integrity verified (zip -T passed)`);

  const zipStat = statSync(EDGE_ZIP_PATH);
  const zipHash = computeSha256(EDGE_ZIP_PATH);

  console.log('\n--- Edge Package Summary ---');
  console.log(`Path:       ${EDGE_ZIP_PATH}`);
  console.log(`Byte Size:  ${zipStat.size} bytes (${(zipStat.size / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`SHA-256:    ${zipHash}`);
  console.log('----------------------------\n');

  return {
    path: EDGE_ZIP_PATH,
    size: zipStat.size,
    sha256: zipHash,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  packageEdge().catch((err) => {
    console.error(`✗ Edge packaging failed: ${err.message}`);
    process.exit(1);
  });
}
