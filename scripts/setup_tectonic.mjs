/**
 * setup_tectonic.mjs
 * Downloads pinned Tectonic v0.17.0 into .bin/ for Linux x86_64 or provides instructions for other OSes.
 * Dev-only tooling; the extension remains 100% offline.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BIN_DIR = path.join(ROOT, '.bin');
const TECTONIC_PATH = path.join(BIN_DIR, 'tectonic');

async function main() {
  if (fs.existsSync(TECTONIC_PATH)) {
    console.log(`✓ Tectonic is already installed at: ${TECTONIC_PATH}`);
    try {
      const ver = execSync(`${TECTONIC_PATH} --version`, { encoding: 'utf8' }).trim();
      console.log(`  Version: ${ver}`);
    } catch {}
    return;
  }

  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  const platform = os.platform();
  const arch = os.arch();

  console.log(`Detected Platform: ${platform} (${arch})`);

  if (platform === 'linux' && arch === 'x64') {
    const tarballUrl = 'https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic@0.17.0/tectonic-0.17.0-x86_64-unknown-linux-musl.tar.gz';
    const tmpTar = path.join(BIN_DIR, 'tectonic.tar.gz');

    console.log(`Downloading Tectonic 0.17.0 from ${tarballUrl}...`);
    execSync(`curl -fsSL -o "${tmpTar}" "${tarballUrl}"`);
    console.log(`Extracting into ${BIN_DIR}...`);
    execSync(`tar -xzf "${tmpTar}" -C "${BIN_DIR}"`);
    fs.unlinkSync(tmpTar);

    if (fs.existsSync(TECTONIC_PATH)) {
      fs.chmodSync(TECTONIC_PATH, 0o755);
      console.log('✓ Successfully installed Tectonic v0.17.0 into .bin/tectonic');
    } else {
      console.error('✗ Failed to extract tectonic binary.');
      process.exit(1);
    }
  } else if (platform === 'darwin') {
    console.log('\nmacOS detected. Please install Tectonic using Homebrew:');
    console.log('  brew install tectonic');
    console.log('Or download the 0.17.0 release tarball from:');
    console.log('  https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic@0.17.0\n');
  } else if (platform === 'win32') {
    console.log('\nWindows detected. Please install Tectonic using winget or scoop:');
    console.log('  winget install tectonic');
    console.log('Or download the 0.17.0 release zip from:');
    console.log('  https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic@0.17.0\n');
  } else {
    console.log(`\nUnsupported architecture for auto-download: ${platform}-${arch}.`);
    console.log('Please install Tectonic from: https://tectonic-typesetting.github.io/en-US/install.html\n');
  }
}

main().catch(err => {
  console.error('Error during Tectonic setup:', err);
  process.exit(1);
});
