# Pandoc WebAssembly (pandoc.wasm) Corresponding-Source Manifest

**Document Version:** 1.2 (Compliance Manifest for Word to LaTeX v1.0.7 Release Candidate)<br>
**Document Status:** Published (Committed to Repository Documentation)<br>
**Source Archive Status:** Locally Archived (Release Asset & Web Hosting Pending Owner Activation)<br>
**Subject Binary:** `wasm/pandoc.wasm` (Bundled in Word to LaTeX Offline extension and website)<br>
**Governing License:** GNU General Public License v2.0 or later (GPL-2.0-or-later)

---

## 1. Binary Profile & Provenance

| Property | Value |
| :--- | :--- |
| **Filename** | `pandoc.wasm` (in `dist/wasm/pandoc.wasm`) |
| **Exact Byte Size** | 58,580,800 bytes |
| **SHA-256 Checksum** | `b47c9de52b5b45f103c2dac6fea52591aeafe3dd6cafed13331b67575233a2ff` |
| **Package Origin** | Distributed via npm package `pandoc-wasm@1.1.0` (`node_modules/pandoc-wasm/src/pandoc.wasm`) |
| **Upstream Release** | Official Pandoc 3.10 release asset `pandoc-3.10.wasm.zip` |
| **Upstream Release URL** | <https://github.com/jgm/pandoc/releases/download/3.10/pandoc-3.10.wasm.zip> |
| **Upstream Tag & Commit** | Git Tag `3.10` / Commit `9376458c26d25d222e5a898ede254ebb2f47ffbe` in `jgm/pandoc` |
| **Local Modifications** | **None**. Verified bit-for-bit identical to upstream release binary. |

---

## 2. Corresponding-Source Package & Provenance

> [!NOTE]
> This manifest document is published in the public repository to disclose exact provenance, checksums, and compilation instructions. The corresponding-source archive itself (`pandoc-3.10-corresponding-source.tar.gz`) is verified and maintained in the release preparation environment; publication as a downloadable release asset or web download is pending owner activation.

| Property | Value |
| :--- | :--- |
| **Source Archive** | `pandoc-3.10-corresponding-source.tar.gz` (based on upstream `pandoc-3.10.tar.gz`) |
| **Exact Byte Size** | 8,759,054 bytes |
| **SHA-256 Checksum** | `fc82815542c29802d087c25e2c1421146030806b71255ec40fc0e828fe1df877` |
| **Source Repository** | <https://github.com/jgm/pandoc> |
| **Release Archive URL** | <https://github.com/jgm/pandoc/archive/refs/tags/3.10.tar.gz> |
| **Hackage Mirror URL** | <https://hackage.haskell.org/package/pandoc-3.10/pandoc-3.10.tar.gz> |
| **Archive Status** | Verified locally; unhosted on public distribution endpoints |
---

## 3. Build Toolchain, Configuration & Patches

Under GPLv2 Section 3, "complete source code" includes the scripts used to control compilation and installation of the executable. Upstream Pandoc 3.10 incorporates the complete WebAssembly build harness directly within its repository:

### 3.1 Toolchain Dependencies
- **Haskell WebAssembly Compiler**: `wasm32-wasi-ghc` (GHC WebAssembly backend, managed via `ghc-wasm-meta`).
- **Cabal Package Manager**: `wasm32-wasi-cabal` (Cabal 3.10+ configured for `arch(wasm32)` target).
- **WASI Sysroot / C Runtime**: WASI SDK with `-lwasi-emulated-process-clocks`, `-lwasi-emulated-signal`, and `-lsetjmp`.
- **Nix Flake Environment**: `flake.nix` in Pandoc 3.10 repository specifies:
  - `ghc-wasm-meta.url = "gitlab:haskell-wasm/ghc-wasm-meta?host=gitlab.haskell.org"`
  - `nixpkgs` and `flake-utils`.
- **Post-Link Optimizer**: Binaryen `wasm-opt` (with `-Oz` optimization flag).

### 3.2 WebAssembly Build Configuration (`cabal.project`)
In `cabal.project` (lines 14–97), `arch(wasm32)` constraints and compilation flags are formally defined:
```cabal
if arch(wasm32)
  tests: False

  package atomic-counter
    flags: +no-cmm

  package aeson
    flags: -ordered-keymap

  package crypton
    ghc-options: -optc-DARGON2_NO_THREADS

  package digest
    flags: -pkg-config

  package lua
    flags: +cross-compile
    ghc-options: -optc-mllvm
                 -optc-wasm-enable-sjlj
                 -optc-D_WASI_EMULATED_PROCESS_CLOCKS
                 -optc-D_WASI_EMULATED_SIGNAL
                 -optc-DLUA_STUB_TMPNAM
                 -optc-DLUA_STUB_TMPFILE
                 -optc-DLUA_STUB_SYSTEM

  package pandoc
    flags: +embed_data_files -http

  package pandoc-cli
    flags: +lua -repl -server
    ld-options: -lwasi-emulated-process-clocks -lwasi-emulated-signal -lsetjmp

  package pandoc-lua-engine
    flags: -repl
```

### 3.3 Upstream Source Patches (`wasm/patches/`)
To support the WebAssembly target, `cabal.project` applies 6 patches automatically via `post-checkout-command`:
1. `wasm/patches/conduit-extra.patch` (snoyberg/conduit @ `6b98f070fe`)
2. `wasm/patches/memory.patch` (jappeace/ram @ `6e49475ae7`)
3. `wasm/patches/streaming-commons.patch` (fpco/streaming-commons @ `v0.2.3.1`)
4. `wasm/patches/xml-conduit.patch` (snoyberg/xml @ `xml-conduit/1.10.1.0`)
5. `wasm/patches/splitmix.patch` (haskellari/splitmix @ `v0.1.3.2`)
6. `wasm/patches/lua.patch` (hslua/hslua @ `lua-2.3.4`)

