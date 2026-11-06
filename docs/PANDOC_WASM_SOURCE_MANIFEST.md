# Pandoc WebAssembly (pandoc.wasm) Corresponding-Source Manifest

**Document Version:** 1.0 (Compliance Deliverable for Word to LaTeX v1.0.6)<br>
**Status:** Review-Only Internal Audit Deliverable (Not Published)<br>
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

| Property | Value |
| :--- | :--- |
| **Source Archive** | `pandoc-3.10.tar.gz` |
| **Exact Byte Size** | 8,759,054 bytes |
| **SHA-256 Checksum** | `fc82815542c29802d087c25e2c1421146030806b71255ec40fc0e828fe1df877` |
| **Source Repository** | <https://github.com/jgm/pandoc> |
| **Release Archive URL** | <https://github.com/jgm/pandoc/archive/refs/tags/3.10.tar.gz> |
| **Hackage Mirror URL** | <https://hackage.haskell.org/package/pandoc-3.10/pandoc-3.10.tar.gz> |

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

| Channel | Delivery Format | GPLv2 Section 3 Mechanism | Compliance Evaluation & Requirements |
| :--- | :--- | :--- | :--- |
| **GitHub Releases** *(if used)* | `word-to-latex-offline-1.0.6.zip` | Section 3 (paragraph 5) — Equivalent Network Access | **Fully Compliant**: Host `pandoc-3.10-corresponding-source.tar.gz` as a release asset alongside the binary `.zip`. Satisfies access from the designated place directly without written offer overhead. |
| **ExtensionGuy Website** | `pandoc.wasm.gz` via HTTP GET | Section 3 (paragraph 5) — Equivalent Network Access | **Fully Compliant**: Host `pandoc-3.10-source.tar.gz` at `https://extensionguy.me/assets/wasm/` alongside existing `assets/wasm/LICENSE.txt`. Satisfies equivalent access from the designated web host. |
| **Microsoft Edge Add-ons** | Extension package (.zip) installed via Edge store | Section 3(a) or 3(b) or Network Reference in Notices | Store does not host standalone source files. Extension now bundles `LICENSE` and `THIRD_PARTY_NOTICES.md` with exact source URLs. Activating a binding 3(b) written offer requires owner authorization. |
| **Chrome Web Store** | Extension package (.crx) installed via Chrome store | Section 3(a) or 3(b) or Network Reference in Notices | Store does not host standalone source files. Same posture as Edge Add-ons. |

---

## 5. Review Archive Inventory

The review-only corresponding-source bundle `pandoc-3.10-corresponding-source.tar.gz` staged in the scratch area contains:

1. `pandoc-3.10/` (Full Haskell source tree, 20 subdirectories, 42 source files)
2. `pandoc-3.10/cabal.project` (WASM cross-compilation constraints & dependency overrides)
3. `pandoc-3.10/flake.nix` & `pandoc-3.10/flake.lock` (Complete Nix toolchain environment lock)
4. `pandoc-3.10/Makefile` (Target `pandoc.wasm`)
5. `pandoc-3.10/wasm/patches/` (6 patches for transitive dependencies)
6. `pandoc-3.10/COPYING.md` (Verbatim GNU General Public License v2)
7. `pandoc-3.10/COPYRIGHT` (Full third-party Haskell library copyright and author index)
