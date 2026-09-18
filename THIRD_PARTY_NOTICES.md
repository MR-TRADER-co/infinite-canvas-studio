# Third-Party Notices

This file records what SHIPS in the application bundle and under which
licence (فاز M2 — A.2.5's binding requirement).

## ffmpeg.wasm (the offline video converter)

- **Packages**: `@ffmpeg/ffmpeg@0.12.15` (MIT — the JS wrapper),
  `@ffmpeg/util@0.12.2` (MIT — the blob/URL helpers),
  `@ffmpeg/core@0.12.10` (**GPL-2.0-or-later** — the SINGLE-THREADED
  wasm core).
- **What ships**: the wrapper is bundled by the app bundler; the core
  (`ffmpeg-core.js` + `ffmpeg-core.wasm`, ≈ 32 MB) is copied VERBATIM
  into the app resources at `public/ffmpeg/` and lazy-loaded from
  there on the first conversion request — never fetched from a CDN
  (A.2.5).
- **Why GPL**: the wasm core is built with libx264 (GPL) among other
  GPL components, so the build is GPL-2.0-or-later. The application
  loads it as a SEPARATE program over a dynamic interface (blob URLs),
  and the core is distributed unmodified; consult counsel for your own
  distribution obligations. The single-threaded core is used
  deliberately (the multi-threaded core would require
  SharedArrayBuffer + COOP/COEP headers that conflict with the Tauri
  asset protocol — DECISIONS #58).
- **Source**: https://github.com/ffmpegwasm/ffmpeg.wasm
- **ffmpeg itself**: https://ffmpeg.org — LGPL/GPL per build; the wasm
  core build carries the licence notice above.

## MP3 encoding (libmp3lame) — the offline AUDIO converter (فاز A2)

- The SAME single-threaded `@ffmpeg/core@0.12.10` wasm build that powers
  the video converter performs the audio conversions (MP3 output via the
  bundled **libmp3lame**, 128 kbps). The core build's GPL-2.0-or-later
  licence notice above therefore covers the MP3 encoder too — the build
  links GPL components (libx264 among them, and lame for this path).
- No additional package, CDN fetch or second core instance is involved:
  the audio path requests the EXISTING lazy-loaded engine
  (`VideoConverter.ensureLoaded()`), exactly as PART A demands.

## pdf.js (the PDF poster renderer + the floating viewer)

- **Package**: `pdfjs-dist@6.3.289` (**Apache-2.0**).
- **What ships**: the main library is bundled by the app bundler
  (lazy-imported on the first poster render or viewer open); the
  worker (`pdf.worker.min.mjs`, ≈ 1.3 MB), the CMaps (`cmaps/`,
  ≈ 1.7 MB — required for Persian CID-keyed fonts) and the standard
  fonts (`standard_fonts/`, ≈ 0.8 MB) are copied VERBATIM into the app
  resources at `public/pdfjs/` and served same-origin — never a CDN
  byte (A.2.5). The Tauri asset protocol serves the same files.
- **Inlined CSS**: pdf.js's text-layer rules (the
  `.pdf-text-layer` core of `pdf_viewer.css`) are inlined in
  `src/app/globals.css` — same licence, same file count.
- **Source**: https://github.com/mozilla/pdf.js — Apache License 2.0.