### 3.4 Upstream Build Command (`Makefile`)
```makefile
pandoc.wasm:
	-rm $@
	wasm32-wasi-cabal update
	wasm32-wasi-cabal build pandoc-cli
ifeq ($(OPTIMIZE_WASM),1)
	wasm-opt -Oz $$(wasm32-wasi-cabal list-bin pandoc-cli | tail -1) -o $@
else
	cp "$$(wasm32-wasi-cabal list-bin pandoc-cli | tail -1)" "$@"
endif
```

---

## 4. Distribution Channels & Compliance Architecture

The following table evaluates each distribution channel against GNU General Public License v2.0 Section 3 requirements, identifying active postures, conditional paths, and channels currently lacking confirmed corresponding-source arrangements:

| Channel | Delivery Format | GPLv2 Section 3 Mechanism | Compliance Status & Requirements |
| :--- | :--- | :--- | :--- |
| **GitHub Repository** | Source code & docs via Git clone/web | Section 1 & Section 2 (source only) | **Active / Published**: Source code, build configurations, and this manifest are published under scoped MIT licensing. No pre-compiled GPL binary is tracked directly in Git history. |
| **GitHub Releases** *(if activated)* | `word-to-latex-offline-1.0.7.zip` | Section 3 (paragraph 5) — Equivalent Network Access | **Conditional (Pending Release Creation)**: If a GitHub Release is created for the binary `.zip`, hosting `pandoc-3.10-corresponding-source.tar.gz` as a release asset alongside the binary satisfies access from the designated place directly without written offer overhead. Currently no GitHub Release exists. |
| **ExtensionGuy Website** | `pandoc.wasm.gz` served via HTTP GET | Section 3 (paragraph 5) — Equivalent Network Access | **Conditional (Pending Deployment)**: When the website serves `pandoc.wasm.gz`, hosting `pandoc-3.10-corresponding-source.tar.gz` at `https://extensionguy.me/assets/wasm/` alongside the binary satisfies access from the designated web host. Currently the source archive is not deployed to `extensionguy.me`. |
| **Microsoft Edge Add-ons** | Packaged extension (.zip) containing `wasm/` and extracted `source/pandoc-3.10/` | Section 3(a) — Accompanying with Complete Corresponding Source | **Candidate Packaging Implemented (Unpacked Source Tree)**: To satisfy Microsoft Edge Partner Center validation rules prohibiting nested compressed files within extension packages, the candidate Edge package (`word-to-latex-offline-edge-v1.0.7.zip`) provides the complete verified Pandoc 3.10 source tree directly as extracted files at `source/pandoc-3.10/`. Published store package remains v1.0.6. |
| **Chrome Web Store** | Packaged extension (.crx/.zip) containing `wasm/` and bundled `source/pandoc-3.10-corresponding-source.tar.gz` | Section 3(a) — Accompanying with Complete Corresponding Source | **Submitted / Pending Review**: Uploaded v1.0.7 package (`word-to-latex-offline-v1.0.7.zip`) bundles the corresponding-source archive directly alongside `wasm/pandoc.wasm`. |

---

## 5. Review Archive Inventory & Verification

The verified corresponding-source bundle `pandoc-3.10-corresponding-source.tar.gz` (8,759,054 bytes, SHA-256 `fc82815542c29802d087c25e2c1421146030806b71255ec40fc0e828fe1df877`) contains the complete upstream Pandoc 3.10 source tree and WebAssembly build harness:

1. `pandoc-3.10/` (Full Haskell source tree, 20 subdirectories, 42 top-level and module source trees)
2. `pandoc-3.10/cabal.project` (WASM cross-compilation constraints & dependency overrides, lines 14–97)
3. `pandoc-3.10/flake.nix` & `pandoc-3.10/flake.lock` (Complete Nix toolchain environment definition)
4. `pandoc-3.10/Makefile` (WASM build target `pandoc.wasm`)
5. `pandoc-3.10/wasm/patches/` (All 6 required patches for transitive dependencies: `conduit-extra.patch`, `lua.patch`, `memory.patch`, `splitmix.patch`, `streaming-commons.patch`, `xml-conduit.patch`)
6. `pandoc-3.10/COPYING.md` (Verbatim GNU General Public License v2.0 text)
7. `pandoc-3.10/COPYRIGHT` (Full third-party Haskell library copyright and author index)

### 5.1 Verification Checklist
- [x] Exact binary hash matches upstream official Pandoc 3.10 WASM release asset bit-for-bit (`b47c9de52b5b45f103c2dac6fea52591aeafe3dd6cafed13331b67575233a2ff`).
- [x] Source archive SHA-256 matches verified upstream release tarball (`fc82815542c29802d087c25e2c1421146030806b71255ec40fc0e828fe1df877`).
- [x] All 6 WASM patches and Nix/Cabal build configurations present and intact.
- [x] Build system updated to bundle source archive at `dist/source/pandoc-3.10-corresponding-source.tar.gz` with mandatory SHA-256 validation.
- [x] Packaging regression tests in `tests/distributionPackaging.test.ts` verify archive bundling, hash, and contents.
- [ ] Source archive deployed to public web or release hosting (pending owner authorization).
- [ ] Updated package submitted to Chrome Web Store and Microsoft Edge Add-ons (pending owner decision).
