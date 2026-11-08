import { createHash } from 'node:crypto';
import dns from 'node:dns';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, copyFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

dns.setDefaultResultOrder('ipv4first');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE_DIR = join(ROOT, 'source');
const ARCHIVE_FILENAME = 'pandoc-3.10-corresponding-source.tar.gz';
const TARGET_PATH = join(SOURCE_DIR, ARCHIVE_FILENAME);

export const EXPECTED_SHA256 = 'fc82815542c29802d087c25e2c1421146030806b71255ec40fc0e828fe1df877';
export const EXPECTED_BYTE_SIZE = 8759054;
export const UPSTREAM_URL = process.env.PANDOC_UPSTREAM_URL || 'https://github.com/jgm/pandoc/archive/refs/tags/3.10.tar.gz';

export function computeSha256(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export async function ensurePandocSourceArchive(targetPath = TARGET_PATH) {
  const targetDir = dirname(targetPath);
  mkdirSync(targetDir, { recursive: true });

  // 1. Check if already cached with valid checksum
  if (existsSync(targetPath)) {
    const existingSha256 = computeSha256(targetPath);
    if (existingSha256 === EXPECTED_SHA256) {
      console.log(`✓ Using verified cached ${ARCHIVE_FILENAME} (SHA-256: ${existingSha256})`);
      return targetPath;
    }
    console.warn(`! Checksum mismatch on cached file at ${targetPath}: expected ${EXPECTED_SHA256}, got ${existingSha256}. Re-acquiring...`);
    rmSync(targetPath, { force: true });
  }

  // 2. Check explicit environment override if provided
  if (process.env.PANDOC_SOURCE_ARCHIVE && existsSync(process.env.PANDOC_SOURCE_ARCHIVE)) {
    const overridePath = process.env.PANDOC_SOURCE_ARCHIVE;
    const overrideSha256 = computeSha256(overridePath);
    if (overrideSha256 === EXPECTED_SHA256) {
      copyFileSync(overridePath, targetPath);
      console.log(`✓ Copied verified archive from PANDOC_SOURCE_ARCHIVE (SHA-256: ${overrideSha256})`);
      return targetPath;
    } else {
      throw new Error(`Checksum mismatch on PANDOC_SOURCE_ARCHIVE (${overridePath}): expected ${EXPECTED_SHA256}, got ${overrideSha256}`);
    }
  }

  // 3. Acquire from upstream URL
  const tmpPath = `${targetPath}.tmp.${Date.now()}`;
  console.log(`Acquiring Pandoc 3.10 source archive from ${UPSTREAM_URL}...`);

  try {
    const response = await fetch(UPSTREAM_URL, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    if (!response.body) {
      throw new Error('Response body is empty');
    }

    const fileStream = createWriteStream(tmpPath);
    await pipeline(response.body, fileStream);

    // Verify downloaded file integrity before moving to final target
    const downloadedSha256 = computeSha256(tmpPath);
    if (downloadedSha256 !== EXPECTED_SHA256) {
      throw new Error(`Checksum verification failed! Expected ${EXPECTED_SHA256}, got ${downloadedSha256}`);
    }

    renameSync(tmpPath, targetPath);
    console.log(`✓ Successfully acquired and verified ${ARCHIVE_FILENAME} (SHA-256: ${downloadedSha256})`);
    return targetPath;
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw new Error(`Failed to acquire verified Pandoc 3.10 source archive: ${err.message}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ensurePandocSourceArchive().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
