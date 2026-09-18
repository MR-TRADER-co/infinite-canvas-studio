## [1.48.5] — Author attribution + the in-app About section «گیت‌هاب» (2026-09-19)

> The public-release identity pass: the project now carries its author
> everywhere GitHub, the Windows installer and end users look (LICENSE,
> package metadata, the installer's Manufacturer, README, and a new
> Settings → «درباره» section) — and a user who hits a problem is one
> confirmed click away from the repository (the latest release + issue
> reports).

### Added

- **Settings → «درباره» (About)** — a sixth settings section through the
  registry seam (zero dialog-code edits, AC8.3): app version (reuses the
  status-bar string), author, licence and the GitHub repository row.
  The link follows the app's R3B.3 flow: `requestOpenLinkConfirmation`
  → the Persian confirmation naming the URL → the OS default browser
  (the app itself never makes network calls).
- `src/ui/settings/about.ts` — the single source of truth for the
  repository URL (`APP_GITHUB_URL`) and the section id
  (`ABOUT_SECTION_ID`).
- i18n: 9 new `settings.about.*` keys (fa + en, key-stable).
- `package.json` metadata: `author`, `repository`, `homepage`, `bugs`.
- `tauri.conf.json` `bundle.publisher` — surfaces as the Manufacturer
  in the Windows installer / Add/Remove Programs.
- `tests/ui/settings/aboutSection.test.ts` (7 tests) — the identity
  guards: URL/section-id constants, both dictionaries complete, the
  registration wiring, the R3B.3-only open path, the attribution
  consistency (LICENSE/package/tauri/README/i18n), and the version-sync
  regression guard (the 1.48.3 drift class can no longer recur).

### Changed

- `LICENSE` copyright holder → **MR-TRADER-co**.
- Version strings synced 1.48.4 → **1.48.5** (package.json,
  tauri.conf.json, fa/en `status.version`, README + USER_GUIDE
  installer names). README/USER_GUIDE now credit the author and link
  the repository.

### Verified

- `tsc --noEmit` clean; eslint clean on the changed files; full suite
  **219 files / 2451 tests PASS** (+7).

## [1.48.4] — Project license «MIT» (2026-09-18)

> No behavior changes — adds the top-level `LICENSE` so the public repo
> is legally contributable. Without a license, the copyright default
> (all rights reserved) blocks any legal use/modification/redistribution
> of the code by others — the opposite of the project's goal of inviting
> developer contributions.

### Added

- **`LICENSE`** — standard MIT text (copyright «Infinite Canvas Studio
  Contributors»). The project's own code is MIT-licensed; the bundled
  third-party engines keep their own notices (`THIRD_PARTY_NOTICES.md`:
  pdf.js Apache-2.0, ffmpeg.wasm core GPL-2.0-or-later, Vazirmatn OFL).
- `package.json` now declares `"license": "MIT"` (parsed by GitHub/npm
  tooling; `private: true` stays to prevent accidental npm publishing).
- README «اعتبارها و مجوزها» section now leads with the project's own
  MIT license line (fa) + a one-line mention in the English blurb.

### Changed

- Version strings synced 1.48.3 → **1.48.4** (`package.json`,
  `tauri.conf.json`, fa/en `status.version`, README + USER_GUIDE
  installer names — the NSIS output filename follows the new version).

### Verified

- `tsc --noEmit` clean; eslint clean on the changed source files; full
  suite **218 files / 2444 tests PASS**. (`prettier --check` on the two
  i18n dictionaries was already failing at HEAD — pre-existing,
  value-only edits changed nothing there; not part of the gate.)

## [1.48.3] — Documentation suite + GitHub-ready packaging «انتشار عمومی» (2026-09-18)

> No behavior changes — this release makes the project public-ready:
> full user/developer documentation, refreshed README (GitHub landing),
> a complete `.gitignore`, and the version string finally surfaced in
> the status bar synced with `package.json`/`tauri.conf.json`.

### Added — the docs suite (`docs/`)

- **`USER_GUIDE.md`** — the complete Persian user guide: every UI
  surface walked step-by-step (tools, rich text + tables, media +
  floating viewers, knowledge layer, panels, saving/versioning, all
  five exports, presentation, plugins, automations, settings) plus the
  full keyboard-shortcut tables extracted from the command catalog.
- **`FEATURES.md`** — project description + every feature catalogued
  by area with its introducing phase and test status; includes the
  verification matrix for this release (2444 tests green + a fresh
  live-UI pass, 12 screenshots, zero console errors).
- **`TECHNICAL_MAP.md`** — the detailed developer map: annotated
  directory tree, the four core data-flow pipelines, the registry
  table, a "want to change X → edit these files" routing table, the
  desktop twin contract, testing/tooling commands, twelve documented
  landmines (pointer capture, CSSOM `inset` trap, pdf.js v6 text-layer
  contract, …), and the PR checklist.

### Changed

- **README.md** rewritten as the GitHub landing page: current feature
  set (v1.48.x), docs index, build commands with the real installer
  name, folder map, contribution essentials, English quick start.
- `.gitignore` extended for the public repo: `.qa/` (local E2E
  evidence), `phase-changed/` + `PHASE-CHANGES.txt` (phase delivery
  subsets), root `worklog.md`, `scripts/desktop-sim/sim-data/`.
- `status.version` i18n strings (fa/en) updated 1.46.0 → **1.48.3**
  to match `package.json`/`tauri.conf.json` (was stale since A2).

### Verified

- `tsc --noEmit` clean; full suite **218 files / 2444 tests PASS**
  (re-run after the doc edits); i18n value changes are key-stable
  (`TranslationKey` derives from keys, not values).
- Live UI pass (web shell, Chromium): boot → object creation (sticky/
  text/shape) → panels → palette (Ctrl+K) → project menu → settings →
  sticker library (Ctrl+Shift+K) → presentation (F5) → PDF dialog
  import → dblclick opens the viewer ON-SCREEN (507 text spans) →
  drag-select Persian text (7 chars) → × closes → context menu → theme
  toggle — screenshots in `.qa/github-docs/`, zero console errors.

## [1.48.2] — Fix round 2: the PDF viewer speaks Persian — selectable, aligned text «دورهٔ اصلاح ۲» (2026-09-18)

> The second exe test round (user report): the floating PDF viewer now
> OPENS (fix1), but «متن فارسی به‌هم‌ریخته است و قابل انتخاب نیست» —
> the Persian text looks garbled and cannot be selected. Root cause: the
> inlined `.pdf-text-layer` CSS predated pdf.js v6's custom-property
> CONTRACT, so the text layer's geometry and hit boxes were never wired
> to the real page metrics. Fixed by porting the reference viewer's
> contract + its full selection machinery (and verified against a
> reference harness built on pdf.js's own pdf_viewer.css).

### Fixed — the two user-visible symptoms

- **«متن به‌هم‌ریخته»** (selection highlights landed beside the text):
  pdf.js v6's `TextLayer` sizes its box through
  `round(down, var(--total-scale-factor) * …)` and positions every span
  through `font-size: calc(var(--text-scale-factor) *
  var(--font-height))` + a measured `scaleX` transform. The old CSS
  declared none of that: the layer's box resolved against an unset
  variable (invalid at computed-value time) and drifted up to ~24px off
  the canvas, while spans kept the inherited ~16px font size. Every
  highlight therefore painted beside/over the wrong glyphs. The new
  `.pdf-text-layer` block is a faithful v6 port of pdf_viewer.css's
  `.textLayer` (bridge `--scale-factor` → `--total-scale-factor`, the
  `--scale-round-x/y` quanta, the per-span font-size/transform rules,
  `.markedContent { display: contents }`, explicit `user-select: text`,
  LTR containment) — pixel-verified: the layer's box now equals the
  canvas EXACTLY and the measured selection band lands on the selected
  glyph run.
- **«قابل سلکت نیست»** (drags selected nothing): with 16px hit boxes
  scattered over ~21px text lines, drags landed in the gaps. With the
  contract restored, a drag that starts on a text run selects the full
  run and everything crossed (E2E: 452 chars, reference parity), and
  thanks to the new endOfContent bridge a drag past the last run
  extends to the end of the page (E2E: 716 chars).

### Added — the reference viewer's selection machinery (ported)

- New `src/ui/player/textLayerSelection.ts` — a faithful port of
  pdf.js's TextLayerBuilder selection UX: the `.endOfContent` bridge +
  its CSS (`.pdf-text-layer .endOfContent` rules in globals.css), the
  `selecting` state machine (mousedown/selectionchange/pointerup/
  blur/keyup), and the `copy` handler that runs the selection through
  `normalizeUnicode` + `removeNullCharacters` — so Ctrl+C from a
  shaped-script PDF pastes base Persian letters instead of raw
  presentation-form glyphs (the fold covers BOTH Arabic presentation
  blocks, U+FB50–FDFF and U+FE70–FEFF — pdf.js itself folds only a
  narrow subset). Also ports the pre-Chromium-148 "moving endOfContent"
  workaround, guarded the same way.
- New CSS-contract regression tests (tests/ui/player/pdfTextLayerCss.test.ts)
  pin every piece of the v6 contract to globals.css — the exact class
  of bug this round shipped with can no longer slip through silently.
- The selection color is now a valid `color-mix` (the old
  `hsl(var(--primary) / 0.35)` wrapped an oklch() value inside hsl() —
  invalid at computed-value time, silently falling back to the UA
  default).

### Notes

- Parity with the reference viewer (verified on a harness built on
  pdf.js's own pdf_viewer.css): drags that START on empty space
  between text runs still select nothing — generic Chromium behavior
  for absolutely-positioned text; pdf.js's own viewer behaves the
  same. Start the drag on the text.
- PDFs whose text stream is VISUAL-order (Chrome print-to-PDF exports)
  copy as visual-order letters even in the reference viewer; PDFs from
  Word/InDesign (logical order) copy cleanly.
- Desktop-sim E2E (the exe environment, Vite bundle + icbasset twin):
  geometry parity at DPR 1 AND 2, span-start drag, drag-past-end,
  copy normalization, page re-render rebinding, × close regression.
  Web-shell E2E: identical results (the defect was never exe-specific).

## [1.48.1] — Fix round 1: the floating windows actually close + the PDF viewer actually appears «دورهٔ اصلاح ۱» (2026-09-18)

> The first exe test round (user report): the video/audio players could
> not be closed by their × button, and double-clicking a PDF "did
> nothing". Both were browser-agnostic bugs that the web E2E had never
> pinned down (Esc always worked; the viewer's DOM was verified but never
> its on-screen position) — plus two sibling defects found and fixed in
> the same components.

### Fixed — the four defects

- **The × close buttons (video/audio/PDF windows)**: the title-bar drag
  captures the pointer ON THE BAR; per the Pointer Events spec the
  following pointerup retargets to the capture element and the `click`
  fires on the nearest common inclusive ancestor — the bar — so the
  button's `onClick` never ran. New `src/ui/player/titleBarDrag.ts`
  (`isInteractiveTitleBarTarget`): a pointerdown that starts on an
  interactive descendant (button/input/link/menu…) simply never starts
  the drag, keeping the child's native click. Wired into all three
  windows' `onTitlePointerDown`.
- **The PDF viewer rendering OFF-SCREEN** (why double-click "did
  nothing"): the dialog's inline style ended with `position: "fixed",
  inset: "auto"` — the CSSOM shorthand `inset` re-assigns
  top/right/bottom/left AFTER the explicit `left`/`top` keys, wiping
  them to `auto`; a fixed box with all offsets auto renders at its
  STATIC flow position (below the app content — fully off-screen). The
  viewer was mounting, loading and rendering its text layer invisibly.
  The window now matches the video/audio players' proven pattern
  exactly (`fixed` class + left/top only), and the FULLSCREEN branch
  owns `inset-0 h-full w-full` (which the old base class had silently
  dropped for the non-fullscreen case).
- **First-drag teleport**: with the persisted x/y still the 0/0
  "centre me" sentinel, the drag origin was read from the SENTINEL —
  the first drag moved the window to the raw delta instead of moving it
  from where it was displayed. All three windows now keep a
  `displayedPosRef` of the last rendered position and use it as the
  origin while the sentinel is active.
- **Explorer drag-and-drop in the exe**: Tauri 2's `dragDropEnabled`
  defaults to true, which makes the WebView intercept OS file drops —
  the HTML5 `drop` events the import funnel listens for never fired
  inside the exe. The main window now sets `"dragDropEnabled": false`,
  restoring the drop funnel (verified end-to-end in the simulation).

### Added

- **`tests/ui/player/titleBarDrag.test.ts`** (7 tests): the interactive
  guard — button/SVG-glyph skip, bar-chrome drag, foreign subtrees, and
  non-element targets.
- **`scripts/desktop-sim/server.js`** (verification harness, not shipped
  code): serves the VITE desktop bundle with an injected
  `__TAURI_INTERNALS__` shim (convertFileSrc/invoke/transformCallback)
  plus Node twins of the `icbasset` protocol and the asset IPC commands
  — the desktop code paths (chunked writes → hash URLs → fetch →
  viewer/player) are E2E-verifiable without a Windows build.

### Verified

- Web E2E (agent-browser, Next dev): import PDF → dblclick → the viewer
  opens ON-SCREEN at (240, 16) with a 207-span selectable text layer;
  the × buttons close all three windows; the title-bar drag moves
  windows by the exact pointer delta (no teleport); Esc unchanged.
- Desktop-sim E2E (the vite bundle + Tauri shim): boots
  `{"platform":"tauri"}`; PDF import writes the chunked IPC asset +
  poster into the inbox; the canvas poster loads through the
  `icbasset`-twin URL; dblclick → the viewer ON-SCREEN with the text
  layer; × closes; the wheel page-flip renders + stores page 2's
  poster; the video player fetches, becomes ready and closes by ×; a
  synthetic Explorer-style drop imports a PDF through the real funnel.
- Full suite + typecheck + lint on the changed files (see PHASE-CHANGES).
- Version sync: `package.json` + `tauri.conf.json` → 1.48.1.

## [1.48.0] — Phase D1: the desktop AssetStore twin — media inside the exe «دسکتاپ کامل» (2026-09-18)

> The last desktop gap closed: video/audio/PDF imports now work inside
> the Tauri exe exactly like the web shell. A new fs-backed
> `TauriAssetStore` registers behind the SAME `Services.assetStore`
> seam (3 guarded lines in the composition root — the web shell and
> its routes untouched), reading through a custom `icbasset://`
> streaming protocol and writing through chunked IPC.

### Added — Phase D1 «دسکتاپ کامل»

- **`src-tauri/src/assets.rs`** (new Rust module, ~440 lines): the
  `icbasset` custom-scheme protocol handler — hash-in-URL, the scope
  chain [project sidecar, inbox] resolved Rust-side (relocations never
  invalidate URLs), bounded 206 slices for `Range` requests (video
  seeking without whole-file buffering), explicit CORS for the
  WebView-origin `fetch` reads, immutable hash-keyed caching — plus
  three IPC commands: `asset_write_chunk` (4 MiB base64 chunks at
  absolute offsets — resumable, idempotent), `asset_exists` (scope
  chain probe) and `asset_relocate` (the A.2.1 move/copy batch with a
  cross-volume fallback). Guards mirror `serverAssets.ts`: 64-hex
  names, `.assets` sidecars, the inbox at `<appData>/media-inbox`.
- **`src/persistence/TauriAssetStore.ts`**: the fs-backed twin —
  chunked writes, sync `assetUrl` through the injected
  `__TAURI_INTERNALS__.convertFileSrc` (UA fallback mirrors wry's
  platform mapping), scope switching and the move/copy relocation
  decision, degrading to the web semantics (null/false/dashed
  placeholder) on any IPC failure.
- **`tests/persistence/TauriAssetStore.test.ts`**: 18 tests — chunk
  offsets and base64 round-trips, the sidecar/inbox scope switch, the
  A.2.1 move-vs-copy modes, URL formats (internals + both platform
  fallbacks), and every failure degradation.
- **`tsconfig.json`**: `phase-changed/` (the delivery subset) joined
  the exclude list — it is a shipping artifact, not compilable source.

### Changed

- **`src/App.ts`** (3 lines): the composition root picks
  `TauriAssetStore` when `isTauriEnvironment()` holds — everything
  downstream consumes the same `Services.assetStore` interface.
- **`src-tauri/src/lib.rs`**: `pub mod assets;` + the protocol
  registration + the three commands joined `generate_handler!` (pure
  additions; the five existing commands and the whole web flow are
  untouched).
- Version sync: `package.json` + `tauri.conf.json` → 1.48.0 (the
  installer file name now matches the release).

### Verified

- 2416/2416 tests green (215 files, +18), `tsc --noEmit` clean, ESLint
  clean on the changed files, the desktop bundle `vite build` green
  (1.9 s, dist 40 MB with pdf.js + ffmpeg + plugins + templates).
- Web-shell regression E2E re-run: PDF drop → thumbnail + badges, no
  console errors (`.qa/pdf/d1-web-regression.png`).
- Rust APIs verified against the `tauri-2.9.5` / `tauri-macros-2.6.3`
  crate sources (no Rust toolchain on this box — see DECISIONS #63).

## [1.47.0] — Phase P1 + P2: PDF documents on the canvas + the floating PDF viewer — «سند روی بوم» (2026-09-18)

> The PDF extension, both phases complete. P1: PDF files import onto
> the canvas as LIGHTWEIGHT page-thumbnail objects (a captured poster of
> the current page + the page-count badge + the PDF badge) — persisted
> through the STRICTLY REUSED hash-keyed sidecar AssetStore, rendered on
> the exact video/image draw path, exported as posters in PNG/SVG/PDF,
> with the wheel over the object flipping pages. P2: double-click opens
> a SCREEN-space floating viewer (pdf.js full DOM rendering: canvas
> visuals + a Text Layer for native text selection and Ctrl+C copy),
> with page navigation, internal zoom, fullscreen — ONE instance across
> all three floating players.

### Added — Phase P1 «سند روی بوم» (RP1.1–RP1.9)

- **`core/model/PdfObject.ts`**: the data-only object type — hashes +
  page metadata (`assetHash`, `thumbHash`, `pageCount`, `currentPage`,
  `naturalWidth/Height`, placed `width/height`), registered through the
  ObjectRegistry (`core.pdf`, typeVersion 1, catalog: group "media",
  AFTER the audio card, icon FileText) — the Insert Panel card, the
  command and the serialization all appear through the registry seams
  (§1.7.1: zero type-switch dispatch anywhere).
- **Schema v6** (`MigrationV5toV6`): the additive + normalising step
  (thumbHash coalesce, currentPage clamp) — older files load unchanged,
  the unknown-type passthrough intact.
- **`media/pdfFormats.ts`**: the pure gesture classifier (`.pdf` ext or
  `application/pdf` mime — never hijacking image/video/audio drops).
- **`media/PdfRenderer.ts`**: the pdf.js wrapper service (AppContext-
  injected) — library LAZY-LOADED, worker from the bundled
  `public/pdfjs/` assets (100% offline, the `public/ffmpeg/`
  precedent), `%PDF-` SIGNATURE verification at import (invalid files
  NEVER become objects), offscreen page posters (max 1000px, JPEG
  q0.8) with the canvas ALWAYS released, and a 2-document LRU whose
  evictions DESTROY the worker-side documents.
- **`media/PdfPageCache.ts`**: the (asset, page) → poster-hash LRU
  (~100) so flip-backs never re-render; the bitmap decode itself rides
  the SHARED PosterBitmapCache (decode-once for frames/autosave/zoom).
- **`ui/clipboard/pdfImport.ts`**: the ONE import funnel (signature →
  store → page-1 poster → commit) shared by the «درج PDF…» dialog
  (`InsertPdfDialog.tsx`), Explorer drag-and-drop and Ctrl+V paste —
  the SHARED viewport-centre + cascade placement (A.2.10), one
  AddObjectCommand per file, auto-select + the Persian notice.
- **Renderer**: `drawPdf` on the exact video draw path (poster bitmap
  or the document-glyph fallback plate), the PDF badge + the page
  badge (`۲ / ۱۰`, Persian digits through the palette formatter),
  RTL-correct corner placement, the dashed missing-asset placeholder
  + file name (RP1.6), and the page-poster preload seam so all three
  STATIC EXPORTERS (PNG/SVG/PDF) render the current page's poster in
  place — never a live PDF (RP1.8).
- **Wheel page-flip**: a plain wheel over a PDF object flips its
  `currentPage` (debounced 300ms, poster rendered on demand through
  the page cache, one undo-able UpdateObjectCommand per pause);
  modifier wheels and wheels elsewhere keep their existing behaviour.
- **Layers panel**: the DISTINCT PDF icon (FileText) + label.
- **i18n fa/en** for every new string.

### Added — Phase P2 «نمایشگر سند» (RP2.1–RP2.5)

- **`ui/player/FloatingPdfViewer.tsx`**: the SCREEN-space floating
  viewer — a React portal above every panel, NO scrim (the canvas
  stays interactive while reading), draggable + corner-resizable
  through the EXACT video/audio player mechanism (A.2.9: zero new
  dependencies), default 800×600 / min 400×500, position/size/
  internal-zoom persisted in the `pdf-viewer/v1` APP-data slot,
  ONE instance across ALL THREE floating players (opening the PDF
  viewer closes the video/audio windows and vice-versa).
- **pdf.js full DOM rendering**: the current page renders to a
  `<canvas>` layer (fit-width base scale × the internal zoom, capped
  device-pixel ratio) + pdf.js's `TextLayer` DOM overlay — native
  mouse text HIGHLIGHT SELECTION and Ctrl+C copying (Persian/English
  bidi intact), `cursor: text` over the content; image-only scans
  silently have nothing to select (Appendix P-1 fixture b).
- **The chrome** (custom, theme-aware, RTL, Vazirmatn): prev/next
  page (RTL-correct), the page input + `۳ / ۱۰` readout, zoom out/in/
  fit-width, fullscreen, close; keyboard: ←/→ pages, +/- zoom, 0
  fit-width, F fullscreen, Esc close.
- **Memory discipline**: only the CURRENT page renders (the previous
  page's DOM clears before the next), closing DESTROYS the canvas +
  text layer nodes, and a corrupt page surfaces the Persian error
  state inside the viewer — never a crash (ACP2.5).
- **Click-vs-drag discrimination**: only a clean double-click opens
  the viewer (SelectTool's pinned + main branches); drags/rotations
  never do (ACP2.9).

### Fixed

- `ObjectPatch` (UpdateObjectCommand): the additive `currentPage` +
  `thumbHash` fields — the page-flip commits ride the SAME reversible
  command seam as every other property patch.

## [1.46.0] — Phase A2: the floating audio mini-player + the offline MP3 converter — «پخش‌کنندهٔ صوت» (2026-09-17)

> The audio extension's binding PART A contract, phase A2 (the final
> phase): double-clicking an audio object opens a SCREEN-space floating
> mini-player, and every clip the browser cannot play natively (plus the
> always-convert `.wav`/`.flac` set) passes an OFFLINE conversion gate
> that turns it into an MP3 through the SAME single ffmpeg.wasm engine
> the video converter lazy-loads — never a second core, never a byte
> from the network. With A2 the audio extension is COMPLETE: import,
> persist, render, export (A1) + play and convert (A2).

### Added — the floating mini-player (RA2.1/A.2.1–A.2.3, A.2.9)

- **`ui/player/FloatingMiniPlayer.tsx`**: a React-portal window above
  every panel (NO scrim — the canvas stays interactive), draggable by
  its title bar + corner-resizable with hand-rolled pointer capture
  (the video `FloatingPlayerWindow`'s exact mechanism, zero new
  dependencies); min **320×100**, default **400×120**, **NO fullscreen**
  (audio only). The clip is fetched ONCE into a blob URL and REVOKED on
  close; the `<audio>` element exists ONLY while the window is open —
  closing STOPS playback (no background audio). NO autoplay: opens
  paused at 0:00.
- **Custom Persian/RTL chrome** (Vazirmatn, theme-aware tokens): play/
  pause, seek slider + buffered range, ±۱۰s skips (RTL-correct
  direction), volume + mute, speed menu (۰٫۵/۱/۱٫۵/۲), close; the time
  readout follows the Persian-digits setting. Keyboard: Space, ←/→
  (±۱۰s), ↑/↓ volume, M mute, **Esc close**.
- **`ui/player/miniPlayerSettings.ts`**: the dedicated
  `infinite-canvas-studio/mini-player/v1` localStorage slot — last
  position/size/volume/speed/muted survive restarts.
- **ONE instance ACROSS players**: opening the mini-player closes the
  video window and vice-versa (the store owns the hand-off — a one-line
  surgical edit to `openVideoPlayer`).
- **Wiring**: `ui:audio-play-requested` (EventBus) ← SelectTool's
  double-click (pinned + main branches, the A1 no-op guard replaced by
  the play request) → App.ts resolves the object → `playerAudioId`.

### Added — the offline conversion gate (RA2.3–RA2.5, A.2.4/A.2.5)

- **`media/FormatProbe.ts` + `routeAudioFile`**: the Appendix A-1
  matrix as code — `.wav`/`.flac` ALWAYS queue for conversion;
  `.mp3/.m4a/.aac/.ogg` are probed with a detached `<audio>`
  (`canPlayType` — a refused probe queues too); a VIDEO-typed File
  carrying an audio extension (a renamed `.mp4`) converts with `-vn`
  stripping the stray stream (fixture e); truly unknown extensions get
  the Persian rejection toast and create NOTHING.
- **`media/AudioConverter.ts`**: the MP3 profile over the SHARED
  engine — `videoConverter.ensureLoaded()` (public) returns the loaded
  single-threaded `@ffmpeg/core` instance; **never a second ffmpeg in
  memory**, no CDN fetch (the same bundled 32MB core from app
  resources). Output: libmp3lame, 128 kbps, `-vn`. Progress feeds the
  Persian progress bar through a SECOND `on("progress")` listener on
  the shared emitter. A CANCEL terminates the shared engine (the video
  converter's own cancel semantic — the next run lazy-loads it again)
  and cleans the in-memory FS on BOTH temp names (no residue). The
  input's temp name keeps its REAL extension — the wasm core probes
  containers extension-first (a bare `.bin` misdetects the demuxer;
  found live in the E2E round).
- **`ui/components/ConvertAudioDialog.tsx`**: the Persian gate —
  «تبدیل به MP3 (آفلاین)» / «انصراف», live progress bar, a WORKING
  cancel (Esc mid-run too), the file list with Persian-digit sizes.
  Cancelling creates NOTHING (no object, no temp files). The ORIGINAL
  file is kept in the sidecar next to the converted MP3
  (`origAssetHash`) while the object points at the converted asset and
  `originalName` stays for display.
- **Queue wiring**: `importOrQueueAudioFiles` routes every audio
  candidate (paste/drop/dialog — the ONE funnel) through the probe;
  `importConvertedAudioFile` commits the landed MP3 through the SHARED
  placement core; the queue lives in the UI store (view state, never
  persisted).

### Fixed — delivery polish

- Two stale `AudioConverter` unit tests still expected the old
  `.bin` temp name; updated to the real-extension contract (the
  E2E-found probing rule) — 2352/2352 green.

### Tests (+22 → 2352)

AudioConverter (the shared-engine profile: exec args, FS cleanup,
progress routing, abort/empty/failed paths, terminate delegation),
FormatProbeAudio (the routing matrix incl. the renamed `.mp4` and the
unknown extension), audioImportGated (queue vs direct vs toast, the
cancel-creates-nothing contract), miniPlayerSettings (the dedicated
slot, defaults 400×120, persistence round-trip).

## [1.45.0] — Phase A1: audio on the canvas — «صوت روی بوم» (2026-09-17)

> The audio extension's binding PART A contract, phase A1: audio files
> enter the canvas through every gesture as LIGHTWEIGHT WAVEFORM
> THUMBNAIL objects, persisted through the SAME hash-keyed sidecar
> AssetStore as videos (v1.44.0's rails), exported as posters in the
> static formats. No playback yet — that is A2's floating mini-player +
> offline ffmpeg conversion. (M2's floating player + offline converter —
> already live in-tree — ride under this release's umbrella
> bookkeeping: their code shipped with the v1.44.0 tree.)

### Added — the object model & persistence (§1.7.1/§1.7.4)

- **`core/model/AudioObject.ts` (pure)**: `AudioObjectData` —
  `assetHash`, `thumbHash` (the waveform JPEG; null ⇒ the audio-note
  fallback plate), `originalName`, `mimeType`, `durationMs`, placed
  `width/height`, optional `origAssetHash` (A2's kept original).
  Factory, guards, `placedAudioSize` (the EXACT image rule through
  `placedImageSize`), the relocation manifest `collectAudioAssetHashes`
  and the shared media timecode core.
- **Registry entry `core.audio`** (objectTypes.ts — registration only):
  wire version 1, lenient optional hashes + strict required fields,
  catalog metadata (group `media`, order 12 AFTER the video card,
  `Music` icon) — the Insert-Panel card appears automatically.
- **Schema v5**: `MigrationV4toV5` (normalising, the V3→V4 shape) +
  `PROJECT_FILE_VERSION = 5`; older files walk the chain untouched.

### Added — the import pipeline (RA1.3, ONE funnel)

- **`media/audioFormats.ts` (pure)**: the six accepted extensions
  (`.mp3 .m4a .aac .ogg .wav .flac`), the extension→MIME map, the
  audio/foreign classifier — image/video drops are NEVER hijacked.
- **`media/WaveformGenerator.ts`**: a minimal `OfflineAudioContext`
  (pure decoder host) decodes the clip; ~200 max-amplitude buckets
  paint a centred coral waveform on a dark 3:1 media chip (≤480px wide,
  JPEG q0.8 — the video poster's quality knob); duration captured;
  failures resolve null → the audio-note fallback (A.2.2 Attempt 2).
- **`ui/clipboard/audioImport.ts`**: store → waveform → commit through
  the SHARED placement core (viewport centre or drop point, cascade,
  snap), one undo step, auto-select, the Persian notice; the corrupt
  path fires «موج صدا ساخته نشد…» while keeping the valid object.
- **All three gestures**: File→«درج صوت…» (the new ProjectMenu item +
  `core.insert.audio` + the InsertAudioDialog), Explorer drag-and-drop
  (lands ON the drop point), clipboard paste — one pipeline.

### Added — rendering, panels & exports

- **Renderer `drawAudio`**: the waveform bitmap through the EXACT
  drawImage/drawVideo affine path (camera+object rotation, hairline
  frame) + the play glyph + the Persian-digit duration badge INSIDE the
  rotated frame; the audio-note fallback plate (dark, eighth-note
  glyph) and the dashed «صوت در دسترس نیست» placeholder + file name.
  `preloadImages` covers waveform posters → PNG/SVG/PDF exports render
  them in place (incl. rotations), zero audio data embedded.
- **LayersPanel**: the distinct `Music` icon + «صوت» label rows.
- **Aspect-locked resize by default** (Shift frees it) — the same
  gesture seam as images/videos, canvas + pinned.

### Fixed — E2E-found P0

- Double-clicking an audio thumbnail created an UNWANTED TEXT BOX (the
  SelectTool.onDoubleClick fall-through). Audio now early-returns — the
  documented A1 no-op (A2 wires the mini-player there).

### Tests (+54 → 2330)

AudioObject (factory/guards/placement/manifest/timecode), audioFormats
(the Appendix A-1 matrix), WaveformGenerator (mocked decode host +
recording canvas — ACA1.7), MigrationV4toV5, the audio registry entry
(catalog order, round-trip, lenient/malformed), audioImport (placement,
cascade, drop-point, store failure) + the 12 version/count fixtures
upgraded to v5/20 cards/13 types/4 migration steps.

## [1.44.0] — Phase M1: videos on the canvas — «رسانهٔ زنده» (2026-09-16)

> The user's binding PART A contract (media extension), built PHASE BY
> PHASE. M1 lands the full import/persist/render/export half: videos
> enter the canvas through every gesture (file dialog, Explorer
> drag-and-drop, clipboard paste) as LIGHTWEIGHT THUMBNAIL objects — a
> captured poster frame + duration badge + play glyph, ZERO `<video>`
> elements on the canvas — with the video bytes living in a sidecar
> AssetStore NEXT TO the `.icb` (hash-named, deduped), so project files
> stay KB-scale. Static exports render the poster frame in place of the
> video. No playback yet — that is M2's floating player + offline
> ffmpeg.wasm conversion.

### Added — the object model & persistence (§1.7.1/§1.7.4)

- **`core/model/VideoObject.ts` (pure)**: `VideoObjectData` —
  `assetHash` (current video), `thumbHash` (poster JPEG, null ⇒
  film-icon fallback), `originalName`, `mimeType`, `durationMs`,
  `naturalWidth/Height` (intrinsic, mirroring ImageObject) +
  `width/height` (placed) + optional `origAssetHash` (M2's kept
  original). Factory, guards, the shared placement-size rule
  (`placedVideoSize` → the EXACT image rule), the relocation manifest
  (`collectVideoAssetHashes`) and the timecode core.
- **Registry entry `core.video`** (objectTypes.ts — registration only,
  §1.7.1): wire version 1, serialize/deserialize with lenient optional
  hashes + strict required fields (malformed ⇒ opaque fallback, nothing
  lost), catalog metadata (group `media`, order 11 after the image
  card, `Film` icon) — the Insert-Panel card appears automatically.
- **Schema v4**: `MigrationV3toV4` (normalising step) +
  `PROJECT_FILE_VERSION = 4`; older files walk the chain untouched;
  unknown-type passthrough intact.
- **`SceneObjectKind` += `video`** — the generic sized-object geometry
  (bbox/resize/translate/rotate/group/z-order/undo) applies for free.

### Added — the sidecar AssetStore (A.2.1)

- **`persistence/assetPaths.ts` (pure, shared client+server)**: the
  sidecar rule `<projectPath>.assets/`, the media inbox
  (`<root>/media-inbox`), SHA-256 hex validation.
- **`persistence/AssetStore.ts` — `WebAssetStore`**: Web-Crypto
  SHA-256 hashing, scoped writes (project sidecar / inbox for unsaved
  projects), the read scope chain [sidecar, inbox] (content addressing
  makes any copy valid), `syncProjectPath` (the Save-As relocation:
  inbox → sidecar MOVE, old-sidecar → new-sidecar COPY, idempotent),
  immutable read URLs. Injected via AppContext (`Services.assetStore`).
- **Server half** `lib/serverAssets.ts` + `/api/assets` routes
  (probe/write/read/relocate, the LocalFsBridge security posture):
  node:crypto hash VERIFICATION of every upload, root/path guards,
  dedupe (an existing hash is a no-op), magic-byte content sniffing,
  512 MiB cap.
- **Save-flow hooks**: `performDiskSave` + the Save-As dialog's shared
  `noteSaved` both adopt the asset scope and relocate the scene's
  hashes; opening a project scopes reads to its sidecar.

### Added — the media pipeline (A.2.2/A.2.4)

- **`media/pickTimestamp.ts` (pure, unit-tested)**: min(1s, 10%).
- **`media/ThumbnailService.ts`**: hidden detached `<video>` (blob
  URL) → loadedmetadata → seek → canvas capture (≤480px wide, JPEG
  q0.8) + duration/intrinsic capture; finally-semantics hygiene
  (element + blob URL ALWAYS released); capture failure ⇒ null poster,
  the object stays valid.
- **`media/videoFormats.ts` (pure)**: the five accepted extensions
  (.mp4 .m4v .mov .webm .ogv), extension→MIME map, and the import
  classifier (video-typed foreign extensions — .avi/.flv/.mkv — are
  REJECTED for M2's convert gate; images/text pass through untouched).
- **`media/PosterBitmapCache.ts`**: decode-once LRU (cap 100) shared by
  the live canvas + the exporters; a decode counter proves no
  re-decode storm (ACM1.10); late decodes announce through the
  renderer's repaint notifier.
- **`media/AssetUrlResolver.ts`**: the renderer seam (hash → URL)
  without a composition-root cycle; null until boot ⇒ placeholder.

### Added — the one import funnel (RM1.3, A.2.10)

- **`ui/clipboard/videoImport.ts`**: `prepareVideoAsset` (store →
  thumbnail) + `commitVideoObject` (the SHARED placement core —
  viewport-centre/drop-point, burst cascade, grid snap — extracted as
  `canvasImport.pastePlacementPosition` so images AND videos commit
  through ONE placement system) + one `AddObjectCommand` + auto-select
  + the Persian notice.
- **The gesture bridge** (`useImageImport.ts`): document paste, canvas
  drop and dragover now ALSO classify video files (never hijacking
  image drops); unsupported formats toast
  «قالب ویدئو پشتیبانی نمی‌شود» and create nothing.
- **`InsertVideoDialog`** («درج ویدئو…»): the file-picker path, opened
  by the new `core.insert.video` command (the card's registered insert
  action) through the `ui:insert-video-requested` bus event +
  `insertVideoDialogOpen` store slice — the exact image-dialog pattern.

### Added — rendering & exports (RM1.5/RM1.6/RM1.8)

- **`Canvas2DRenderer.drawVideo`**: the poster drawn through the EXACT
  `drawImage` affine path (camera+object rotation, hairline frame);
  centered play glyph + duration badge (Persian digits per setting via
  the palette's `videoDurationFormat`, LTR timecode, bottom-right chip)
  painted INSIDE the rotated frame; the film-icon fallback plate when
  `thumbHash` is null; the dashed Persian placeholder
  («ویدئو در دسترس نیست» + the original file name) for missing
  assets. `preloadImages` also preloads posters (the export path);
  renderers register the poster cache's repaint notifier.
- **Static exports**: PNG/SVG/PDF render the poster frame through the
  SAME renderer machinery — ZERO exporter-code edits; a missing poster
  falls back to the placeholder visual; no exporter embeds video.
- **Layers panel**: the distinct `video` icon + «ویدئو» label (the
  existing KIND_ICONS/KIND_LABEL_KEYS resolution path); resize is
  aspect-locked by default like images (ResizeGesture + PinResizeGesture).
- **`formatTimecode`** (ui/i18n/numbers.ts): the locale-aware duration
  badge formatter (Persian digit shaping, LTR timecode).
- **i18n fa/en**: 14 new keys (objectTypes.video, video.missing/notices,
  insertVideo.*, project.insertVideo, object.video) + v1.44.0 stamp.

### Verified — Phase M1 acceptance (live E2E, agent-browser + ffmpeg fixtures)

- **ACM1.1**: registration-only — new files + the catalog entry; the
  only Insert-Panel lines are the `Film` icon map entry + the
  `core.video` command case (the panel's own extension points);
  ProjectFile/deserializer untouched beyond the version const.
- **ACM1.2 (live)**: the Insert-Panel card appears; the file picker
  imports; thumbnails show the duration badge (۳:۰۰ / ۰:۰۱); layers
  rows read «ویدئو ۱..۴»; double-click is a documented no-op (M2).
- **ACM1.3 (live)**: save → reload → open-from-path → thumbnails,
  positions identical; the sidecar holds original + poster named by
  hash; the .icb stays ۱۰۴۶ bytes with two videos.
- **ACM1.4 (live)**: the same file imported three times → ONE asset on
  disk, independent objects (dedupe proven across sessions).
- **ACM1.5 (live)**: poster deleted externally → reopen → the dashed
  Persian placeholder + file name; no crash (read → 404 → placeholder).
- **ACM1.6 (live)**: import into an unsaved project → Save As →
  `/api/assets/relocate` moves the inbox into the sidecar (inbox = 0).
- **ACM1.7**: pickTimestamp + AssetStore relocation/dedupe unit tests
  (67 new tests, 2276/2276 green).
- **ACM1.8**: no regressions — full suite green, tsc/eslint clean.
- **ACM1.9 (live)**: PNG export renders the poster frame in place (+
  the placeholder for the missing one); SVG/PDF ride the same raster.
- **ACM1.10 (live + unit)**: with videos on canvas and no player:
  ZERO `<video>` elements in the DOM; the decode-count unit test pins
  the no-re-decode contract; zoom/pan re-uses cached bitmaps.

## [1.43.0] — Phase 36: tables to Word — «جدول به ورد» (2026-09-16)

> The user's request — "in the copy-text-out section I want TABLES to
> travel out too, e.g. into a Word Office FILE" — audited and built.
> فاز ۳۵ already ships `text/html` on the OS clipboard (Word pastes the
> structure on a manual Ctrl+V); فاز ۳۶ closes the FILE gap with a
> dependency-free .docx generator: canvas text boxes (and sticky notes)
> export as a REAL Word document where tables are REAL Word tables.

### Added

- **فاز ۳۶ `WordExporter` (pure, dependency-free, unit-tested)**: a
  minimal ZIP writer (STORE + CRC-32, deterministic bytes) plus the
  WordprocessingML serializer — `[Content_Types].xml` / `_rels/.rels` /
  `word/document.xml` / `word/styles.xml` (doc defaults + Heading1–6) /
  `word/numbering.xml` (bullet + decimal, 3 levels) /
  `word/_rels/document.xml.rels` (collected SAFE hyperlinks).
- **REAL Word tables** (the core ask): `w:tbl` + `w:tblGrid` +
  preset-aware inline borders + `w:bidiVisual` for RTL column order +
  repeating header rows (`w:tblHeader`, bold runs, subtle fill) +
  `w:gridSpan`/`w:vMerge` merge support (the prosemirror rowspan model
  is re-materialised as Word vertical-merge continuations) + per-cell
  `w:shd` background colour + `w:vAlign` + drag-resized `colwidth`
  travel (px → twips). A trailing paragraph follows every table (Word's
  shape rule).
- **Word-native text semantics**: headings → Word heading styles;
  bold/italic/underline/strike/sub/sup/code/text-colour runs; SAFE
  external hyperlinks as relationships (the فاز ۳۵ scheme policy —
  `javascript:` degrades to text); bullet/ordered lists via numbering;
  blockquote (indent + side bar), codeBlock (monospace lines),
  horizontalRule (bottom border); per-paragraph `w:bidi` with RTL
  auto-detection (Persian content opens correctly in Word); A4 section
  with RTL-dominant mirroring.
- **Aggregation (فاز ۳۵ parity)**: the selection's text-bearing objects
  export when any are picked, else the whole scene's; rich docs
  serialise, plain boxes/sticky notes contribute paragraphs, objects
  join with spacers, text-free selections resolve null.
- **Wiring**: the `core.export.word` palette command («خروجی Word (متن و
  جدول)…», export group) + the textBox/stickyNote context-menu entry +
  the App composition-root implementation (blob → download → Persian
  notice «فایل Word ساخته و دانلود شد…»; the empty-selection guard
  explains «متن یا جدولی برای خروجی Word نیست»).
- **Tests (+24 → 2209)**: CRC-32 canonical vectors; STORE archive
  structure (magic/version/method/UTF-8 flag/EOCD counts) +
  determinism; five-entity XML escaping; RTL detection; blocks
  (bidi/heading styles/mark stack/hyperlink degradation/lists/
  blockquote/code/hr/injection safety); TABLES (tbl/tblGrid/borders/
  bidiVisual/tblHeader, LTR parity, gridSpan, vMerge restart+continue,
  shading + vAlign, colwidth travel, preset borders); the object
  aggregator; and the full-package assembly (every part present, RTL
  section, Heading1 style).

## [1.42.0] — Phase 35: the rich copy-out bridge — «خروج غنی از بوم» (2026-09-16)

> The user's question — "can canvas content travel OUT to AI chats, Word,
> After Effects, Photoshop?" — audited and completed. Images already left
> at original quality (فاز ۲۳/۲۶: single image → PNG on the OS clipboard;
> any selection → transparent 2x snapshot), but TEXT left as flat
> `text/plain`: headings, bold, lists and tables survived the trip INTO
> the canvas (فاز ۲۴) and died on the way out. فاز ۳۵ ships the mirror:
> copying a text-bearing selection now writes `text/html` + `text/plain`
> on ONE atomic ClipboardItem — Word / Outlook / AI chats paste the
> STRUCTURE; Firefox (no ClipboardItem) degrades to the plain write, so
> the copy never dies.

### Added

- **فاز ۳۵ `richTextOut` (pure, DOM-free, unit-tested)**: the
  RichTextDocument → semantic-HTML serializer — headings → `<h1..h6>`,
  marks → `<strong>/<em>/<u>/<s>/<code>`, SAFE `<a href>` (http/https/
  mailto/relative; `javascript:` degrades to text — the inbound
  sanitizer's policy mirrored), lists → compact `<ul>/<ol>/<li>`,
  tables → `<thead>`+one `<tbody>` (`tableHeader` → `<th>`), blockquote
  keeps inner `<p>`, codeBlock → escaped `<pre><code>`, `dir` rides the
  direction-aware elements, and EVERY text node + href is fully escaped —
  canvas text can never inject markup into the consumer. Plain boxes and
  sticky notes contribute escaped `<p>` lines; multiple text objects join
  with a spacer paragraph (the plain projection's blank-line parity).
- **`writeRichTextToSystemClipboard`** (osClipboard): one atomic
  `navigator.clipboard.write` carrying BOTH flavors; the فاز ۲۶ tri-state
  contract (`"unsupported"` → Firefox → the caller falls back to the
  plain write so the text still lands).
- **Wiring**: `copySelection` AND `cutSelection` now consult
  `richTextHtmlOfObjects` after the rasterize check — a single
  text-bearing selection ships the rich payload (notice «متن
  قالب‌بندی‌شده (HTML) در حافظهٔ سیستم کپی شد…»); the فاز ۲۳/۲۴ decision
  table is otherwise untouched (single image → original-quality PNG;
  multi-object → rasterised snapshot).

## [1.41.0] — Phase 34: original image quality & the time-zero reset — «کیفیت اصلی و زمان صفر» (2026-09-16)

> The user's contract, made exact: an image copied from the web or a
> folder enters the canvas at its ORIGINAL quality — byte-identical
> bytes, any decodable MIME, up to 4096px / 2.5MB (only genuinely
> gigantic payloads take the proportional fallback, because the ~5MB
> localStorage slot physically cannot hold more; autosave failures are
> announced, never silent). And at the instant of insertion every image
> now snapshots its exact placed state («زمان صفر» — size, position,
> rotation) inside itself, so the new «بازنشانی به حالت درج» button in
> the image inspector takes it back to that exact moment — one undo
> step, any combination of resize/move/rotate drift reversible. Legacy
> scenes degrade honestly to the فاز ۲۳ natural-size reset.

### Added

- **فاز ۳۴ «زمان صفر» insert snapshot**: `ImageObjectData.initial`
  (optional, defensively parsed, legacy-tolerant) records the placed
  width/height/position (post-cascade, post-snap) and rotation at the
  moment of import; `createImageObject` captures it for FREE on every
  import path (paste, drop, dialog, OS-clipboard read). The inspector
  shows the snapshot chip (dashed time-zero ring + live drift badge —
  amber «دور از درج» / emerald «در حالت درج») and the PRIMARY
  «بازنشانی به حالت درج» button; `insertStateResetPatch` +
  `imageInsertStateDrifted` are pure model helpers; the command
  `core.image.resetInsert` lands in the selection group; one
  `ResizeCommand` snapshot swap = one undo step.
- **فاز ۳۴ «کیفیت اصلی» byte-identical imports**: `planImageImport`
  (pure, exported, tested) decides passthrough-vs-rescale from the
  decoded edge (≤4096px) and original byte size (≤2.5MB); the
  pass-through now covers EVERY decodable MIME (WebP/AVIF/GIF/BMP/SVG
  keep their exact bytes instead of a canvas re-encode generation
  loss); `MAX_IMAGE_DIMENSION` 1600→4096 and the new
  `MAX_INLINE_IMAGE_BYTES` guard the localStorage autosave slot with an
  honest, documented boundary.
- **QA typing debt**: the pre-existing `tests/dev/qaHook.test.ts` tsc
  failures (holder typed as `{__qa?: unknown}`) fixed with the exported
  `QaHook` type — tsc is clean across src AND tests again.

## [1.40.0] — Phase 33: vivid stickers & quick sizes — «استیکر پُررنگ و اندازهٔ سریع» (2026-09-16)

> The QA round's headline: every sticker ever placed was rendering at
> ~6% opacity — the R11.1 backing plate's alpha-tagged fillStyle leaked
> into the emoji fillText, and canvas composites COLOUR emoji bitmaps
> against the fill ALPHA (the colour itself is ignored). Stickers were
> near-invisible on the dark board and washed-out on light. The fix
> resets the paint to an opaque colour before the glyph; live-verified
> 0 → 3859 warm pixels at full strength. On top of the fix, the picker
> gains فاز ۳۳'s quick sizes (a 3-chip segmented control — ۴۸/۹۶/۱۶۰ px —
  riding BOTH insert paths with a size-previewing drag ghost), the
> sticker plate gains a hairline chip ring, and a dev-only
> `window.__qa` introspection hook lands for the standing QA loop.

### Fixed

- **Stickers rendered ghosted (P0)**: `drawSticker` painted the soft
  backing plate with `withAlpha(palette.stroke, "6%")` and then drew
  the emoji glyph WITHOUT resetting the fillStyle — canvas multiplies
  a colour-emoji bitmap's opacity by the active fill ALPHA, so every
  sticker rendered at 6% (≈ invisible on dark, ghosted on light; the
  exports too — they share the renderer). The fix sets an opaque
  `palette.stroke` paint before the glyph (the colour is ignored by
  colour glyphs; monochrome fallback fonts get a theme-readable
  paint). Regression-tested via a recording fake context
  (`StickerGlyphPaint.test.ts`): the glyph fillText must never carry
  an alpha-tagged fillStyle, and the plate must still paint first.

### Added

- **Sticker quick sizes (فاز ۳۳)**: `StickerInsertOptions.size`
  (clamped 24..320 by `clampStickerSize`; bad values fall back to the
  default instead of refusing the insert) threads through BOTH picker
  paths — the click insert and the فاز ۳۸ drag-out — and the pinned
  insert's anchor math centres the CHOSEN footprint on the release
  point. The picker footer gains a compact radiogroup of the three
  presets («۴۸ / ۹۶ / ۱۶۰», locale digits, aria-labels naming the size
  class); the middle preset IS the classic default, and each open
  resets to it (the فاز ۳۲ session precedent). The drag ghost renders
  AT the chosen size (the chip and the glyph scale; ≥40px floor so the
  smallest preset stays grabbable).
- **`window.__qa` dev hook (فاز ۳۳)**: a read-only introspection
  surface attached only in development builds — `version()`,
  `sceneSummary()`, `objects()`, `camera()`, `selection()` — so QA
  rounds read live scene state directly instead of scraping the
  status bar, pixel-scanning the canvas or parsing the autosave JSON
  (the فاز-۳۳ round burned most of its budget on exactly that gap).
  Idempotent under StrictMode double-boots; never attached in
  production; every read is guarded.

### Changed

- **Sticker plate chip ring (styling)**: the soft circular plate gains
  a 1px hairline stroke at 16% alpha (plates >10px radius only) — a
  sticker now reads as a self-contained "chip" on both themes instead
  of an ambiguously floating glyph.
- Version → 1.40.0; phase banner → «فاز ۳۳ — استیکر پُررنگ و
  اندازهٔ سریع» (fa/en/tauri.conf).

## [1.39.0] — Phase 32: sticker drag-out & pinned insert — «کشیدن استیکر و درج سنجاق‌شده» (2026-09-16)

> The sticker picker stops being click-only. Every emoji cell in the
> library dialog (grid AND recents) is now draggable: a ghost chip
> follows the cursor — portal-rendered above the modal, dashed-ringed —
> and releasing over the canvas inserts the sticker EXACTLY at the
> release world point and CLOSES the picker (the modal scrim would
> otherwise hide the fresh sticker; one undo step; release outside the
> canvas or Esc cancels the drag WITHOUT closing). The footer's amber
> «درج سنجاق‌شده» switch inserts stickers ALREADY PINNED to the screen —
> the click path centres the viewport, the drag path centres the
> release point, and the ghost previews the mode with its amber ring
> and Pin badge. This closes the #1 rebuild-queue item («درج‌باکشیدن،
> استیکرهای سنجاق‌شده») from the sandbox-restoration backlog.

### Added

- **Sticker drag-out (exact-point insert)**: the `EmojiButton` cells
  gained the InsertPanel card pattern — 5px pointer-move threshold,
  `setPointerCapture`, a screen-space ghost (a 56px rounded chip
  centred under the cursor, `panel-pop-in` animation, portal-rendered
  at `z-[60]` so it rides ABOVE the modal dialog), release-inside-
  canvas converts the point through `camera.screenToWorld` and the
  shared `insertStickerObject` engine centres the sticker exactly
  there; a successful drop then CLOSES the picker (the modal's scrim
  would dim the placed sticker — the drag-out says "place it and be
  done", while the CLICK path keeps the multi-insert rhythm);
  releases outside the canvas rect cancel silently; Esc mid-drag
  cancels the ghost while `onEscapeKeyDown` keeps the dialog open; a
  trailing compat click after a captured release is eaten.
- **«درج سنجاق‌شده» (insert-as-pinned) switch**: an amber
  `role=switch` in the picker footer (Pin icon tilted/scaled while on —
  the pin language of فاز ۲۸/۳۱), session-scoped and reset-to-off per
  open. While on, `insertStickerObject` takes the new `pinnedAt`
  option: the sticker is created with `pinned: true` and a
  `pinAnchor` centred on the insert point (`pinnedStickerAnchor` =
  `(point − 48) / viewport`, clamped by the shared `screenToPinAnchor`
  contract) — it lands exactly under the cursor and stays put while
  the camera moves; unpinning recomputes the world position from the
  anchor (the فاز ۲۵ rule), and the stored world point is the
  drop-point snapshot.
- **Footer affordances**: the picker grew a footer row — the drag hint
  («استیکر را بکشید و روی بوم رها کنید…», Grab icon, hidden on xs)
  and the amber pinned switch; the cascade that fans out consecutive
  picks applies in SCREEN space for pinned inserts (world space
  otherwise), so multi-inserts never stack even in pinned mode.

### Changed

- Emoji cells now show `cursor-grab` / `active:cursor-grabbing` with
  `touch-none` — the affordance reads as draggable before the first
  try.

### Tests

- `StickerInsert.test.ts` +5: anchor centring round-trip
  (`pinAnchorToScreen(anchor) + 48 ≡ point`), top-left corner
  clamping, the pinned insert itself (flag + anchor + world snapshot +
  one undo step + redo restores the pin fields), the click path stays
  unpinned without options, and the degenerate-viewport fallback.

## [1.38.0] — Phase 31: the current-view frame & presentation pins — «قاب نمای فعلی و ارائه» (2026-09-16)

> Two honesty fixes for the pinned-export story. First: a board holding
> ONLY pinned objects used to export «۰ × ۰ پیکسل» with a DEAD export
> button (the فاز ۲۸ bounds-exclusion had nothing left to frame) — now
> `computeExportBounds` falls back to the LIVE CAMERA's viewport frame
> (world units), so the exported image reproduces exactly what the user
> sees, and an amber «قاب نمای فعلی» badge in the dialog explains where
> the number comes from. Second: presentation mode gained the «شامل
> اشیای سنجاق‌شده» parity the exports took in فاز ۲۸ — an amber HUD
> toggle (only while the scene carries pins) overlays the pinned
> furniture onto every slide at its on-screen relative position/size via
> the same mapped-clone plan; the live DOM text layer mounts the pinned
> text kinds with the plan's transform overrides, floating above the
> slide's world text.

### Fixed

- **The pins-only 0×0 export (فاز ۲۸ edge)**: `computeExportBounds`
  accepts an optional `viewportWorldFrame` — when the framed region pins
  down to NOTHING while the scene holds visible pinned objects, the
  viewport frame becomes the export bounds instead of a null (the mapped
  pinned clones' anchor-fraction placement maps 1:1 onto the user's
  view — WYSIWYG). A truly empty board (or a headless caller) still
  returns null and fails honestly with `no-content`; the fallback never
  overrides real world content. Threaded through all three exporters
  (`exportToPng`, `exportToSvg`, `planPdfPages` fit-all) and the dialog
  (`readViewportWorldFrame` = camera + live canvas size via
  `minimapViewportWorldBounds`, the فاز ۲۹ helper).

### Added

- **«شامل اشیای سنجاق‌شده» presentation toggle (فاز ۳۱)**: the HUD
  footer grows an amber `role=switch` (Pin icon, tilted + scaled while
  on, amber border/background — the pin language of فاز ۲۸'s export
  switch) whenever the presenting scene carries pins. Toggling re-rasters
  the slide with `includePinned` + the presenting viewport (the fullscreen
  overlay's window size), and the live DOM text layer appends the plan's
  pinned text objects AFTER the slide's world text with their transform
  overrides — pinned furniture floats on top, exactly like the export
  z-order. Session-scoped: every entry resets to off (the فاز ۲۹ default
  — a deck stays clean unless the presenter opts in); the enter hint
  pill stays honest about the default.
- **Amber viewport-frame badge** in the export dialog's size preview:
  «قاب نمای فعلی — بوم فقط شیء سنجاق‌شده دارد» whenever the bounds come
  from the fallback (Scan icon + amber pill), so the suddenly-viewport-
  sized number never reads as arbitrary.

### Tests

- `PinnedExport.test.ts` +7: the pins-only viewport fallback (scene +
  selection regions), headless null-preservation ×3, the empty-board
  refusal, invisible-pin exclusion, the never-override guarantee, and
  one `planPdfPages` fit-all page plan on the fallback frame.
- `Presentation.test.ts` +1: the فاز ۳۱ composition contract — slide
  content stays pin-free while `buildPinnedExportPlan` maps the pinned
  clone onto the frame bounds at its anchor fraction, unpinned, painting
  after the world objects.

## [1.37.0] — Phase 30: pinned rotation — «چرخش سنجاق‌شده» (2026-09-16)

> The LAST pin transform limitation falls (D-#47b). Since فاز ۲۵ a pinned
> object could ride the screen, فاز ۲۷ let it resize on-screen — but
> spinning it still demanded an unpin/rotate/re-pin dance. Now a single
> selected pinned object carries a round AMBER grip above its (tilted)
> top edge: dragging it spins the object around its own footprint centre
> in SCREEN space, with the anchor and size staying exactly fixed — the
> object turns in place like a world rotation pivots around the bounds
> centre. Shift snaps to 15° steps; one gesture = one undo entry
> (`RotateCommand`); Escape restores exactly; the status-bar angle chip
> shows the live delta; and the inspector's pin card gains a quick-turn
> row (±90° buttons + reset with a live angle readout).

### Added

- **Pinned rotation gesture (فاز ۳۰)**: `PinRotateGesture` mirrors the
  world `RotateGesture` in screen space — the grip rides 24px above the
  rotated top-edge centre of the pinned footprint (the
  `rotateHandleAnchor` contract, mirrored), the pivot is the footprint
  CENTRE (invariant under rotation: anchor + size fixed), live frames
  recompute from the before snapshot each move (no drift), and the
  finished `RotateCommand` swaps absolute snapshots — exact and
  idempotent on top of the live frames. Emits `rotate:live`/`rotate:ended`
  so the existing status-bar angle chip just works.
- **Pure pin-rotation helpers** in `Pinned.ts`: `pinnedFootprintCentre`,
  `pinnedTopCentre`, `pinnedRotateHandleAnchor` (rotation-aware, null on
  degenerate viewport/unsized objects), `hitPinnedRotateHandle`
  (11px tolerance) and `pinnedRotationDelta` (pointer-angle delta with
  optional 15° snap).
- **Inspector quick-turn row**: while a single pinned object is selected,
  the pin card offers «چرخش روی صفحه» — a live angle readout chip
  (Persian digits follow the UI setting) plus −90° / +90° buttons and a
  0° reset, each ONE undo step through `rotatePinnedBy` → `RotateCommand`.
  Locked objects refuse; the reset disables at exactly 0°.

### Changed

- The pinned selection chrome now draws the rotation grip in the AMBER
  pin identity (`drawPinnedRotationHandle`) — white-filled circle with an
  amber stroke at rest, filled amber with a soft glow while the gesture
  runs (the `setRotating` pattern), stem tracking the object's own
  "up" direction at any tilt.

## [1.36.0] — Phase 29: pin parity in the minimap & presentation — «هم‌ترازی سنجاش در نقشه و ارائه» (2026-09-16)

> The last two stale-world pin ghosts are hunted down. The minimap drew
> pinned objects at their pre-pin world positions — boxes that correspond
> to nothing visible — and a parked-away pin could silently distort the
> map's frame; presentation membership used the same stale geometry, so
> a pinned sticky intersecting a frame (at its ghost position) mounted a
> DOM text ghost on the slide. Both now tell the truth: the minimap draws
> each pinned footprint at its LIVE effective world position (the world
> quad under its on-screen footprint at the current camera — it rides
> the viewport rectangle as the camera moves), and slides simply exclude
> screen furniture.

### Fixed

- **Minimap stale-pin ghosts (D-#48c)**: `minimapContentBounds` frames
  the map over visible UNPINNED objects only — a pinned object parked
  far away can never again stretch the map's scale (the map previously
  fit the union of stale pin boxes, shrinking the real content into a
  corner). The world-footprint pass skips pinned objects entirely.
- **Presentation text-layer ghosts (D-#48c)**: `slideContent` filters
  pinned objects — their stale world bbox no longer grants slide
  membership, so the DOM text layer can never mount a floating ghost of
  a pinned note/text at a position where nothing renders. The raster
  pass was already pinned-clean (فاز ۲۸); the text layer now matches.

### Added

- **Live pinned footprints on the minimap**: each visible pinned object
  paints as an amber quad (`pinnedFootprintWorldQuad`) at the world
  quad under its current screen footprint — the footprint TRAVELS with
  the viewport rectangle as the camera pans/zooms, mirroring the real
  screen behaviour (the object follows the view). Styled in the pin
  identity amber (فاز ۲۷ palette) with a translucent fill + stroke, so
  world content (magenta) and screen furniture (amber) read at a
  glance. Window resizes now repaint the map (pinned anchors are
  viewport fractions — the footprints move on resize).
- **View-aware map framing**: the map frames world content ∪ the
  CURRENT VIEWPORT (`minimapSceneFit` + `unionMinimapBounds`) — found
  live in E2E: content-only framing could clip the viewport rectangle
  (and every pin quad riding it) off-map whenever the world content
  sits small and far from the camera. The union keeps BOTH what exists
  and where you are always on the map (and drag-to-pan keeps working
  over the whole map).
- **Minimap viewport-only fallback**: a scene with NO world objects (or
  empty) now frames the CURRENT VIEWPORT instead of collapsing to "—"
  — the view rectangle and any pinned footprints stay visible and
  drag-to-pan keeps working.
- **Segmented slide progress in presentation (فاز ۲۹ polish)**: the
  presentation HUD carries one clickable segment per slide (jump
  navigation, `aria-current` on the active one, active segment widened
  and accented, hover feedback on the rest) — RTL-safe by flex order,
  scrollable for long decks, hidden on very narrow screens. The nav
  hint now steps aside on small screens (`md:inline`) instead of
  crowding the HUD.
- **Pinned-hint pill on entering presentation**: when the scene carries
  pinned objects, a self-dismissing (4.2s) amber-bordered status pill
  states «اشیای سنجاق‌شده جزو ارائه نیستند» — the presenter learns
  the deck excludes screen furniture without a support ticket.

### Changed

- Minimap visual polish: the viewport rectangle now carries a
  translucent veil fill beneath its stroke (legibility on crowded
  maps), and the canvas gained an `shadow-inner` treatment to sit
  quieter in the dock.
- The minimap's pure planning math moved to
  `src/core/minimap/Minimap.ts` (panel-local → core, testable):
  `isMinimapWorldObject`, `minimapContentBounds`,
  `minimapViewportWorldBounds`, `minimapFit`, `unionMinimapBounds`,
  `minimapSceneFit`, `pinnedFootprintWorldQuad`.

### Tests

- `tests/core/minimap/Minimap.test.ts` (22 tests): world-object gating,
  stale-pin exclusion from the frame, the viewport fallback bounds
  (identity/pan/zoom/rotation cameras), the fit math (centring +
  degenerate spans), the bounds-union + view-aware scene fit (live-QA
  geometry encoded as a regression case), and the pinned footprint
  quad (identity/pan/zoom/rotation + null contracts for
  unpinned/unsized).
- `tests/core/presentation/Presentation.pinned.test.ts` (4 tests):
  pinned stickies/shapes never take slide membership (even when their
  stale bbox intersects the frame), the text layer stays ghost-free,
  mixed scenes keep only free content.

## [1.35.0] — Phase 28: pinned objects in exports — «شامل اشیای سنجاق‌شده» (2026-09-16)

> Two export-pipeline truths surface and get fixed: (1) the documented
> "pinned objects are excluded from exports" was never ENFORCED — pinned
> canvas kinds leaked into PNG/SVG at devicePixelRatio scale WITH their
> amber pin chrome, pinned text rendered at its stale pre-pin world
> position, and stale bounding boxes silently inflated the export frame;
> (2) the fix ships with the matching feature — a «شامل اشیای
> سنجاق‌شده» toggle in the export dialog that overlays pinned objects
> onto the image at their on-screen RELATIVE position and size.

### Fixed

- **Pinned export leak (فاز ۲۸)**: `computeExportBounds` now skips
  pinned objects (their stored world position is the stale pre-pin spot
  and must never frame the export); the PNG/SVG canvas passes render a
  pinned-aware plan view (no pinned object reaches the renderer's
  screen-space pass, so the amber ring + 📌 chip can never leak); the
  text layers no longer draw pinned ghosts at stale positions; clipboard
  multi-object snapshots unpin their subset clones (a snapshot is
  world-space — pinning is live-screen furniture); the export frame is
  never inflated by parked-away pinned objects (also fixes PDF planning
  and the dialog's size preview).
- **Hydration mismatch on boot**: the app shell now mounts CLIENT-ONLY
  (`next/dynamic`, `ssr: false`). The server-rendered toolbar/menu
  markup hydrated with a Radix `useId` tree mismatch on every boot (SSR
  and client passes disagree on sibling positions inside the Slot
  chains). A Figma-class canvas editor gains nothing from SSR — the root
  layout still server-renders the dark/RTL `<html>` shell, so there is
  no flash, and the shell itself no longer hydrates at all.

### Added

- **«شامل اشیای سنجاق‌شده» export toggle** (فاز ۲۸): when the board has
  visible pinned objects, the export dialog (all three formats) grows an
  amber-accented toggle row — pin icon, Persian-digit count chip, hint
  text, amber Switch. Opt-in: `includePinned` + the live canvas viewport
  (CSS px) ride `PngExportOptions` into PNG, SVG and PDF. Included
  pinned objects become UNPINNED mapped clones riding the regular world
  pass: anchor fraction → the same fraction of the export image,
  on-screen footprint → the same relative size (`object px ·
  export/viewport` per axis); text kinds keep their stored div size and
  CSS-scale (text never reflows); clones keep their id so connector glue
  resolves to the mapped spot; clones paint LAST (pinned furniture
  floats above the world, mirroring the live screen pass). In PDF the
  pinned overlay repeats on EVERY page — true to "pinned to the screen"
  semantics (documented in the dialog hint).
- Pure, node-testable export-plan surface: `pinnedExportPlacement` /
  `buildPinnedExportPlan` / `sceneViewOf` + per-object text-layer
  transform overrides (`TextLayerOverride`), all exported from
  `PngExporter` and unit-tested.

## [1.34.0] — Phase 27: pinned-object resizing — «تغییر اندازهٔ سنجاق‌شده» (2026-09-16)

> The last big pin limitation closes: a single selected PINNED object now
> carries eight amber screen-space resize handles — drag them and the
> object resizes ON THE SCREEN (the opposite corner/edge stays exactly
> fixed), rotated objects resize in their local frame, and the inspector
> gains a precise on-screen size row. The pinned selection identity turns
> amber across the app (canvas ring, DOM outline, handles) — "pinned"
> reads at a glance against the violet world selection.

### Added

- **Screen-space resize handles for pinned objects** (فاز ۲۷ «تغییر
  اندازهٔ سنجاق‌شده»): a single selected pinned object (shape / text box /
  sticky note / image / sticker) shows the familiar 8-handle affordance
  around its screen footprint — AMBER, matching the pin chrome, distinct
  from the violet world-selection handles; the dragged handle enlarges
  with a soft glow. Handles probe BEFORE the pinned body press (the world
  `probeResizeHandle` precedence mirrored in screen space) and set the
  hover cursor (`nwseResize` & co).
- **The pin-resize gesture** (`interaction/PinResizeGesture.ts`): one drag
  live-patches THREE stored fields — width, height and the top-left
  `pinAnchor` — through the shared pure `resizeRectFromHandle` box math,
  so the corner/edge OPPOSITE the grabbed handle stays EXACTLY fixed
  (min-size 8 px + stroke clamped at the fixed edge; the box never
  flips). The pinned render is scale 1, so the stored width/height ARE
  the on-screen pixels. Rotated objects resize in their LOCAL frame (the
  pointer un-rotates around the footprint centre — the `ResizeGesture`
  precedent mirrored in screen space); rotation never changes. Images
  lock the aspect by default and Shift frees it (AC5.2); every other
  kind locks with Shift. One gesture = ONE `ResizeCommand` undo entry
  (snapshot swap, idempotent after the live frames); a manual width
  change flips an AUTO text box to FIXED (R3A.7); Escape restores the
  pre-gesture snapshot without touching history (DECISIONS #30); the
  status-bar dimension chip rides `resize:live`/`resize:ended` (screen
  pixels).
- **The pure pin-resize math** (`core/model/Pinned.ts`):
  `pinnedResizeFrame` (the fixed-point frame), `pinnedHandleAnchors`
  (rotation-aware screen anchors) and `hitPinnedResizeHandle`
  (corner-first hit-testing) — the geometric truth for pins lives beside
  the pin model; `PIN_RESIZE_FIXED_POINT` documents the opposite-corner
  semantics per handle. The anchor is deliberately UNCLAMPED during a
  resize (the fixed point may sit off-screen; all consumers tolerate
  out-of-range fractions).
- **The inspector on-screen size row** (فاز ۲۷): while pinned, the Pin
  section shows «اندازه روی صفحه» — two precise NumberFields (width ×
  height, Latin digits / LTR per DECISIONS #43, clamped 8..4096) that
  resize the object with the TOP-LEFT anchor fixed, one undo step each
  (`useInspectorModel.setPinnedSize` → `ResizeCommand`; AUTO text boxes
  flip to FIXED), plus a hint pointing at the amber handles.

### Changed

- **The pinned selection identity is AMBER everywhere**: the selected
  pinned ring in `HandlesRenderer` and the `drawPinnedChrome` ring/chip
  border in `Canvas2DRenderer` now paint `oklch(0.8 0.14 80)` (the pin
  chrome colour) instead of the violet accent, and the DOM
  `.text-object-pinned-selected` dashed outline follows — "pinned" reads
  at a glance against the violet world-selection language, on both
  themes.

### Fixed

- **KNOWN_LIMITATIONS rewrite**: the «تغییر اندازه/چرخشِ شیء
  سنجاق‌شده» bullet no longer lists resizing — only ROTATION still
  requires unpinning (a screen-space rotation gesture stays out of
  scope).

## [1.33.0] — Phase 26: selection & clipboard quality — «کیفیت انتخاب و کلیپ‌بورد» (2026-09-16)

> Two long-standing gaps close at once: Firefox users get the copy-as-image
> pixels (a PNG download when the browser cannot write images to the
> clipboard), and every multi-select reads at a glance (per-object outlines
> at full strength + a Persian-digit count chip riding the frame).

### Added

- **The tri-state clipboard write outcome** (`ClipboardWriteOutcome`):
  `writeImageObjectToSystemClipboard` and
  `writeSelectionImageToSystemClipboard` now resolve `"written"` /
  `"unsupported"` / `"failed"` instead of a bare boolean — `"unsupported"`
  means THIS BROWSER cannot write images (Firefox ships no `ClipboardItem`),
  `"failed"` is a genuine write/render error. The `canWriteImagesToSystemClipboard`
  probe ships alongside.
- **The Firefox PNG-download fallback** (`ui/clipboard/blobDownload.ts`):
  every copy-as-image path degrades gracefully — a single image copies at
  its ORIGINAL intrinsic size then downloads (`infinite-canvas-image.png`);
  a multi-object snapshot still writes the plain-text projection to the
  clipboard (Firefox supports text) and downloads the transparent 2× PNG
  (`infinite-canvas-selection.png`). The Persian notice
  «این مرورگر تصویر را در حافظهٔ سیستم نمی‌نویسد؛ به‌جای آن فایل PNG
  دانلود شد.» says exactly what happened instead of a bare error. One
  `deliverImageToSystem` tail serves copy, cut and the image command.
- **The multi-select count chip** (فاز ۲۶ «کیفیت انتخاب»): an accent pill
  with the selection count rides ABOVE the frame's top-right corner
  (RTL-first reading), flipped inside when it would clip the viewport top
  and clamped at the left screen edge; the label is shaped by a
  locale-aware formatter INJECTED by the canvas host
  (`HandlesRenderer.setCountLabelFormat` — Persian digits follow the UI
  setting, re-applied on switches; the renderer stays framework-free).
  Singles show no badge.
- **Stronger multi-select per-object outlines**: every selected member
  paints at 75 % accent alpha and 1.5 px while more than one object is
  selected (groups outline every member at the same strength; rotated
  objects ride their true tilted frame) — singles keep the subtle hairline
  where the dashed frame + handles dominate.

### Fixed

- **Latent insecure-origin crash in the clipboard probes**:
  `navigator.clipboard !== null` passes `undefined` through, so a plain-http
  origin (where `navigator.clipboard` is undefined) or a Node-21+ runtime
  threw an unhandled TypeError from the copy paths. All probes now
  optional-chain (`typeof navigator.clipboard?.write === "function"`) and
  degrade to the fallback/error notices instead.
- `ExportPngDialog.savePngViaNativeDialog` used a double-escaped
  `/\\.icb$/i` regex that never stripped the extension — now `/\.icb$/i`
  like its sibling.
- `tests/interaction/commands7.test.ts`'s wiring stub was missing
  `copySelectionAsImage` (hidden by a cast) — added.

## [1.32.0] — Phase 25: pin to screen — «سنجاش روی صفحه» (2026-09-15)

> Objects can leave the canvas and pin to the SCREEN: a pinned note rides
> the viewport at a normalized anchor and stops following pans and zooms —
> the FigJam/Miro pinned-note affordance, fully undoable.

### Added

- **The pin model** (`core/model/Pinned.ts`): `pinned` + `pinAnchor`
  (normalized 0..1 viewport fractions, physical top-left origin — never
  RTL-flipped) on `SceneObjectData`; pinnable kinds = top-level shape,
  text box, sticky note, image and sticker (connectors, freehand strokes,
  groups, frames, plugin widgets and query cards are world-attached by
  geometry and refuse the affordance); anchor math (screen↔fraction
  round-trips, clamping), `anchorOnPin` (the object's current on-screen
  spot), `worldOnUnpin` (the world point under the anchor — the exact
  drop), `pinnedScreenRect` and the nine-region `PIN_POSITION_PRESETS`.
- **`togglePinSelection`** (`SelectionOps`): pins at the current on-screen
  spot; unpinning pairs an `UpdateObjectCommand` (flag clear) with a
  `MoveCommand` landing the world position exactly under the anchor —
  the documented geometry-command exception, keeping derived geometry
  (freehand points, group members) consistent by construction. Mixed
  selections pin when ANY member is free; one composite history step.
- **`core.selection.togglePin`** (Mod-Shift-P): command + wiring
  (`ui.togglePin`), enabled while the selection holds a pinnable object;
  Persian notices «شیء روی صفحه سنجاق شد.» / «سنجاش شیء از صفحه برداشته
  شد.»; context-menu entry «سنجاق روی صفحه» after قفل (Pin icon).
- **Screen-space rendering**: DOM views (text boxes, sticky notes) render
  with `scale(1)` at the anchor, ignore camera rotation, never cull, and
  paint an amber ring + 📌 chip (`text-object-pinned` CSS); canvas kinds
  (shape, image, sticker) render in a SECOND pass with an identity camera
  and the position swapped for the anchor's pixels — every per-kind
  drawer works unchanged — plus a rounded amber ring + pin chip
  (`drawPinnedChrome`).
- **Screen-space interaction**: `hitTestPinned` resolves the screen
  footprint (anchor + intrinsic size); the world-space walk, the marquee
  and the R-tree spatial index all skip pinned objects (camera-stale
  footprints); the select tool gained `pin-press`/`pin-move` gesture
  phases — a pinned drag live-updates the anchor (press offset preserved,
  Shift axis-locked) and lands ONE `UpdateObjectCommand`; Escape restores
  the pre-gesture snapshot; pinned singles show no resize/rotate handles;
  double-click edits a pinned note in place; world drags skip pinned
  members (screen furniture never follows).
- **Inspector Pin section** (`core.inspector.pin`, order 83): state
  banner (amber while pinned), the dynamic toggle («سنجاش به صفحه» /
  «برداشتن سنجاق»), the live anchor readout with locale digits
  («از چپ: ۴۱٫۴٪ · از بالا: ۲۹٫۵٪») and the 3×3 position grid — nine
  labelled presets snapping the object to the screen regions, each ONE
  undo step (`model.setPinAnchor`).
- **Persistence**: `pinned` + `pinAnchor` round-trip through the `.icb`
  wire format; absent = unpinned (pre-Phase-25 files load unchanged) and
  wrong-typed values drop the pin without refusing the object.

### Changed

- `core.view.fitAll` excludes pinned objects (their world bbox is
  camera-stale and never constrains the fit).
- The inspector model (`useInspectorModel`) gained `togglePin` +
  `setPinAnchor` (command-backed, one undo step each).

### Fixed

- `HandlesRenderer.drawSelectionHandles` gained a viewport parameter and
  draws the pinned selection ring in SCREEN space (dashed accent frame
  around the anchor + intrinsic size) — pinned objects never join the
  world union or show phantom world handles.

## [1.31.0] — Phase 24: the rich Word interop (2026-09-15)

> The clipboard bridge learns Word's actual language: pasted formatting
> SURVIVES (headings, lists, tables, links, bold/italic/underline/strike),
> and multi-object selections copy OUT as a transparent PNG snapshot.

### Added

- **Rich Word paste-in** (`text/editor/htmlImport.ts` +
  `ui/clipboard/richPasteImport.ts` + `insertRichTextBoxAt`): a clipboard
  payload carrying `text/html` (Word / Excel / Google Docs / a web page) is
  sanitised through the R3B.5 allow-list, then parsed into a TipTap document
  through ProseMirror's OWN DOM parser bound to the shared editor schema —
  the exact parse rules the live editor applies to its pastes. Formatted
  payloads land as a RICH text box (the `doc` is the source of truth, the
  plain projection keeps the legacy `text` field, FIXED width = Word-like
  wrapping, table-aware size heuristic `cols × 110`); unformatted payloads
  keep the byte-identical Phase-23 plain-box behaviour; over-long HTML
  (>200KB) falls back to plain. Persian notice
  «متن قالب‌بندی‌شده با حفظ سرتیترها، فهرست‌ها و جدول‌ها در بوم چسبانده شد».
- **Multi-object copy as an image** (`ui/clipboard/selectionRaster.ts` +
  `writeSelectionImageToSystemClipboard`): copying/cutting a selection that
  is NOT a lone image or a lone text object — multi-object clusters, lone
  shapes, frames, connectors, stickers, freehand strokes — rasterises the
  selection into a TRANSPARENT 2× `image/png` through the export pipeline
  (canvas layer + rasterised rich text layer with embedded Vazirmatn) and
  writes it in ONE `ClipboardItem` together with the plain-text projection
  (when present), so Word / PowerPoint / Photoshop receive the snapshot
  while plain-text consumers still find the words. A rasterisation failure
  degrades to the text-only write (never a silent loss); the CUT path
  snapshots the subset scene BEFORE the removal.
- **«کپی به‌صورت تصویر» command** (`core.edit.copyAsImage`, Mod-Alt-C):
  the EXPLICIT snapshot — ANY selection rasterises (even a lone text box);
  context-menu entry after کپی/برش + command-palette presence; Persian
  notice «تصویرِ انتخاب در حافظهٔ سیستم کپی شد».

### Changed

- **Word fake-list paragraphs now merge into ONE list** per Word's own
  `mso-list:lNNN` id (Phase 23 emitted a separate `<ul>` per paragraph,
  slicing every Word list into fragments); deeper `levelN` paragraphs
  continue the NESTED list inside the parent level's last item, so
  two-level Word lists survive with real nesting. The legacy
  following-REAL-list continuation rule is kept for id-less payloads.
- The context menu's object cluster renumbers to fit «کپی به‌صورت تصویر»
  (کپی → برش → کپی به‌صورت تصویر → تکثیر → …).

### Fixed

- **XML void-element normalisation in the DOM rasterizer** (فاز ۲۴'s
  headline fix, `DomRasterizer.xmlNormalizeFragment`): the browser's HTML
  serialisation leaves VOID elements — the rich-text table's `<col>`,
  hard-break `<br>`, `<hr>` — UNCLOSED, which is valid HTML but INVALID
  XML; ONE unclosed `<col>` made the whole SVG rasterization image fail
  to load, so EVERY PNG (and SVG) export of a canvas containing a table
  or hard break silently died with «rasterization: SVG image failed to
  load». The fragment now round-trips through DOMParser → XMLSerializer
  (every void closed, every entity escaped) before entering the SVG —
  verified live: the selection snapshot round-trips into a real 708×490
  `<img>` through the actual system clipboard.
- `buildSelectionSubsetScene` preserves the PARENT scene's paint order
  (selection-order snapshots could stack copied objects differently than
  they appear on the canvas).

## [1.30.0] — Phase 23: the clipboard bridge (2026-09-15)

> The interop round the canvas was missing: a REAL two-way clipboard with
> the outside world — Word, Photoshop, After Effects, web pages — plus the
> original-size contract for resized images.

### Added

- **Copy / Cut / Paste commands** (`core.edit.copy` Mod-C · `core.edit.cut`
  Mod-X · `core.edit.paste`) — the in-canvas selection clipboard
  (`core/clipboard/SelectionClipboard.ts`): deep-cloned payload with the
  top-level ids and a bbox anchor, paste re-materialises with FRESH ids at
  the viewport centre with a burst cascade (ONE composite undo step),
  groups re-map their membership, cut removes in one step and the buffer
  survives undo. Context-menu entries «کپی / برش / چسباندن» join the
  palette.
- **The OS-clipboard bridge** (`ui/clipboard/osClipboard.ts`): copying a
  text-bearing selection writes `text/plain` to the SYSTEM clipboard
  (pastes into Word/mail); copying a single IMAGE writes `image/png`
  rendered from the ORIGINAL source at its INTRINSIC pixel size — a
  resized-on-canvas picture still leaves the canvas at original quality
  (Photoshop / After Effects receive the full-resolution bitmap).
  `core.image.copy` («کپی تصویر (اندازهٔ اصلی)») is the image-kind
  context-menu entry.
- **Smart Mod-V routing** (`useCanvasShortcuts`): a filled internal
  buffer claims the key (the paste command, double-import suppressed by a
  150ms window); an EMPTY buffer lets the browser paste event flow to the
  import bridge — OS images import at original quality, OS TEXT becomes a
  text box at the viewport centre (Word → canvas now works both ways).
- **External drag-and-drop payloads** (`core/clipboard/DropPayload.ts` +
  the bridge): dragged TEXT and dragged WEB IMAGES (`text/html` `<img
  src>` / `text/uri-list`, no File) land EXACTLY on the drop point;
  image URLs are fetched and imported at original quality, CORS/offline
  failures degrade into a text box carrying the address (Persian notice);
  `dragover` now claims text/uri-list/html drops so the browser never
  navigates away; panel inputs/inputs keep their native paste/drop.
- **The image original-size inspector section** (`ImageSection`,
  `core.inspector.image`): preview tile, intrinsic size readout
  («اندازهٔ اصلی: ۱۶۰۰ × ۹۰۰ پیکسل»), current-vs-original scale, current
  vs natural ratio with deviation warning tint, and the two resets —
  «بازنشانی نسبت (با حفظ عرض)» and «بازنشانی به اندازهٔ اصلی»
  (centre-preserving, each ONE `ResizeCommand` undo step); also
  `core.image.resetSize` from the palette. `naturalResetPatch` /
  `ratioResetPatch` live on the model (pure, node-tested).
- 37 new i18n keys (fa/en): clipboard.*, image.reset*/naturalSize/
  ratio*, inspector.image.

### Fixed

- The paste import bridge now skips native form fields (panel search
  boxes, dialogs, the command palette) — plain-text paste into a search
  input no longer risks canvas side effects.

### Tests

- NEW `tests/core/clipboard/SelectionClipboard.test.ts` (10),
  `DropPayload.test.ts` (13), `ImageReset.test.ts` (11) — 1944/1944
  total. Command-catalog fixtures extended for the five new commands.

## [1.29.0] — Phase 22: the plugin marketplace (2026-09-15)

> **Workspace note:** the pre-rollback product round that was still
> missing — a rich «فروشگاه افزونه‌ها» catalog over the bundled
> first-party plugins + the official sample, with the SAME consent
> semantics as every other install path. Shipped as the user-facing
> «فاز ۲۲ — فروشگاه افزونه‌ها».

### Added

- **The plugin marketplace dialog** (`PluginMarketplaceDialog`) — a wide
  (max-w-3xl), fully RTL catalog rendered through a PORTAL to
  document.body (the dock panel's backdrop-blur creates a containing
  block that would otherwise confine the card): search (ZWNJ /
  Arabic-Yeh / tashkeel normalised matching over name + description +
  id), the four curated category chips (بهره‌وری · تحلیل و گزارش ·
  تقویم و دانش · نمونه و آموزش + «همه»), the «انتخاب سردبیر»
  featured banner (gradient-tinted, dailynotes), and a responsive
  card grid (1-col mobile / 2-col ≥sm) with icon tiles, version,
  two-line descriptions and Persian-digit permission counts (dots +
  count, tooltip = the full permission list).
- **The catalog module** (`src/plugins/host/pluginCatalog.ts`) — pure,
  unit-tested logic: the six bundled sources, the manifest → entry
  projection with the curated category map, query/category filtering,
  the install-state merge (absent / running / stopped / error off
  `listStatus()`, `starting` shows as running), and the featured
  split.
- **Live install states in the cards** — installation through the
  SAME consent step as the install dialog (the exact permission list
  precedes the accept; AC9.4 preserved), then the card flips to
  «در حال اجرا» / «غیرفعال» with enable/disable toggles, the
  two-choice inline uninstall confirm (حذف با آرشیو / حذف کامل),
  and everything refreshing live on `plugins:changed`.
- **Entry points** — the PluginManagerPanel header grew a labelled
  «فروشگاه افزونه‌ها» button and the empty state a «مرور فروشگاه
  افزونه‌ها…» CTA (dashed-card empty state with the store icon).
- **i18n** — 24 new `plugins.market.*` keys (fa/en).

### Fixed

- ESLint is now 0 errors / 0 warnings: the plugin-icon `<img>` usages
  are covered by a targeted `no-img-element` override (tiny bundled
  SVGs — next/image optimisation is meaningless for them) and the
  `phase-changed/` reference diff-bundle (shipped inside the phase-15
  upload, not authored source) is ignored.

### Tests

- `tests/plugins/marketplaceCatalog.test.ts` (23) — entry projection
  + curated categories + featured flag + icon paths + degraded
  fields, normalisation (ZWNJ/Arabic Yeh-Kaf/tashkeel/bidi), query
  AND-category filtering, the install-state merge mapping
  (running/stopped/error/starting/off/absent) and the featured
  split. **1910/1910 (157 files).**

## [1.28.0] — Phase 21: the daily-notes journal loop (2026-09-15)

> **Workspace note:** delivers the Knowledge Pack's closing phase —
> pack-14 (R14.1–R14.6): the first-party «یادداشت روزانه» plugin, the
> `app.scene` SDK seam it rides, the `dailies.entries` v1 contract,
> the AI Analyst + Reporter journal upgrades and the new automation
> triggers. Shipped as the user-facing «فاز ۲۱ — یادداشت روزانه».

### Added

- **The `scene` permission + the `app.scene` SDK surface (R14.1's
  substrate)** — the pack-14 seam letting a plugin create REAL core
  objects, not opaque plugin widgets: `insertText` (a genuine text box
  with structured properties, one undo step, fail-closed payload
  clamps), `insertFrame` (a genuine frame, optionally auto-layout
  `{dir, gap, padding, itemWidth}`), `addLink` (a plugin-owned
  LinkRegistry entry — kind "plugin", owner = the plugin, ONE undo
  step through the manual-link command precedent), `listLinks` /
  `removeLinksByOwner` (read + owner-scoped cleanup), `focusObject`
  (camera flight) and `notifyInfo` (Persian info toast). Wired through
  BOTH SDK twins (the canonical TS shim + the sandbox srcdoc twin);
  permission-checked fail-closed like every other surface.
- **The first-party `dailynotes` plugin (R14.1)** —
  `public/plugins-firstparty/dailynotes/`: five commands (today
  Ctrl+Alt+D / yesterday / tomorrow / prev / next), the «یادداشت
  روزانه» dock panel (today's Jalali date + calendar-status chip +
  degrade banner + the journal list with word counts + fly-to), a
  settings section (the note template with `{{date}}/{{dateFa}}/
  {{weekday}}/{{cursor}}` placeholders + note width). Today's note
  lands inside the auto-created «یادداشت‌های روزانه» column frame
  (auto-layout, append-at-bottom slots, created on first use);
  consecutive dailies chain through plugin-owned links («روز بعد»)
  that rebuild on re-enable; the Jalali title is bought from the
  `calendar.events` contract and degrades GRACEFULLY to Gregorian +
  a Persian notice when the calendar plugin is off (the hub's
  showcase degrade pattern, AC14.2).
- **The `dailynotes.entries` v1 contract (R14.2)** — `getEntries
  ({from?, to?})` → `{dateISO, objectId, title, wordCount, properties,
  backlinkCount}[]` straight off the scene's real text objects; the
  `entry-created` change (published on every creation) feeds the AI
  Analyst, the Reporter AND the automations engine.
- **AI Analyst journal upgrade (R14.3)** — the analysis payload now
  carries the structured journal (`journal: entries[]`) next to the
  digest + planner tasks; a NEW offline «ژورنال روزانه» summary card
  renders entries/total words/avg words/best day/streak with Persian
  digits — no network backend needed; degrades to a quiet notice when
  the dailynotes plugin is absent.
- **Reporter journal stats (R14.4)** — the dailies block: entries +
  total words header, avg/streak stat cards, the words-per-day RTL
  bar chart (teal) and the mood-trend RTL line chart (auto-detects the
  first numeric property beyond type/date/tags — e.g. `mood`); the
  text summary gains the journal lines; live refresh subscribes to
  `dailynotes.entries`; degrades behind a Persian notice.
- **Automation triggers (R14.5)** — the allowlist grows
  `datahub:changed:dailynotes.entries`, `datahub:changed:scene.query`
  and `object:linking-changed` (payload now carries `.type` =
  link-created/link-removed); change-type filters grow `entry-created`
  + `link-created`/`link-removed`; «create daily note» actions ride
  the command action (`dailynotes.today` appears in the builder's
  command dropdown automatically).

### Changed

- `PluginRuntime.stop()` (and therefore disable/uninstall) now removes
  every LinkRegistry entry the plugin owns (AC14.6: dailies stay as
  normal text objects; plugin-owned links vanish with the runtime) —
  the cleanup lives in the RUNTIME so both stop paths behave
  identically.
- The object read DTO (`app.objects.get/list`) now carries the
  plain-text projection of text objects (the dailies word-count
  source); the write surface stays the typed commands.

### Tests

- **1887/1887 (156 files, +16)** — NEW `tests/plugins/sceneSdk.test.ts`:
  the `app.scene` surface end-to-end over the REAL in-process SDK
  (insertText/insertFrame payload clamps, permission fail-closed,
  plugin-owned links with one-step undo, owner-scoped cleanup),
  the REAL dailynotes entry in-process (AC14.1 title/properties,
  AC14.3 chain, AC14.6 survive-stop) and the permission mapping.

## [1.27.0] — Phase 20: the knowledge graph ON the canvas (2026-09-15)

> **Workspace note:** completes the Knowledge Pack's remaining graph /
> visual sub-phase — R12.3 (the force-directed on-canvas arrange),
> R12.4 (the knowledge-edge overlay drawn between the objects) and
> R12.7 (the Search panel upgrade to the shared QuerySpec builder).
> Shipped as the user-facing «فاز ۲۰ — گراف دانش روی بوم».

### Added

- **`core/knowledge/GraphArrange.ts` (R12.3)** — the PURE deterministic
  force-directed layout of the whole wiki-link graph in world space:
  a fixed-iteration Fruchterman–Reingold relaxation (pairwise repulsion
  + spring attraction along the graph edges + a weak centroid gravity,
  linear cooling) seeded from the objects' CURRENT centres. No
  randomness anywhere (stable node order, FNV-1a hash tie-breaks), so
  the same scene always arranges to the same layout. Nodes are the
  resolved TITLES — a title shared by several objects is one node whose
  members land in a tight grid cluster; broken targets participate as
  ghost nodes (mass-full, no moves) so dangling sources feel their
  pull. The plan NEVER moves locked objects, group members, or objects
  fully inside an auto-layout frame; a node cap (260, degree-ranked)
  guards very dense graphs.
- **The `core.graph.arrange` command** — one composite undo step (a
  `MoveCommand` per object wrapped in a `CompositeCommand`), a Persian
  count toast («گراف دانش چیده شد — N شیء جابه‌جا شد.») and a
  fit-to-content camera flight so the laid-out graph lands in view.
  Registered in the `view` group (Network icon) + the command palette
  + the «گراف دانش» panel's new «چینش روی بوم» button.
- **`rendering/KnowledgeEdgeOverlay.ts` + the renderer pass (R12.4)** —
  the on-canvas knowledge-edge overlay: resolved links draw as accent
  quadratic arcs (per-pair deterministic arc side keeps A→B and B→A
  separated, ends trimmed to the object boxes, arrowhead when either
  end is selected); broken links draw as dashed red stubs ending in a
  ghost ring + the missing title's label (FNV-hashed stable direction
  — a stub never jumps between frames). Geometry resolves from the
  LIVE scene at paint time, so edges track dragged objects with zero
  extra invalidation; viewport culling + a 400-edge cap guard perf.
- **The overlay's surfaces** — `uiStore.knowledgeEdgesVisible` +
  `toggleKnowledgeEdges`; the `core.graph.toggleEdges` command
  (Ctrl+Shift+E, the view group) + the panel's pressed-state Spline
  toggle; the canvas host rebuilds the frame on every
  `knowledge:changed` / `selection:changed` (the highlight ids) and
  applies the toggle live.
- **The Search panel's «کوئری ساخت‌یافته» section (R12.7)** — the SAME
  QuerySpec builder the live-query cards use, inside search: filter
  rows (prop select incl. pseudo props + the closed operator set +
  value), sortBy + asc/desc toggle, groupBy, the 1..200 limit and the
  tag adder — running through the shared `runSceneQuery` engine. With
  a text query or tag chips active the structured rows INTERSECT the
  text results; alone they render as a grouped, sortable result list
  with fly-to rows. The exported pure helpers (`specRowsToFilters`,
  `filterGroupsBySpec`) carry the seam into node tests.

### Changed

- **The «گراف دانش» panel header** — the plain-text stats line became
  live pill badges (titles/links/broken/tags; the broken badge turns
  destructive red when > 0), the action row (arrange + edge toggle)
  sits above, and the graph canvas gained a rounded inner-shadow
  frame.
- **Search panel filter surface** — the R11.9 FilterPicker popover
  (tag + property-equality chips) is superseded by the structured
  builder; the tag chip bar REMAINS (it is the TagPane hand-off
  receiver, R11.4/AC11.5 — unchanged behaviour).
- Version 1.26.0 → **1.27.0** (fa/en + tauri.conf).

### Verified

- 30 new vitest tests (GraphArrange 13: eligibility, spring
  convergence band, determinism, shared-title clustering, locked /
  grouped exclusions, degenerate-pile spread, node+edge counts, ghost
  pull, the node cap; KnowledgeEdgeOverlay 10: projection, self-edge
  drop, broken stubs, dedupe, reciprocity, the 400 cap, stub
  determinism/range; SearchSpec 7: row normalisation, cap, operator
  validation, the intersection) → **1871/1871 (155 files)** ·
  `tsc --noEmit` clean · eslint 0 errors (3 pre-existing warnings).

## [1.26.0] — Phase 19: structured scene queries (2026-09-15)

> **Workspace note:** completes the Knowledge Pack's remaining
> Phase-12 core — R12.1 (the full `QuerySpec` engine, law §1.7.9), the
> R12.2 filter card (spec editor + grouped/columnar live results +
> the recursion guard) and R12.6 (the datahub `scene.query` v1 HOST
> contract for plugins). Shipped as the user-facing «فاز ۱۹ — کوئری
> ساخت‌یافتهٔ صحنه».

### Added

- **`core/knowledge/QueryEngine.ts` (R12.1, law §1.7.9)** — the pure
  structured-query engine: the JSON-serializable `SceneQuerySpec`
  `{filters: [{prop, op: eq|ne|gt|lt|contains|startsWith, value}],
  tagsAll?, tagsAny?, text?, linksTo?, kinds?, limit, sortBy?,
  groupBy?}` run against the scene + knowledge index. Property
  addressing includes the pseudo props `title`/`kind`; comparisons
  Persian-fold (ي/ك/ZWNJ + case) and parse Persian digits («gt ۴»
  matches `4`); `ne ""` reads as the existence check; missing values
  sort LAST in every direction; ordering is deterministic (numeric
  when both values are numbers, codepoint otherwise, object id as the
  tie-break); `limit` caps 1..200 (default 100) with `total`
  reporting pre-limit matches; `groupBy` buckets rows with formatted
  values (✓/✗ for booleans, « · » for tag arrays) + first-appearance
  group summaries.
- **`normalizeSceneQuerySpec`** — the defensive wire reader (§1.7.4):
  garbage ENTRIES drop, a garbage SHAPE refuses; limits clamp, lists
  clean/dedupe/cap. The same normaliser serves persistence, the card
  resolver and the datahub entry.
- **The `filter` query kind (R12.2)** — `QueryObjectData` gains the
  optional validated `querySpec` + the presentation `columns` (≤ 3,
  serialized with the project; a corrupt spec degrades to the
  all-match default — never a dropped card); a second Insert-Panel
  card «فیلتر ساخت‌یافته» (🧮) creates one; the canvas card draws
  group-separator rows (label + hairline + «بدون گروه» bucket) and
  the first column's value beside each title; the querying card's own
  id is the recursion guard (`excludeIds`).
- **The inspector's structured spec editor (R12.2, form — not free
  text)** — filter rows (prop select incl. pseudo props + op select +
  value input + per-row remove, ≤ 8, one undo step per edit),
  tagsAll/tagsAny comma lists with the tag datalist, the text
  substring, `linksTo` with the title datalist, object-kind toggle
  chips, sortBy prop + asc/desc toggle, groupBy, the 1..200 limit and
  the ≤ 3 column selects — under the live results table with group
  headers, per-group counts, the «نمایش N از M» cap notice and
  fly-to rows.
- **The `scene.query` v1 datahub HOST contract (R12.6)** —
  `datahub/contracts/sceneQuery.ts` registers `run(spec)` +
  `onSceneChanged()` on the hub (read-only, versioned, the
  `project.digest` pattern); App.ts publishes
  `{type: "scene-changed"}` on scene + knowledge churn; version
  mismatches answer the typed Persian notice (AC12.6), garbage specs
  degrade as provider-errors — never a crash.
- **`ObjectPatch` gains `querySpec` + `columns`** — the structured
  spec and the column list swap in ONE undo step (the properties
  precedent).

### Tests

- `tests/knowledge/QueryEngine.test.ts` (25) — every operator over
  every wire type (strings/numbers with Persian digits/booleans with
  the truthy spellings/ISO dates/tag arrays), folded contains/
  startsWith, tagsAll/tagsAny (text-#tags + the structured property),
  text, linksTo, kinds, the recursion guard, sort asc/desc +
  missing-last + determinism, groupBy buckets + counts, limit/total,
  the normaliser's clamps/drops and the column formatter.
- `tests/datahub/sceneQuery.test.ts` (6) — the contract serves rows
  through the hub, the cheap poll, the version/provider-error/method/
  no-provider degrade paths with the Persian notices, and the change
  publisher's fan-out.
- Updated `objectTypes-query` (filter round-trip + corrupt-spec
  degrade + the two catalog cards) and `CatalogInsert` (the 18-card
  order + the 🧮 preview).

## [1.25.0] — Phase 18: manual links & the tag pane (2026-09-15)

> **Workspace note:** completes the Knowledge Pack's remaining
> Phase-11 items — R11.4/AC11.5 (the TagPane dock panel), R11.2's
> LinkRegistry (law §1.7.8's store for manual/plugin links, with the
> Obsidian dangling→auto-resolve magic), R11.6 (manual links from the
> context menu + the target picker + per-link removal) and R11.10 (the
> SDK surface: properties/styleId on object DTOs +
> `object:linking-changed`/`object:properties-changed` on the plugin
> event allowlist). Shipped as the user-facing «فاز ۱۸ — پیوندهای
> دستی و پنل برچسب‌ها».

### Added

- **`core/knowledge/LinkRegistry.ts` (R11.2, §1.7.8)** — the single
  source of truth for every NON-TEXT object link (wiki links stay
  intrinsic to the text and parse as projections): `ObjectLinkEntry
  {id, sourceId, targetId?, targetTitle, kind: 'manual'|'plugin',
  label?, ownerId?, createdAt}`, change subscriptions with drained
  added/removed diff counters, a dead-entry-filtering section builder
  (source-gone entries drop at SAVE time; dangling-by-title entries
  SURVIVE) and a defensive wire reader (corrupt rows skip, never
  crash).
- **Obsidian-style resolution (R11.2)** — `resolveLinkTarget`: the
  stored target id wins while the object exists; a deleted target
  dangles by its title snapshot and AUTO-RESOLVES the day an object
  with that title appears; undoing an object deletion re-activates the
  id link with zero bookkeeping (entries are never eagerly pruned in
  memory — AC11.4's behaviour falls out of the fold).
- **Knowledge-index Pass 4 (projections)** — `buildKnowledgeIndex`
  folds registry entries: outgoing rows carry `kind` + `linkId`,
  backlinks gain kind icons, dangling manual links join the broken
  titles, and `linkResolution` (entry id → resolved target) rides the
  index; `KnowledgeService` gains the `getLinks` seam +
  `resolvedTargetOfLink()`.
- **Manual-link UI (R11.6)** — the context menu gains
  «لینک به این شیء…» (`core.knowledge.linkTo`, single-selection) and
  «حذف پیوندهای دستی این شیء» (`core.knowledge.unlinkAll`, enabled
  only when outgoing manual links exist); the new
  `LinkTargetPickerDialog` lists every other object (kind icon +
  title + label, searchable, titled-first) and creates the link as ONE
  `AddManualLinkCommand`; the inspector's knowledge section renders
  manual rows with kind icons + per-link remove buttons (one undo step
  each) and the picker manages existing links live.
- **Link commands** — `addManualLinkCommand` /
  `removeManualLinkCommand` / `removeAllManualLinksCommand` (composite,
  manual-kind-only): one undo step each, mutating ONLY the registry —
  projections re-derive on the scheduled rebuild.
- **TagPane dock panel (R11.4/AC11.5)** — `core.panels.tags` (Hash
  icon): live tag rows «برچسب · N» (count DESC → Persian display ASC),
  a dashed empty-state teaching both tag sources, and clicking a row
  OPENS the Search panel with the tag chip applied (through the new
  `ui:search-filter-tag` bus event; the emit defers one macrotask so
  the chip lands even when the panel was closed).
- **SDK surface (R11.10)** — `toJsonish` object DTOs gain
  `properties` (+ the loose `styleId` when applied); the plugin event
  allowlist gains `object:linking-changed` (added/removed/resolved/
  total) and `object:properties-changed` (changed object ids), both
  emitted from the composition root's debounced knowledge pass.
- **`links` project-file section (schema v3, no bump)** — the optional
  persisted link registry (absent = no links; pre-Phase-18 files read
  as link-less); rides the autosave slot, the Ctrl+S disk save, the
  version-history snapshots AND the restore path.

### Fixed

- **The Save-As section-loss bug (pre-existing)** — the typed-path,
  native-dialog, web-picker and download fallback saves serialized
  ONLY scene + plugins, silently dropping bookmarks/styles/
  propertySchema; the new `ProjectSaveSections` bundle now rides EVERY
  save route (`SaveAtPathDialog` + `DocumentCloseGuard` collect it
  from the live services) and the Ctrl+S path gains the links section.

### Changed

- The debounced knowledge pass now also diffs structured properties
  (`object:properties-changed`) and link resolution transitions, and
  registry mutations schedule a rebuild (links change without a
  scene:changed).

## [1.24.0] — Phase 17: structured object properties (2026-09-15)

> **Workspace note:** completes the Knowledge Pack's R11.3 + R11.8 +
> R11.9 (the typed `properties` record, the inspector Properties
> section and the search filter chips — the data foundation the
> Phase-12 QuerySpec will filter on). Shipped as the user-facing
> «فاز ۱۷ — ویژگی‌های ساخت‌یافتهٔ اشیاء».

### Added

- **Typed properties on every object (R11.3)** — `SceneObjectData`
  gains an optional `properties: Record<string, string | number |
  boolean | ISODate | string[]>` riding the wire of every object kind
  (the `writeObject` spread persists it; `readCommonFields` validates
  it): a pre-Phase-17 file opens with none (absent field), wrong-typed
  entries drop without refusing the object (§1.7.4 survives), and the
  full record round-trips save→reopen identically (live-verified
  through autosave + reload + recovery).
- **`core/model/Properties.ts` (pure)** — the five value shapes, the
  six editor types (`text`/`number`/`date`/`boolean`/`select`/`tags`),
  first-use type inference (ISO-date strings and date-like NAMES bias
  `date`; arrays are `tags`; `select` only ever assigns explicitly),
  editor coercion (Persian/Arabic-Indic digits «۳» → 3, comma/، tag
  splitting with dedup + caps), defensive wire validation, display
  formatting and the R11.9 Persian-folded equality comparison.
- **`PropertySchemaStore` (service)** — the project's memory of known
  property names → type (+ `select` options), inferred on first use,
  explicitly assignable, persisted as the project file's optional
  `propertySchema` section (schema v3 — no version bump needed; the
  absent field reads as "no known fields"); schema edits mark the
  document dirty but are NOT undoable (they re-type editors, never
  values — the styles precedent). Broadcasts `property-schema:changed`
  through the typed bus; the autosave slot now carries the styles AND
  schema sections (a crash no longer loses them).
- **Inspector PropertiesSection (R11.8)** — registered as
  `core.inspector.properties` (target `*`): per-type editors (text,
  decimal-mode number accepting Persian digits, native date with a
  Jalali tooltip, checkbox, select with schema options + out-of-list
  values kept visible, tags editor with live rose chips), an add-row
  (name datalist of known names + type picker + select-options input),
  per-row remove, count badge, dashed empty-state hint, and ONE undo
  step per edit (the whole record swaps through a single
  `UpdateObjectCommand`; undo/redo verified live).
- **Search filter chips (R11.9)** — the Search panel gains a
  structured-filter bar: tag chips (live from the knowledge index) and
  property-equality chips (from the schema's known names) ANDed
  together in a direct scan; with filters alone, matching objects list
  as a browsable result set; every chip is removable and the active
  count shows on the filter toggle.
- **Property tags in the knowledge index (R11.4)** — the structured
  `tags` property folds into the SAME tag index as text `#tags`
  (Pass 3 of the index builder): the graph panel stats, the live
  `tag` queries and the search chips all see one truth, and ANY object
  kind can carry tags (not just text-bearing ones).

### Fixed

- **The `[[` autocomplete empty state** — typing `[[` in a project
  with ZERO titles now opens the popup with a teaching hint row
  («هنوز عنوانی ثبت نشده — تایپ کنید…») instead of silently showing
  nothing; the create-new row takes over as soon as a query is typed.

### Details

- Tests: 55 new (model 27, store 10, persistence 8, search+index 13)
  — **1786/1786 total (148 files)** · tsc clean · eslint 0 errors.
- Live E2E (agent-browser): add select (with options) → set value →
  Ctrl+Z reverts → Ctrl+Shift+Z redoes; add number → type «۳» →
  committed as 3 (displayed, persisted, restored after reload);
  tags chips; boolean بله; search tag chip + property chip ANDed;
  knowledge-graph stats counting property tags; the `[[` hint row —
  zero console/page errors. VLM visual check passed.
- Version strings → 1.24.0; `app.phase` → «فاز ۱۷ — ویژگی‌های
  ساخت‌یافتهٔ اشیاء».

## [1.23.0] — Phase 16: the wiki-link autocomplete (2026-09-15)

> **Workspace note:** completes the Knowledge Pack's R11.5 (the `[[`
> suggestion popup that was specced in the pack's Phase 11 but skipped
> by the rebuild's scope decisions — DECISIONS #35). Shipped as the
> user-facing «فاز ۱۶ — پیشنهاددهندهٔ ویکی‌لینک».

### Added

- **The `[[` autocomplete popup (R11.5)** — typing `[[` inside EITHER
  text-editing surface (the shared TipTap editor of text boxes AND the
  legacy sticky-note contenteditable session) opens a floating,
  fully-Persian/RTL suggestion popup: the project's titles ranked for
  the typed query (startsWith first, then contains, each in document
  order; Persian/Arabic keyboard drift ي/ك → ی/ک folded through the
  knowledge normaliser), plus a «ایجاد «…» و پیوند به آن» row for
  unknown titles — picking it plants a DANGLING link that auto-resolves
  the day an object with that title appears (the Obsidian magic, now
  typed end-to-end). Keyboard-complete: ↑/↓ navigate, Enter/Tab insert,
  Esc closes the popup first (the next Esc exits editing — the popup's
  capture-phase handler swallows exactly one); rows are mouse-clickable
  (mousedown-guarded so the editor selection survives); the list is
  capped at 8 rows with the live match count («N عنوان همسان») in the
  footer.
- **Pure ranking/detection module** (`text/editor/wikiAutocomplete.ts`):
  `detectOpenWikiQuery` (last-open `[[` span, closed-span/newline/paste-
  blob guards), `rankWikiSuggestions` (bucket ranking + normalisation),
  `shouldOfferCreateNew` (exact-key refusal) — zero DOM deps, fully
  unit-tested.

### Changed

- The popup is one DOCUMENT-level surface (`selectionchange` probes the
  caret after every keystroke — no per-editor integration), mounted in
  the AppShell next to the other floating text surfaces; it refreshes
  its title list on every `knowledge:changed` (titles created elsewhere
  appear while you type).
- Version strings → 1.23.0; `app.phase` → «فاز ۱۶ —
  پیشنهاددهندهٔ ویکی‌لینک».

### Details

- Tests: 16 new (detect 7, rank 6, create-new 3 — including true
  Arabic-keyboard-drift fixtures) — **1731/1731 total (144 files)** ·
  tsc clean · eslint 0 errors (1 pre-existing intentional `<img>`
  warning).
- E2E (agent-browser): typed `[[` in a live sticky session → the popup
  listed the project's titles; typing `هت` ranked «هدف نهایی» first;
  Enter completed the span into `[[هدف نهایی]]` (popup closed, text
  landed); the create-new row appeared for an unknown title («مقاله
  بعدی») and Enter planted the dangling link, which the inspector's
  knowledge section immediately showed as «ناموجود» — the full
  R11.5 → AC11.2 pipeline in one flow.

## [1.22.0] — Phase 15: knowledge graph & live queries (2026-09-14)

> **Workspace note:** rebuild-queue item (b) from the Task-6 audit
> handover — the Knowledge Pack's graph/query phase re-implemented on
> the v1.21.0 base, shipped as the user-facing «فاز ۱۵ — گراف دانش و
> کوئری زنده».

### Added

- **The knowledge-graph panel (R15.1)** — «گراف دانش» (right dock,
  `core.panels.knowledgeGraph`, Network icon, order 57): the whole
  wiki-link graph at a glance. Real nodes are the resolved TITLES
  (sized by degree, the busiest at the CENTRE of a deterministic radial
  ring layout), directed edges carry arrowheads, and BROKEN targets
  appear as dashed red ghost nodes on an outer ring. The header shows
  the live stats («۳ عنوان · ۱ پیوند · ۰ گمشده · ۱ برچسب»), tag chips
  fly to their first object, and clicking a node selects + flies to it
  on the canvas. Re-renders on every `knowledge:changed`.
- **The pure layout (`core/knowledge/GraphLayout.ts`)** —
  `layoutKnowledgeGraph(index, width, height)`: a deterministic
  (key-sorted) radial layout with degree-ranked centre, deduped edges
  and ghost collection — no physics, no animation, no dependencies;
  the graph never jumps between rebuilds.
- **The live query object (R15.2)** — the 11th core kind `core.query`
  («کوئری زنده»): a canvas card that runs ONE query over the knowledge
  index and renders the LIVE rows. Four query kinds: `backlinks` (who
  links `[[هدف]]`, with snippets), `tag` (the objects of `#برچسب`),
  `broken` (every unresolved link, the missing title as row detail)
  and `orphans` (titled objects with no links and no tags — the
  islands). The card stores ONLY the spec (`queryType` + `queryTarget`)
  — results are computed at render time from the service snapshot, so
  they never persist, never enter undo, and can never go stale.
- **The query engine (`core/knowledge/KnowledgeQueries.ts`)** —
  `runKnowledgeQuery(index, spec)`: pure, target-normalised (Persian/
  Arabic keyboard folding re-used), with a `missingTarget` flag for
  absent titles/tags.
- **The inspector query section (`core.inspector.query`)** — the
  editing surface of a selected card: query-kind select, target input
  with the project's titles/tags as datalist suggestions, live count +
  fly-to result rows, and the missing-target notice. Every spec edit
  is ONE `UpdateObjectCommand` (one undo step).
- **Insert surface** — the «دانش» group in the Insert Panel with the
  «کوئری زندهٔ دانش» card (🔍 preview, defaulting to the targetless
  islands query — useful on any project), its own
  `core.insert.query.live` command (palette + panel share the id) and
  a `core.view.panel.knowledgeGraph` toggle command.

### Changed

- `Canvas2DRenderer` gained `drawQuery` (screen-space typography — the
  connector-label convention: fixed font, the visible row count adapts
  to the card's on-screen height) fed by two palette-injected seams:
  `queryLabels` (i18n) and `queryResolver` (runs the query against the
  service snapshot — the renderer stays framework-free).
- `CanvasSurface` repaints on `knowledge:changed` (the debounced
  rebuild pipeline) so cards re-resolve without any scene mutation.
- `UpdateObjectCommand`'s patch union gained `queryType`/`queryTarget`.
- Version strings → 1.22.0; `app.phase` → «فاز ۱۵ — گراف دانش و کوئری
  زنده»; Layers panel maps the `query` kind (Search icon).

### Details

- Tests: 22 new (QueryObject 3, objectTypes-query 6, KnowledgeQueries
  6, GraphLayout 7) + 3 enumeration specs updated for the 11th kind —
  **1715/1715 total (143 files)** · tsc clean · eslint 0 errors (1
  pre-existing intentional `<img>` warning).
- E2E (agent-browser): live tag-query card — typed target «مهم» →
  «نتایج زنده (۱)»; creating ANOTHER `#مهم` note updated the card to
  (۲) with zero interaction (the live pipeline end-to-end); the graph
  panel listed «۳ عنوان · ۱ پیوند · ۱ برچسب», the tag chip «مهم · ۲»,
  and a centre-node click flew the camera ۱۰۰٪ → ۱۹۵٪; pixel proof of
  the rendered card (41,751 fill px + 311 accent text px); the insert
  undo step verified (۵ → ۴ objects).

## [1.21.0] — Phase 14: knowledge links — the wiki-link graph, REBUILT (2026-09-14)

> **Workspace note:** this is rebuild-queue item (a) from the Task-4
> handover — the Knowledge Pack's wiki-link phase (the wiped pack Phases
> 11–12 lineage) re-implemented on the v1.20.0 base, shipped as the
> user-facing «فاز ۱۴ — پیوندهای دانش».

### Added

- **The wiki-link grammar (`core/knowledge/WikiLinks`)** — a deliberately
  tiny, lossless text grammar: `[[عنوان]]` links + `#برچسب` tags, parsed
  from every text-bearing object's plain text. `normaliseKnowledgeKey`
  folds the Persian/Arabic keyboard drift (Arabic ي/ك → Persian ی/ک,
  ZWNJ drops, whitespace collapse, latin casefold) so links resolve
  across keyboards. Link spans terminate at the FIRST `]]` (single
  brackets live inside a title; nested structures never balance). Tag
  starts are word-boundary anchored with a Persian carve-out: a ZWNJ
  inside the preceding token («می‌شود#برچسب») still reads as a fresh tag
  start, while «کلمه#داخل» and «##دابل» stay rejected; numbers-only
  tags are noise.
- **The knowledge index (`core/knowledge/KnowledgeIndex`)** — a PURE
  fold over the scene: titles (custom name > first H1/H2/H3 heading >
  PLAIN first line with wiki markup stripped — a line that is nothing
  BUT `[[links]]`/`#tags` yields no title, so a link-note never becomes
  a resolution target of its own links), directed outgoing links
  (deduped by key), backlink rows with text snippets, broken (red)
  titles and the tag index. An empty scene returns the SHARED
  `EMPTY_KNOWLEDGE_INDEX` singleton (reference-equal snapshots, no
  per-rebuild allocation).
- **The live service (`core/knowledge/KnowledgeService`)** — the index
  holder rebuilt from the scene seam, debounced 250 ms after the last
  `scene:changed` (its own schedule; it only ever reads), fanning out
  `knowledge:changed` with aggregate stats (titles/links/backlinks/
  tags). Registered as `Services.knowledge` at boot.
- **The inspector knowledge section (`core.inspector.knowledge`)** —
  the wiki surface of the selection: outgoing chips (resolved = fly-to
  on click; broken = red/dashed «ناموجود»), incoming backlink rows
  (fly-to + select the source, with the snippet around the link) and
  `#tag` chips with counts. Renders only for a single selection with
  knowledge data; a syntax hint teaches the grammar on text-bearing
  objects otherwise.

### Fixed

- **Critical render-loop freeze on the «بازرس» tab**: `InspectorPanel`'s
  section-resolve effect ran deps-less and set a FRESH array on every
  pass (an infinite render loop since Phase 7 — the heavy Phase-13
  sections turned it into a full-page freeze). The section list now
  re-resolves only when the selection's KINDS change (`kindsKey`), with
  the live kinds kept in a ref outside the deps (React-compiler safe).
- Four red tests at the previous HEAD: nested-bracket link matching,
  the ZWNJ tag boundary, the empty-scene singleton and the
  markup-only-first-line title (all implemented as specified above);
  two test-side `.sort()` calls on readonly arrays replaced with
  spread+sort.

### Details

- Version 1.20.0 → **1.21.0** (fa/en i18n + tauri.conf), app.phase
  «فاز ۱۴ — پیوندهای دانش».
- Tests: 45 new (WikiLinks 23, KnowledgeIndex 16, KnowledgeService 6;
  the knowledge folder totals 61 with the Phase-13 LayoutService/
  StyleRegistry suites) — **1693/1693 total (139 files)** · tsc clean ·
  eslint 0 errors (1 pre-existing intentional `<img>` warning).
- E2E (agent-browser): sticky note «رجوع به [[هدف نهایی]] با #مهم» →
  the section lists the outgoing chip as «ناموجود» + the tag «مهم · ۱»;
  creating the note «هدف نهایی» → the link RESOLVES (chip loses the
  broken state) and the target's «پیوندهای ورودی» shows the source row
  with its snippet; the «بازرس» tab opens with sections for rectangle,
  frame («چینش خودکار قاب») and text objects with no freeze; zero
  console errors.

## [1.20.0] — Phase 13: interop & scale — the Knowledge Pack's third phase, REBUILT (2026-09-14)

> **Workspace note:** a sandbox rollback wiped Tasks 4–13 (v1.20.0→v1.28.0
> lineage) from disk; this entry re-implements the pack's Phase 13
> (R13.1–R13.5) on the surviving v1.19.0 base. The intermediate product
> phases (marketplace, drag-insert, pinned stickers, wiki-links pack
> phases 11–12) are gone and re-scheduled; R13.6 stays deferred per the
> pack's own clause.

### Added

- **Named styles (R13.3)**: `core/knowledge/StyleRegistry` — `text`
  (family/size/weight/colour/line-height) and `color` (fill/stroke)
  kinds; the theme headings + default colour pair ship as READ-ONLY
  built-ins (`core.*` owner ids); user styles (`user.*`) create/edit/
  delete through the style-editor dialog. Applying stamps `styleId` AND
  the mapped fields in ONE composite undo step; a style EDIT restamps
  usages through deterministic old-value matching — local overrides
  survive (AC13.4). Per-object `fontWeight`/`lineHeight` on text boxes
  (honoured by the text view); `styles:changed` event; the styles
  section persists with the project (schema v3 + `MigrationV2toV3`,
  purely additive).
- **Auto-layout frames (R13.4)**: `FrameObject.layout`
  (dir/gap/padding/itemWidth) + the PURE `core/knowledge/LayoutService`
  (column/row slots ordered by the children's CURRENT geometry — a drag
  REORDERS; top-left-corner containment; the frame grows to wrap
  content but never shrinks; `fill` width stretches fixed-width text
  boxes only — no auto-width ping-pong). The debounced reflow (350ms
  after the last scene mutation) applies as ONE composite undo step;
  the epsilon guard makes an unchanged plan a no-op (never a loop).
  Connectors, freehand, group members and nested auto-layout frames
  stay out of flows (single-level, DECISIONS). Inspector frame section
  (`core.inspector.frameLayout`).
- **Markdown interop (R13.1)**: `persistence/MarkdownInterop` — export
  (one .md per text-bearing object, Persian-safe title slugs, YAML
  frontmatter identity, rich runs projected with marks, `[[wiki]]`
  text preserved, lossy `index.md` map for non-text objects) + import
  (markdown-it → TipTap doc; frontmatter → geometry/colours/kind;
  corrupt blocks degrade, never crash). The interop dialog
  (`core.export.markdown` / `core.import.markdown`, project menu):
  fflate ZIP download, multi-file import as ONE undoable batch.
  AC13.1 round-trip verified on the adapted Appendix-G fixture.
- **One-way Markdown mirror (R13.1/AC13.2)**: after every disk save,
  the project re-exports to `<project>.icb.md/` (web: the new
  `/api/fs/mirror` route with root-guards + per-file validation;
  desktop: source-level). Settings toggle + the Persian one-way notice.
- **Deep links (R13.2)**: `platform/tauri/deeplink` — the
  `infinitecanvas://open?project=&object=&view=` scheme (parse/build
  pure, URL-decoded); the web fallback reads the same params from the
  `#open?…` hash (cold-boot landing + hashchange); landing flies the
  camera (object pulse / bookmark camera); invalid parameters surface
  Persian error toasts (AC13.3). `core.link.copyDeepLink` copies the
  selection's link.
- **Static-text raster cache (R13.5)**: `rendering/StaticTextCache` —
  the warm/cold policy (5s after edit-exit; never cold while editing),
  content signatures, zoom-drift > 2× lazy re-raster (the stale bitmap
  keeps drawing — never a blank frame), an LRU capped at 300 with node
  re-show on eviction, and the `rasterIfDue` production seam. Fully
  virtual-clock tested; the DOM/canvas wiring lands with the renderer
  integration round.

### Details

- File format **v3** (PROJECT_FILE_VERSION, MigrationV2toV3); styles
  threaded through buildProjectData/applyProjectData/autosave/disk
  saves; writeProjectFile carries bookmarks + styles.
- The command palette + project menu gained the Markdown entries;
  `wiring.ui.openMarkdownDialog/copyDeepLink`; `ui:markdown-dialog-
  requested` event.
- R13.6 (multi-window) DEFERRED per the pack's own deferral clause —
  DECISIONS entry.
- Dependencies pinned: markdown-it@15.0.2 (MIT), js-yaml@5.4.2 (MIT),
  @tauri-apps/plugin-deep-link@2.4.9 (MIT/Apache-2.0), fflate@0.8.3
  (MIT) — Appendix H discipline.
- Tests: 45 new (StyleRegistry 8, LayoutService 6, MarkdownRoundTrip
  8, MigrationV2toV3 5, deeplink 8, StaticTextCache 8, + version-bump
  updates across the persistence suite) — 1648 total.

## [1.19.0] — Phase 12: sticker library (2026-09-13)

The sticker vocabulary grows from 8 curated cards to a full searchable
library — 233 glyphs across nine categories, findable in Persian OR
English (with Arabic yeh/kaf unification so «كدنویسی» finds «کدنویسی»),
with a persistent recents row remembering the last 12 picks. 27 new
tests (1603 total).

### Added

- **Sticker library core (R12.1)** — `core/stickers/StickerLibrary.ts`:
  233 emoji entries in 9 categories (smileys, gestures, hearts, animals,
  food, activities, travel & nature, objects, symbols), every entry
  carrying bilingual keywords. `searchStickers` uses TOKEN-AND matching
  (every whitespace token must hit some keyword — «thumbs up» finds 👍)
  plus paste-an-emoji-to-find; `normalizeStickerQuery` folds case and
  whitespace, unifies Arabic ي/ك with Persian ی/ک and turns ZWNJ into a
  plain space. The curated 32-glyph quick palette now lives here too
  (`CURATED_STICKERS`) so panel + inspector + picker can never drift.
- **Sticker picker dialog (R12.1)** — `StickerPickerDialog`: search box
  (autofocused), category tab strip («همه» + 9 tabs), a 10-column grid
  with the shared `panel-scroll` scrollbar, and a recents row. Picks
  insert at the viewport centre through `insertStickerObject` (ONE
  AddObjectCommand = exactly one undo step) with a session cascade so
  consecutive picks fan out instead of stacking; the dialog stays open
  for multi-insert sessions. `Ctrl+Shift+K` («کتابخانه») opens it, as do
  the command palette and the new Insert-Panel affordance.
- **Recents (R12.1)** — `core/stickers/RecentStickers.ts` (pure,
  storage-injected: validate/dedupe/cap-12) + a zustand browser binding
  persisting in app data (localStorage, never in `.icb` files). Every
  picker insert, inspector restyle and Insert-Panel sticker-card click
  lands in the row.
- **Insertion engine (R12.1)** — `interaction/StickerInsert.ts`:
  places ANY library emoji (not just the 8 registry cards) centred on a
  world point, mirroring CatalogInsert semantics (default 96×96
  footprint, kind-aware re-centring, one undo step).
- **Inspector sticker search (R12.1)** — the «استیکر» section gains a
  search box that swaps the curated palette for live library results
  (scrollable radiogroup, custom scrollbar); recents chips sit above the
  palette; every apply restyles through ONE composite undo entry and
  lands in recents.
- **Command** — `core.insert.stickerLibrary` («کتابخانه استیکر…»,
  Ctrl+Shift+K, `insert` group) registered in the dispatcher; the
  palette lists it.

### Changed

- Insert-Panel search box redesigned: leading Search icon, trailing
  clear button, focus ring polish.
- The stickers group ends with a «کتابخانه کامل استیکرها…» affordance
  (dashed card + kbd hint «Ctrl+Shift+K»).
- `empty.hint` now mentions the Ctrl+Shift+K shortcut.
- Version strings → 1.19.0; `app.phase` → «فاز ۱۲ — کتابخانه استیکر».

## [1.18.0] — Phase 11: emoji stickers (2026-09-13)

The canvas gains a FigJam-style vocabulary of emoji stickers — reaction
and planning markers that render through the platform emoji font (fully
offline, zero assets). The eleventh object kind rides every existing
seam: registry cards, insert commands, the inspector restyle path and
the raster export layer, with 11 new tests (1576 total).

### Added

- **Sticker object kind (R11.1)** — `core/model/StickerObject.ts`: a
  sized, axis-aligned object carrying one `emoji` glyph; the generic
  bbox/translate machinery (selection, marquee, move/resize commands,
  marquee hit-tests) works with zero extra code. Registered as
  `core.sticker` (the 10th core type) with strict deserialization
  (empty/wrong-typed emoji refuses, negative sizes refuse).
- **Insert surface** — 8 curated catalog cards («استیکرها» group in the
  Insert Panel: ⭐ 😀 ❤️ 🔥 💡 🎯 🚀 ✅) each carrying its own
  `core.insert.sticker.*` command (the panel click, palette and drag-drop
  share the exact ids). Cards paint their actual emoji preview — the
  `preview` catalog field now renders in the panel (and the drag ghost).
- **Renderer** — `Canvas2DRenderer.drawSticker`: glyph centred in the
  footprint (min-edge ×0.82), rotation composed around the centre, a
  soft theme-tinted circular backing plate keeps pale glyphs visible on
  the light theme, viewport culling identical to shapes/images; falls
  through to the raster layer of SVG/PNG exports unchanged.
- **Inspector «استیکر» section (R11.1)** — a live preview chip + a
  32-glyph curated palette (radiogroup, keyboard accessible): picking
  restyles EVERY selected sticker through ONE composite undo entry
  (`StyleChanges.emoji` → `planStylePatch`); mixed selections show a
  mixed-state hint; locked stickers refuse edits.
- **Layers panel** — sticker rows carry the Smile icon + «استیکر» label.

### Changed

- Insert-panel cards gained motion-safe hover polish (lift + shadow,
  emoji scale) — the whole grid feels alive without distracting.
- Version strings → 1.18.0; `app.phase` → «فاز ۱۱ — استیکرها».
- Registry log line now reports 10 core types.

### Notes

- Emoji rendering uses the platform emoji font (Segoe UI Emoji / Apple
  Color Emoji / Noto Color Emoji) — glyphs vary slightly per OS, by
  design (offline, no bundled assets).

## [1.17.0] — Phase 10 complete: Data Hub, automations & first-party plugins (2026-09-12)

The plugin ecosystem became a data economy. The Data Hub gives plugins
typed, versioned contracts; an automation layer turns app events into
rule-driven actions; and the four first-party plugins (Calendar, Planner,
Reporter, AI Analyst) are REAL plugins dogfooding the Phase 9 SDK — that
is how the SDK gets proven. 44 new tests (1565 total).

### Added

- **Data Hub (R10.1)** — `datahub/DataHub.ts`: providers register typed,
  versioned contracts; consumers declare an acceptable range; a mismatch
  answers a typed `{ok: false, reason}` with a Persian message and the
  consumer DEGRADES GRACEFULLY (notice + feature off, never a crash —
  AC10.1). Contracts resolve only from ENABLED plugins (wholesale
  unregister on the disable path); change events fan out to
  range-matching subscribers, host listeners and the app bus
  (`datahub:changed`).
- **Core contracts (R10.2)** — `docs/CONTRACTS.md` + the host-provided
  `project.digest` v1 (`datahub/contracts/projectDigest.ts`: meta,
  counts, 16 text excerpts capped at 120 chars, activity) computing on
  demand with change events on scene churn/saves; `calendar.events` and
  `planner.tasks` v1 provided by the first-party plugins.
- **SDK surface (R10.3–R10.6)** — `app.datahub.provide/query/subscribe/
  publish` over the bridge (permission `datahub`), the plugin-side
  `app.datahub.__serve` provider service in BOTH shims (canonical TS +
  browser srcdoc twin), `serveDatahubQuery` with a 4 s guard, and
  `app.network.fetch` extended to POST/PUT/PATCH/DELETE with headers +
  body (≤512 KB) for the AI backends.
- **Calendar plugin (R10.3)** — first-party: `calendar.events` provider
  (events CRUD + monthInfo + exact Jalali↔Gregorian + bundled Iranian
  holidays), a month-grid canvas widget (catalog card + today/event/
  holiday marks), a full month-navigation panel with event CRUD, and a
  settings section (Jalali default, Gregorian toggle). Global data scope
  (DECISIONS #26).
- **Planner plugin (R10.4)** — first-party: `planner.tasks` provider
  (goals long/short, tasks with status + Jalali due dates, queryable),
  task-card + goal-board canvas widgets, a goals/tasks panel, and a
  calendar-powered due-date picker that degrades to manual entry with a
  Persian notice when the calendar is disabled (AC10.2). Per-project
  data with a browser-local global overview (DECISIONS #27).
- **Reporter plugin (R10.5)** — first-party: subscribes to
  planner.tasks + calendar.events; day/week/month stats (completions,
  productive-day streaks, overdue, events); RTL SVG bar charts; a
  Persian text summary with copy + save-into-project; graceful notices
  when either provider is missing. The `generate` command writes the
  all-periods report into the project section.
- **AI Analyst plugin (R10.6)** — first-party: opt-in network
  permission; two backends (external OpenAI-compatible with the USER'S
  OWN key, local Ollama); consumes project.digest (+ opt-in
  planner.tasks); the transparent «این داده‌ها دقیقاً ارسال خواهد شد»
  preview precedes EVERY network call — the request persists as pending
  and only the explicit confirm (button or region message) releases it
  (AC10.5). Reports land in the plugin's storage + panel.
- **Automations (R10.7)** — `datahub/automations/`: the rule store
  (localStorage, fail-closed) + the trigger engine over allowlisted
  events + datahub changes; actions either dispatch REGISTERED commands
  (undoable through the dispatcher) or write to hub contracts; every
  firing is logged + announced (`automation:fired`); the «اتوماسیون»
  panel is the full RTL rule-builder «وقتی … آنگاه …» with the one-click
  sample rule (task completed → calendar event, AC10.4).
- **Install surface** — the install dialog's «افزونه‌های داخلی» section
  installs the four first-party packages through the SAME consent flow.
- **Docs (R10.8)** — `docs/PLUGINS.md` (authoring guide) +
  `docs/CONTRACTS.md` (the three contracts + versioning rules).

### Changed

- `PermissionEngine` maps the five `app.datahub.*` methods to the
  `datahub` permission (previously declared-but-unused — now real).
- `HistoryManager.depth()` (digest); status bar / tauri.conf → 1.17.0;
  `app.phase` → «فاز ۱۰ — مرکز داده و اتوماسیون».

### Fixed

- **The one-click sample rule now fires against the REAL calendar
  contract** (found live): it named `createEvent` — a method that only
  existed in the test mock — and carried no `date`. The shared
  `SAMPLE_RULE_ACTION` (rules.ts) now targets the plugin's real
  `addEvent` and passes `date: "__today__"`, a marker the RuleEngine
  resolves to today's Jalali date at fire time (recursively; saved rules
  keep the marker). Panel button, builder defaults and tests read the
  same constant (DECISIONS #34); a new firstparty test fires the rule
  against the REAL plugins end-to-end.
- **Plugin panel regions collapsed to a ~59px sliver** (latent since
  Phase 9, visible with the first-party panels): the region host's
  `h-full` inside the dock's auto-sized `flex-1` scroll container is
  circular, so the section collapsed and clipped the region to ~20px.
  The host now carries a definite `h-56` (DECISIONS #35) — dock sections
  size properly and regions scroll internally.

## [1.16.0] — Phase 9 complete: the plugin runtime (2026-09-12)

The extension seams became a real plugin system. Third-party (and future
first-party) code runs inside the app as plugins: discovered from a local
package, validated, sandboxed, permission-checked, and able to contribute
commands, object types (WITH Insert-Panel cards), panels, settings
sections, storage and project data — all through a versioned SDK. 50 new
tests (1521 total).

### Added

- **Bridge protocol (R9.2)** — `plugins/protocol.ts`: the versioned
  host↔plugin message schema (hello/ready/req/res/evt, typed error
  codes) + the transport-agnostic `RpcPeer` state machine. The
  in-process transport pair (microtask-queued, re-entrancy safe) runs
  the SAME protocol in tests; the browser runs it over `postMessage`.
- **Sandbox (R9.2)** — `plugins/host/SandboxHost.ts`: plugin code runs
  in `<iframe sandbox="allow-scripts">` — WITHOUT allow-same-origin
  (opaque origin, zero app/DOM/Tauri access), content via srcdoc, every
  inbound frame pinned to its own `contentWindow`. A crash posts
  `plugin.crashed` and NEVER takes the app down (AC9.3). The srcdoc
  bootstrap embeds the plain-JS twin of the SDK shim + the plugin's
  entry (`pluginMain(app)`).
- **Manifest validation (R9.1)** — `plugins/manifest.ts`: id scheme
  (reserved `core.` refused), uniqueness, strict semver, sdkRange
  negotiation (`^x.y.z` / `>= <`), permission allowlist, dependency
  resolution, entry/icon path escapes — every failure a Persian
  sentence (AC9.5/AC9.6).
- **Permission engine (R9.4)** — `plugins/host/PermissionEngine.ts`:
  the five permissions (storage/network/projectRead/projectWrite/
  datahub) with plain-Persian consent copy; runtime enforcement wraps
  EVERY SDK dispatch (fail-closed typed errors, AC9.4).
- **SDK (R9.3)** — `plugins/sdk/createPluginSdk.ts`: the canonical `app`
  surface (commands/objects/panels/settings/storage/events/project/
  i18n/network + regions). `app.objects.create` drives the async insert
  path; `renderWidget` snapshots feed the canvas layer.
- **Host runtime (R9.3)** — `plugins/host/PluginRuntime.ts`: serves the
  SDK over the bridge, tracks every contribution for wholesale
  unregister (§1.7.5), the 2 s factory timeout with the Persian toast
  (no partial object — AC9.10), the widget renderer, region attachment,
  and the bridge LOG (outgoing traffic, capped — the AC9.10 catalog
  safety probe).
- **Plugin storage (R9.3/R9.5)** — `plugins/host/PluginStorage.ts`:
  namespaced KV + the mini row-table SQL engine (the same fail-closed
  philosophy as DbAccess; desktop SQLite swap-in documented); full
  archive export/import.
- **Lifecycle manager (R9.5)** — `plugins/host/LifecycleManager.ts`:
  install (zip/sample/desktop-folder readers in
  `plugins/host/readPackage.ts` — fflate for zips), enable/disable,
  uninstall-with-archive, restore; `plugins:changed` refreshes the UI;
  boot runs ENABLED plugins non-blocking (a dead sandbox's handshake
  timeout never delays startup).
- **Plugin object model (R9.9)** — `PluginObjectData` (`kind: "plugin"`):
  the host owns the envelope (geometry + verbatim `data`), the plugin
  owns the payload; serializeSceneObjects dispatches by wire typeId with
  a VERBATIM fallback for unregistered types (§1.7.4 — a disabled
  plugin's objects reload as opaque placeholders, nothing is ever
  lost).
- **Plugin object layer (R9.9)** — `plugins/host/PluginObjectLayer.ts`:
  the DOM overlay painting widget views — INERT iframes (sandbox=""
  — display snapshots only) riding the SAME rAF as the canvas
  (RenderLoop grew `addCompanion`).
- **Registry upgrades** — `unregister` (+ owner-aware index cleanup) on
  the base Registry, ObjectRegistry and CommandRegistry; third-party
  owner flags on ObjectRegistry/CommandRegistry/PanelRegistry/
  SettingsSectionRegistry (the plugin runtime composes `<owner>.<id>`
  itself — forgery impossible).
- **Plugin Manager UI (R9.6)** — «افزونه‌ها» registered dock panel:
  installed list (icon, name, version, permission chips, enabled
  toggle, Persian error states), install dialog (zip upload / desktop
  folder / the built-in sample) with the full plain-Persian consent
  list, uninstall with archive choice, archive restore. Fully RTL.
- **Insert Panel × plugins (R9.9/AC9.9)** — plugin cards appear
  automatically under the plugin's group (titles from the merged i18n
  namespace, `pluginOwner` on the card view); click inserts at the
  viewport centre, drag-drop at the EXACT release point — both through
  the async 2 s-guarded factory path; cards vanish/return on disable/
  enable with ZERO catalog-specific code. A host-generic toolbar strip
  renders plugin commands with icons (AC9.1) alongside the palette.
- **Sample plugin (R9.7)** — `public/plugins-sample/sticky-shape-pack/`
  («Sticky Shape Pack»): 3 decorative shape types (star/heart/burst)
  with catalog cards + SVG widget snapshots, one command, one panel,
  one settings section, colour persistence — exercising every SDK
  surface end-to-end.
- **Docs** — `docs/SEAMS.md` §9: the full plugin authoring guide
  (package layout, manifest, the entry contract, the SDK surface,
  sandbox/security, the bridge protocol, lifecycle semantics,
  permissions, the sample) (R9.8).

### Changed

- `app.phase` → «فاز ۹ — سیستم افزونه»; ~23 new fa/en i18n keys
  (manager/install/consent); the Layers panel maps the new `plugin`
  kind (Puzzle icon).
- `ObjectPatch` gained `data` (plugin payload replacement, one undo).

## [1.15.0] — Phase 8 complete: polish, modes, templates & distribution (2026-09-12)

The product ships. Every R8 requirement landed: the composed Settings
dialog with live-apply app-data persistence, presentation mode over the
new FRAME object, the Persian Jalali date commands, the template
gallery, SQLite-backed version history behind the namespaced DbAccess
gate, the i18n mergeNamespace seam, real SVG + PDF exporters, and the
Windows distribution plumbing (file association + single-instance +
open-on-launch). 73 new tests (1469 total).

### Added

- **Settings dialog + registry (R8.2)** — `ui/registry/
  SettingsSectionRegistry.ts` and `ui/components/SettingsDialog.tsx`:
  the dialog composes FROM registered sections (AC8.3: a dummy section
  appears with ZERO dialog edits). Five core sections (general /
  appearance / text / canvas / storage) migrate ALL settings: UI language
  (fa/en with the live RTL↔LTR flip), Persian digits, typed-digit
  conversion (NEW text only — a TipTap input-rule extension), default
  font family/size for new text objects, background-grid spacing, snap
  defaults and the autosave interval (10 s–5 min, live restart). Every
  change applies immediately; `ui/settings/settingsPersistence.ts`
  hydrates on boot and persists to localStorage (app data, never the
  .icb file) — Ctrl+, opens it.
- **Theme persistence (R8.1)** — the theme (and language + every
  settings slice above) now survives restarts; canvas, grid and all
  panels were already theme-aware (verified live both ways).
- **FrameObject + presentation mode (R8.3)** — `core/model/FrameObject`:
  a titled rectangular container (title bar + body wash + border) with
  CHROME-only hit-testing (the body passes clicks through to contained
  objects). Registered as `core.frame` (registry entry + catalog card →
  the Insert Panel shows it automatically + the toolbar gained a frame
  button + `core.insert.frame`). F5 enters presentation mode: one frame
  per slide (geometric membership — D-8.2), full-screen, ←/→/Space
  navigation (RTL-aware), Esc exits, and the text layer mounts LIVE DOM
  so links stay clickable. Boards without frames get the Persian hint.
- **Jalali calendar (R8.3)** — `core/utils/jalali.ts`: self-contained
  Solar Hijri↔Gregorian conversion (jalaali-js break-point algorithm),
  month names, both spec formats (`1403/05/21` and «۲۱ مرداد ۱۴۰۳»);
  the `core.text.insertDate` / `insertDateNumeric` commands + two text
  toolbar buttons insert today's date (AC8.5 tested against known
  references incl. the 1403 leap year).
- **Template gallery (R8.4)** — «پروژهٔ جدید» now opens a gallery:
  Blank, Meeting Notes (agenda + action items with task lists), Kanban
  (RTL columns «در انتظار / در حال انجام / انجام‌شده» — first column
  rightmost, AC8.6), Mind Map, Weekly Planner (شنبه…جمعه) and a Frame
  Storyboard (two presentation-ready frames). Templates are `.icb` files
  shipped in `public/templates/` (generated from the pure builders by
  `scripts/generateTemplates.ts`); the gallery fetches them and imports
  through the regular pipeline, falling back to the builders when a
  fetch fails.
- **Version history (R8.5)** — every successful MANUAL save records a
  timestamped snapshot (`core_versions`: project_path, ts, json) through
  the new History panel (right dock): list per path, Jalali timestamps,
  read-only preview (the import event's readOnly flag), restore →
  save-as flow, delete. SQLite via `tauri-plugin-sql` on the desktop
  shell; a localStorage engine speaking the same statement family on the
  web; per-path pruning (20) + quota shedding.
- **DbAccess namespacing gate (R8.5/SEAMS §7c)** — every host SQL
  statement passes a fail-closed gate that refuses non-`core_` tables;
  migrations run once. Phase 9 plugins get their OWN prefix-scoped
  instance.
- **i18n mergeNamespace (R8.6)** — `mergeNamespace(owner, dict)` merges
  external dictionaries at runtime under `owner:key`: cross-owner
  conflicts detected + logged (first definition wins, core never
  shadowed), re-merging replaces the owner's namespace, removal +
  ownership probes + change notifications included (AC8.4).
- **SVG exporter (R8.7)** — `persistence/exporters/SvgExporter.ts`:
  shapes/sticky cards/frames vectorise (rect/ellipse/polygon + frame
  chrome + title text), the text layer (and non-vectorised kinds)
  embeds as ONE raster `<image>` — the limitation is stated in the
  dialog (Persian shaping fidelity, D-8.5).
- **PDF exporter (R8.7)** — `persistence/exporters/PdfExporter.ts`:
  print pipeline — one frame per page or fit-all, each page the proven
  PNG rasterisation inside an A4-landscape print document opened in a
  hidden iframe; «Save as PDF» produces the file (AC8.8: Persian text
  correct because it is rasterised).
- **Export dialog formats (R8.7)** — the PNG dialog became a
  three-format surface (PNG / SVG / PDF) with format-specific options
  (PDF: page layout + the print note; SVG: the raster-text note);
  `core.export.svg` / `core.export.pdf` commands + menu entries.
- **Windows integration (R8.8)** — `.icb` file association
  (Editor role), `tauri-plugin-single-instance` (second launches focus
  the running window and forward the file), argv open-on-launch with a
  re-emit (the WebView listener race), the `open-file` event → the
  import pipeline, NSIS `installMode: currentUser`, the SQL plugin +
  `sql:default` capability, and version alignment (1.15.0 across
  package.json / tauri.conf.json / the status bar).
- **Commands** — `core.app.settings` (Ctrl+,), `core.view.presentation`
  (F5), `core.text.insertDate(+Numeric)`, `core.export.svg`,
  `core.export.pdf`, `core.insert.frame`, `core.view.panel.history`.
- **Tests** — 9 new files (73 tests): jalali (12), mergeNamespace (9),
  SettingsSectionRegistry (5), Presentation (12), templates (9, incl.
  the shipped .icb round-trip), DbAccess + VersionHistoryService (13),
  commands8 (5), objectTypes-frame (4), settingsPersistence (6).

### Changed

- The StatusBar settings button opens the composed dialog (the old
  popover migrated into sections); the frame kinds joined the Layers
  panel maps, the Insert panel icons and the catalog.
- `core.file.new` opens the template gallery (dirty-guarded) instead of
  resetting directly; the import event gained a `readOnly` payload flag.
- Autosave uses the configured interval (default stays 30 s) and
  restarts live on change; the grid renderer honours the configured
  base spacing (adaptive levels still power-of-two multiples).

### Notes

- The Rust-side additions (single-instance, sql plugin) follow the
  official Tauri 2 plugin APIs and need a Windows host to compile
  (`npm run tauri:build`); installer size/RAM numbers belong to the
  Windows build run — see docs/KNOWN_LIMITATIONS.md.

## [1.14.0] — Phase 7 complete: panel docks, command palette, alignment, smart guides & the Insert Panel (2026-09-12)

Professional-grade navigation and object management. Every panel is now a
REGISTERED contribution (PanelRegistry), the Inspector composes from
registered sections, Ctrl+K opens a fuzzy command palette over the whole
command catalog, the Insert Panel (\u200e«پنل درج») inserts widgets by
click or pointer-drag from the ObjectRegistry catalog, and dragging snaps
with Figma-style magenta smart guides. A Guttman R-tree now backs
hit-testing and marquee resolution.

### Added

- **PanelRegistry + PanelContainer (R7.1)** — `ui/registry/PanelRegistry.ts`
  and the dock renderer: every panel is `{id, titleKey, icon, component,
  placement: left|right|bottom, order, defaultOpen}`; three docks (left:
  Outline + Insert, right: Layers + Inspector + Search, bottom: Minimap)
  render FROM the registry with icon rails; open/closed state persists in
  localStorage. The LayersPanel became a registered body and gained
  POINTER-drag row reordering (one ReorderCommand) and expandable group
  rows; two-way multi-select sync kept.
- **InspectorSectionRegistry (R7.2)** — the Inspector is now a thin shell
  resolving sections per selection kind (exact kind → `text` → `*`): the
  Phase 3A–6 sections (name, stroke, fill, connector, text, card,
  geometry + rotation) ported to registered components plus the NEW
  multi-text section (AC7.2): font family + size + colour applying to ALL
  selected text objects in ONE undo step (`fontFamily` added to the text
  models, style patches, view and serializer).
- **Alignment & distribution (R7.3)** — 8 registered commands
  (`core.selection.align*` / `distribute*`): Figma-style selection-relative
  alignment and equal-gap distribution, ONE undo step each; locked objects
  refuse to move but still define the selection frame. The SelectionActions
  cluster renders them from the selection group automatically.
- **Smart guides (R7.4)** — the pure `interaction/SmartGuides` engine:
  magenta edge/centre alignment + equal-gap hints while dragging, 6px
  SCREEN-space threshold (zoom-converted), Alt bypasses snapping
  temporarily, locked/invisible objects never offer references. Rendered
  by the new `GuidesOverlay` + `Canvas2DRenderer.renderGuides` (gap values
  follow the Persian-digits setting through the palette).
- **Format Painter (R7.5)** — `core.text.formatPainterCopy/Apply`
  (Ctrl+Shift+C/V): captures the selection's inline marks + block node as
  a serialisable fingerprint and REAPPLIES it (replace semantics) on the
  next text selection — same or another object.
- **Search panel (R7.6)** — scene-wide search over rich-text content
  (table cells included) and object names with scope filters; grouped
  results carry type icons + RTL snippets; a click flies the camera
  (300 ms eased) and pulses a highlight ring (`ui:fly-to-object` +
  PulseHighlight).
- **Outline panel (R7.7)** — every H1/H2/H3 of every text object in
  z-order, nested by level; click → camera flight + pulse.
- **Minimap (R7.8)** — the bottom dock's bird's-eye overview: object
  footprints + the live viewport rectangle; drag inside the map pans the
  camera.
- **Bookmarks (R7.9)** — Ctrl+Shift+B opens the Persian name prompt; the
  bookmark bar lists captures, click flies the camera
  (`CameraController.flyToCamera` — eased interpolation of x/y/zoom/
  rotation), × removes. Bookmarks persist inside the `.icb` v2 envelope
  (optional `bookmarks` field — older files read as "no bookmarks",
  corrupt fields never crash the load).
- **R-tree spatial index (R7.10)** — `RTreeSpatialIndex` (quadratic-split
  Guttman R-tree) behind the Phase 2 interface + `SceneSpatialIndex`
  (revision-guarded, object-identity-keyed incremental sync) ENABLED in
  the app: hit-testing, hover and marquee resolution broad-phase through
  the R-tree; unit-tested against the linear implementation (identical
  results, faster at 600+ objects).
- **Command palette (R7.11)** — Ctrl+K (outside the editor; the in-editor
  Ctrl+K link dialog keeps the key while editing): fuzzy-searchable list
  of EVERY registered command rendered from the CommandRegistry ONLY,
  i18n titles + shortcut hints, full keyboard navigation, fully RTL.
- **Insert Panel (R7.12)** — \u200e«پنل درج»: the widget catalog rendered
  EXCLUSIVELY from ObjectRegistry catalog metadata (rect + ellipse card
  variants via the new `cards` field; groups shapes/text&notes/media/
  drawing with headers; searchable). CLICK inserts at the viewport centre
  through the registered `core.insert.*` commands (identical to the
  palette path); POINTER-DRAG shows a screen-space ghost and creates the
  object EXACTLY at the release world point (one undo step, default
  factory size — verified at any zoom); Esc/release-outside cancels with
  guaranteed ghost cleanup; image cards launch the asset flow.

### Changed

- `ProjectData`/serializer: optional `bookmarks` section (R7.9);
  `buildProjectData` takes the bookmark list; restore paths rehydrate it.
- `ObjectCatalogMeta` gains optional `cards` variants (R7.12); core
  catalog regrouped into shapes/text&notes/media/drawing.
- `StyleChanges`/`ObjectPatch` gain `fontFamily` (R7.2/AC7.2).
- SelectTool: smart-guide integration in the move gesture + R-tree
  broad-phase dep; MarqueeLogic/objectHitTest accept an optional index.
- RenderLoop/Canvas2DRenderer: smart-guide overlay pass (R7.4).
- app.phase \u200e→ «فاز ۷ — ناوبری و مدیریت حرفه‌ای».

### Tests

- 72 new unit tests (1396 total): RTreeSpatialIndex (randomised
  equivalence vs linear + refresh/remove/clear + 600-object perf smoke),
  SceneSpatialIndex (sync + hit-test/marquee equivalence), AlignDistribute
  (Figma planning + one-undo + locked frame semantics), SmartGuides (snap
  exactness, thresholds, locked/invisible exclusion, equal gaps),
  SceneSearch (Persian search across 12+ objects, scopes, table cells,
  outline nesting), BookmarkService (+ serializer round-trip + corrupt
  payloads), FormatPainter (fingerprint capture/apply with a live TipTap
  editor), PanelRegistry/InspectorSectionRegistry (AC7.11 seam proofs +
  late registrations), panelState persistence, fuzzy matcher,
  CatalogInsert (card resolution + AC7.13 dummy-type seam + exact-at-point
  + factory-identical defaults), commands7 (all 24 new commands, shortcut
  parity, dispatcher execution, AC7.12 palette i18n completeness in fa+en).

## [1.9.0] — Native Windows save/open dialogs on the desktop (2026-09-10)

The desktop shell now opens the REAL Windows file pickers: pressing
«ذخیره در مسیر…» lands the user straight in the native Save-As dialog
(folder tree, file name, `.icb` filter), and «فراخوانی از مسیر…» opens the
native Open dialog automatically. The typed path stays as a power-user
alternative. No more typing addresses just to browse.

### Added

- **`tauri-plugin-dialog`** (the only new Rust crate, still fully offline):
  registered in `src-tauri/src/lib.rs` and allowed via the `dialog:default`
  capability in `src-tauri/capabilities/default.json` — this is what makes
  the OS-native pickers available to the WebView.
- **`src/platform/tauri/dialog.ts`** — the Phase-0 stub replaced by the real
  implementation: `saveFileDialog` / `openFileDialog` wrappers over
  `@tauri-apps/plugin-dialog` (new npm dependency, dynamically imported ONLY
  inside the Tauri WebView so the web bundle stays clean). Option mapping,
  single-file mode, non-string result normalisation, and failures that
  collapse to `null` instead of crashing.
- **`saveProjectViaNativeDialog`** (`src/persistence/SaveToDisk.ts`): native
  Save-As → `.icb` filter + suggested name → `save_text_file` IPC write at
  the picked path (same extension normalisation as the typed flow).
- **`loadProjectViaNativeDialog`** (`src/persistence/LoadFromDisk.ts`):
  native Open → `.icb` filter → `read_text_file` IPC read of the picked path
  VERBATIM (the OS guarantees the file exists; no path surgery). Adds the
  `cancelled` outcome to `LoadFromDiskResult`.
- **Auto-launch UX (desktop)**: both dialogs fire the native picker
  automatically as they mount (StrictMode-safe ref guard + in-flight guard);
  dismissing the OS dialog simply leaves the typed-path alternative on
  screen. New primary buttons «انتخاب مسیر از سیستم…» /
  «انتخاب فایل از سیستم…» re-open the pickers; hint + divider
  («یا مسیر را دستی تایپ کنید») separate them from the typed field.
- 12 new fa/en i18n keys (native pick buttons, hints, dividers, refreshed
  dialog descriptions that now mention the Windows dialogs).

### Tests

- 19 new unit tests (1008 total): `tests/platform/TauriDialog.test.ts`
  (plugin contacted only in Tauri, option mapping, dismiss/error collapse),
  plus the native-desktop branches of the save/load dispatchers (cancelled /
  saved with payload shape / verbatim read / filter contract / IPC failure).
- Gates: tsc ✓ eslint ✓ prettier ✓ vitest 1008/1008 ✓.

### Verified

- Web shell E2E (agent-browser): fresh round-trip still green after the
  change — sticky note «تست دیالوگ نیتیو» → saved to
  `/home/z/my-project/qa-native-web.icb` (magic `.icb`, 1 object) →
  new project → recalled → ۱ object restored, zero console/page errors.
- Desktop UI branch verified in-browser by stubbing
  `window.__TAURI_INTERNALS__`: both dialogs render the native-pick button +
  typed field, the auto-launch fires the plugin call, and a missing Tauri
  runtime degrades to a quiet cancelled state (console warning, no crash).
- Rust wiring (crate + plugin registration + capability) cannot be compiled
  in this sandbox (no cargo); verified by review. First `npm install` +
  `tauri:build` on Windows downloads `@tauri-apps/plugin-dialog` and the
  `tauri-plugin-dialog` crate (both pure adds, no config changes needed).

## [1.8.0] — Recall from path: the verified .icb round-trip (2026-09-10)

The save-at-address system gains its recall twin — plus a REAL typed-path
mode for the web shell. A project can now be saved to an address the user
gives, and brought back from that exact address, in the app's own `.icb`
format, in BOTH shells — verified end-to-end.

### Added

- **«فراخوانی از مسیر…» (Open from path…)** menu item + the new
  `OpenFromPathDialog` (same visual language as the save dialog: RTL,
  mono LTR path input, format badge, bridge badge, busy state, inline
  validation). The loaded payload is pre-validated with the app serializer
  and handed to the composition root via `project:import-requested` (the
  exact restore path of "Open project…": scene rebuild, history reset, id
  reseeding, camera restore). Success toasts carry the restored object
  count («پروژه فراخوانی شد — ۲ شیء»).
- **Local filesystem bridge (web shell)**: when the app is served from the
  machine the user addresses (local preview, self-hosted setup), the typed
  path is written/read FOR REAL through the Next.js server —
  `GET /api/fs` (probe: capabilities + allowed roots), `POST /api/fs/save`,
  `POST /api/fs/load`, all backed by `src/lib/serverFs.ts`: absolute-path
  guard, tilde expansion, quote stripping, `.icb` extension enforcement,
  allow-listed roots (temp dir, home, working dir) with separator-boundary
  containment (no `/home/zombie`-for-`/home/z` spoofing, traversal
  collapse), `.icb` magic check, 10 MiB cap, parent-directory creation.
  Remote deployments fail the probe → the dialogs keep the system-picker /
  download / file-open fallbacks.
- **`src/persistence/LocalFsBridge.ts`** — client half of the bridge:
  memoised probe, typed save/load outcomes with machine-readable codes.
- **`src/persistence/LoadFromDisk.ts`** — the recall dispatcher:
  `loadProjectFromPath` routes to the Tauri IPC command (desktop) or the
  local bridge (web), sharing `normalizeSavePath`'s typed-path policy.
- **Desktop recall**: new `read_text_file` IPC command in src-tauri
  `lib.rs` — the std-only twin of `save_text_file` (no new crates; the
  user's `tauri:build` stays predictable).
- `SaveAtPathDialog` gains the bridge mode: in the local web shell the
  typed-address field (the literal user request) is PRIMARY, with the
  allowed roots hinted inline and the download kept as a secondary escape
  hatch.
- 33 new unit tests (bridge guard policy incl. tilde/traversal/boundary
  spoofing, save/load round-trip on real temp dirs, route status mapping,
  probe/save/load dispatch branches, desktop IPC branch) — suite
  **989/989**. 40 new fa/en i18n keys (saveAt.* bridge + openAt.*).

### E2E (agent-browser, Persian web shell — the requested proof)

Created two sticky notes («تست ذخیره»، «یادداشت دوم»); saved via
«ذخیره در مسیر…» to the typed address `/home/z/my-project/qa-roundtrip.icb`;
verified the file ON DISK (`.icb` magic, v1, 2 stickyNote objects with the
exact texts and positions); wiped the canvas («پروژهٔ جدید») and created a
junk note so the AUTOSAVE SLOT held a different state; recalled via
«فراخوانی از مسیر…» → the two original objects (same ids `obj-4`/`obj-5`,
same texts) reappeared — the file, not the autosave, is the source. The
negative path (missing file) shows the inline «فایلی در این مسیر پیدا
نشد.»; zero console/page errors; dev.log clean
(download/qa19-recall-roundtrip.png).

## [1.7.0] — Save at path: the .icb "save to address" system (2026-09-10)

The user can now save the project **at an address they give**, in the app's
own `.icb` format. One dialog, two address modes by shell:

### Added

- **«ذخیره در مسیر…» (Save to path…)** menu item in the Project menu,
  opening the new `SaveAtPathDialog` (RTL, mono LTR path input, format
  badge «فرمت ICB · نسخهٔ ۱», busy state, inline validation error, notice
  toasts with the concrete saved path).
- **Desktop (Tauri) — typed address**: the user types the full path; the
  payload is written by a new `save_text_file` IPC command (src-tauri
  lib.rs — std-only, no new crates): validates a file name exists, creates
  parent directories, writes UTF-8, returns the canonical path. This is
  the literal «در آدرسی که بهش میدم» flow.
- **Web — system picker**: browsers can't write to typed paths, so the
  web twin of "giving an address" is the File System Access save picker
  (`showSaveFilePicker`, Chromium/Edge): a REAL folder + file-name choice
  that streams the payload to that exact location. When the API is absent
  (Firefox/Safari, sandboxed frames) the dialog offers the download
  fallback with an explanatory note. AbortError (user closed the picker)
  stays silent; failures surface as error toasts.
- **`src/persistence/SaveToDisk.ts`** — the policy + dispatch layer:
  `normalizeSavePath` (pure: strips Windows "Copy as path" quotes, appends
  `.icb` when missing, REPLACES foreign extensions — the save format is
  app-defined, rejects directory-only paths and forbidden characters
  `< > | ? * "`), `saveProjectToPath` (Tauri invoke), `saveProjectViaPicker`
  (FS Access API), `hasSystemSavePicker` + `serializeProjectFile` (the
  exact `.icb` envelope shared with autosave/download).
- 13 new unit tests (quote stripping, extension policy incl. dot-file
  edges, rejection cases, web dispatch branches, envelope round-trip) —
  suite 956/956.
- 15 new fa/en i18n keys (saveAt.*).

### E2E (agent-browser, Persian web shell)

Menu item visible and opens the dialog; all texts render; the picker path
degrades gracefully in headless (no console errors, dialog intact, busy
state clears); cancel closes; keyed remount resets the draft state; dev.log
clean.

## [1.6.0] — Object name badges, image objects & the one-zip source delivery (2026-09-10)

Three things land together: the "named objects" product request, real image
objects, and the delivery milestone — the complete project now ships as ONE
zip (۱٫۵ MB, 410 files) the user can run locally and turn into a Windows EXE.

### Added

- **Object name badges** (`NameBadge` policy + `ObjectNameBadges` overlay):
  sticky notes, table-bearing text boxes and pasted/dropped images — the
  three "content carriers" — show their user-assigned name as a floating
  chip anchored to the **top-right corner OUTSIDE their frame** the moment
  they are named. Pure DOM overlay at z-[15] (never occluded by
  neighbouring cards), camera-driven with ONE rAF-coalesced projection per
  frame, constant screen-space text size (upright regardless of object or
  camera rotation), 0.4–0.6 zoom fade-out, viewport culling with 64px
  margin, anchors computed from the ROTATED covering box. E2E-verified in
  the Persian shell: badge right edge lands exactly on the frame's right
  edge (750px = world 530 + width 220) with its bottom 6px above the
  frame's top, and the name round-trips through autosave reload.
- **Image objects** (`ImageObject` model + factory + renderer pass + import
  flow): images pasted from the clipboard (Ctrl+V) or dropped as files
  become first-class scene objects — data-URL source, natural size vs
  placed size, decoded-image cache in `Canvas2DRenderer` keyed by source
  (shared sources decode once), rotation + viewport culling, repaint
  notification when async decoding completes. `useImageImport` wires the
  clipboard/drop events in `CanvasSurface` (images created outside the
  canvas are exactly what the badge policy covers).
- **Inspector name field** (`InspectorPanel` name section +
  `useInspectorModel.rename`): single-selection rename input with commit-on-
  blur, Persian placeholder and an RTL hint explaining the badge placement;
  the name is a normal undoable model patch.
- **One-zip source delivery**: the Project menu gains **«دانلود سورس کامل
  (ZIP)»** — the complete project (source, Tauri 2 shell with Rust code +
  full icon set, tests, prisma schema, all configs) served from
  `public/downloads/infinite-canvas-studio.zip`. The menu item probes the
  bundle with a HEAD request and **hides itself when the file is absent**
  (local clones, desktop shell — no dead links anywhere). The bundle's
  configs are patched for the user's machine: `npm`-based Tauri commands
  (no bun), Windows-safe `package.json` scripts (`next dev`/`next build`/
  `next start` — no `tee`/`cp` pipes), standard Next output (no
  `standalone`), plus a Persian-first `README.md` with prerequisites, run
  steps, the full EXE build guide (rustup → VS Build Tools → `npm run
  tauri:build` → NSIS installer path) and a troubleshooting table. The
  staged bundle was verified standalone before zipping: fresh `bun
  install` → `tsc` → `vite build` (the exact Tauri frontend build) all
  green; the served zip is byte-identical to that verified build
  (round-trip diffed).

### Fixed

- Stale test fixtures from the interrupted session (`NameBadge.test.ts`):
  sticky fixture gained the now-required `color` field; the shape fixture
  types as `ShapeObjectData` (union narrowing) — suite 943/943 green.
- Unused `useEffect`/`useRef` imports in `InspectorPanel` (lint gate).

## [1.5.0] — Phase 6: tables — RTL table tool, structure toolbar, presets & Excel paste (2026-09-10)

Full table support for the canvas rich-text engine (spec R6.1–R6.8),
E2E-verified end-to-end in the RTL Persian shell. The canvas toolbar gains
a dedicated **table tool (G)** with a hover-sweep 10×8 dimension grid; the
rich-text engine gains the TipTap table family with three project
augments: document-level table direction (RTL by default, column 1 renders
on the RIGHT), per-cell background colour, and six named style presets.

### Added

- **Table tool in the canvas toolbar** (`TableTool` + `TableGridPicker`):
  a ninth tool button (shortcut G) with a Google-Docs-style hover grid
  (10×8); a click/drag-out on the canvas creates a table text box at the
  picked dimensions (tap → default footprint) and opens the edit session
  with the caret in the FIRST header cell (`TextLayerView
  .beginTableCreation` + `placeCaretInFirstCell` — the caret never jumps
  to the document end). The picker's committed dimensions persist in the
  UI store and the button mirrors them (mini-grid badge + tooltip).
- **Floating TABLE toolbar** (`TableToolbar`): appears whenever the caret
  OR selection sits inside a table (structural ops must not require a text
  range — unlike the character-level bar). Row/column insert before/after
  + delete (logical before/after wording is direction-neutral), merge
  cells, split cell, header row/column toggles, direction toggle
  (RTL ↔ LTR live, the node view re-syncs the `dir` attribute), six style
  presets (classic/minimal/zebra/soft/grid/dark) and a per-cell background
  palette (applies to every cell covered by the selection — caret = own
  cell, drag-selection = whole range). Stacks BELOW the selection when the
  character format bar is visible (the two never overlap), else above the
  caret; never steals editor focus; `data-text-format-ui` tagged.
- **Insert-table grid inside the floating text format bar**
  (`FormatControls` → `InsertTableMenu`): offered while editing OUTSIDE
  tables; the inserted table inherits the surrounding paragraph's
  direction (Persian → RTL, Latin → LTR) per R6.5. Custom non-portal
  dropdown keeps the interaction inside the session's focus-owner subtree.
- **Excel/Word/TSV paste → real tables (R6.6)**: a schema-driven pipeline
  in `TipTapFactory.handlePaste` — rich HTML tables (Excel/Word clipboard
  HTML) parse through ProseMirror's DOMParser (structure + text + basic
  marks survive); plain TSV text converts into an RTL header-row table
  (`parseTabularText` + `tabularToTableDocument`); a table pasted INTO a
  table cell is rejected with a Persian toast ("چسباندن جدول داخل سلول
  جدول مجاز نیست…") via the new `ui:notice` bus event + `NoticeToasts`
  stack (auto-dismissing, aria-live, severity-tinted).
- **Column drag-resize (R6.3)**: `resizable: true` with a custom
  `AttributedTableView` node view that mirrors the node's `dir`/`preset`
  attributes onto the live `<table>` element (the stock `TableView` only
  manages the colgroup — this keeps live == static rendering, AC3A.1).
  Drag handles appear on column borders while hovering (within 5px); the
  resulting `colwidth` persists through save/load and the static
  serializer.
- **Table-aware commit planner (R6.1 guard)**: a table with empty cells is
  structural content — `planTextCommit` (new `newDocHasTable` flag) and
  `richTextDocumentIsEmpty` (via `documentContainsTable`) never treat it
  as an empty box, so a fresh table survives the session commit as ONE
  undoable add (R6.8), and clearing cell texts never auto-removes the box.
- 13 unit tests (`tests/text/editor/table.test.ts`): builder structure,
  header row, RTL/LTR options, JSON round-trip, emptiness contract,
  commit-planner table guards, TSV parsing (CRLF, trailing blank rows,
  rejection cases) and the tabular→table conversion.

### Changed

- `@tiptap/extension-table` (+row/cell/header) v2.27.3 added to the
  editor family (`extensions/index.ts` → `createTableExtensions`).
- Canvas tool count log corrected to 9; `empty.shortcuts` hints now
  include G.
- CSS: the text-object prose scope gained table styles — fixed layout,
  theme-aware borders, header tint, selected-cell overlay, resize-handle
  + resize-cursor, and the six preset skins keyed off
  `data-table-preset`.

### Verified (agent-browser, RTL shell)

- Toolbar shows the table button ("جدول — ۳×۳"); picking 4×3 and clicking
  the canvas creates a 3-row × 4-col RTL table in edit mode with the caret
  in the first header cell; typed Persian lands there.
- Table toolbar ops: +row (2→3), +column (3→4), direction toggle
  (rtl→ltr→rtl, live attr flip), preset switch (zebra), cell background
  (#bfdbfe applied as inline style, verified via computed style).
- In-session undo: add row → Ctrl+Z restores 3 rows.
- Object-level undo: Escape commits (static render keeps content);
  Ctrl+Z removes the whole table object in ONE step; Ctrl+Y restores it
  with content.
- TSV paste into a text box builds a real 3×3 RTL table carrying all cell
  texts ("نام/نمره/رتبه/علی/۱۸/۱/سارا/۲۰/۲"); the same paste into a
  table cell is rejected and shows the Persian toast; no nested table.
- Column resize: hovering a column border materialises 3
  `.column-resize-handle` widgets; dragging shrinks the column
  (205→146px, `col width` style set).
- Tab moves the caret to the next cell; RTL order confirmed geometrically
  (header cells' x positions: col 1 rightmost at x=456).
- Persistence: reload restores all tables with content, dir and preset
  (autosave round-trip); fresh boots log `tools: 9`.
- Gates: tsc ✓ eslint ✓ prettier ✓ vitest 928/928 ✓ (13 new tests).

## [1.4.1] — Rich-text UX polish: selection-gated toolbar, manual inspector, scrollable panels (2026-09-07)

Four user-reported UX fixes on top of Phase 3A, all E2E-verified in the
RTL Persian shell.

### Changed

- **Floating format toolbar is now selection-gated** (`TextFormatToolbar` +
  `useRichTextSession`): entering edit mode (drawing a text box or
  double-clicking) no longer summons the bar — it appears only once an
  actual text RANGE is selected (ProseMirror non-empty selection; caret-only
  typing stays chrome-free, tldraw-style). The session state exposes the
  selection's union rect (DOM-selection based, bidi-correct, with a
  `coordsAtPos` fallback) instead of the old caret anchor.
- **Toolbar placement: fully ABOVE the selected text** (never on it): the
  bar rests with a 12px clear gap above the selection rect, horizontally
  centred on it and clamped into the viewport; it flips BELOW the selection
  (12px gap) only when the viewport top leaves no room above. An explicit
  `width: max-content` keeps the natural width independent of the clamped
  `left` (a fixed element would otherwise shrink-to-fit into the space
  right of `left`, stacking the 11 control groups vertically and covering
  the text); the real width/height are re-measured in `useLayoutEffect`
  per transaction so the clamping and flip math stay honest.
- **Inspector panel is strictly manual**: the bottom-corner toggle is the
  ONLY way to open/close it — selecting objects never summons or dismisses
  it (supersedes the DECISIONS #41 auto-follow behaviour; an open panel with
  nothing selected just shows the hint state).
- **Panels actually scroll** (Inspector + Layers): the auto-height
  (max-h clamped) panel sections made the Radix ScrollArea viewport's
  `height: 100%` resolve against an indefinite flex chain in Chromium —
  the viewport sized to its CONTENT (503px) instead of the allotted space
  (310px), so everything below was clipped and unreachable. Both panels now
  use a native `overflow-y-auto` host with a new `.panel-scroll` custom
  scrollbar (thin, rounded, theme-aware, `scrollbar-gutter: stable`).
  E2E: a selected text box scrolls all sections (متن / قالب‌بندی متن /
  هندسه) fully into view, 613px of scroll range.

## [1.4.0] — Phase 3A: rich text core — TipTap engine, formatting & RTL (2026-09-07)

The flagship text upgrade: text boxes become real rich-text containers
powered by TipTap v2 (ProseMirror) — ONE shared editor instance, DOM-overlay
views synchronised with the camera, character-level formatting, alignment,
per-block direction control and flawless Persian/RTL/bidi behaviour.

### Added

- **Rich text engine** (`text/editor/TipTapFactory`): the app-scoped
  `TextEditorService` owns the ONE configured editor (host re-parenting on
  edit-target change — the ProseMirror view is never re-created; AC3A.8).
  Document swaps rebuild the editor state, which also RESETS the internal
  undo history (the next object's Ctrl+Z can never replay the previous
  object's typing). Static views render through the same schema
  (`renderRichTextHTML`), so live and static rendering are byte-identical
  (AC3A.1, verified to the sub-pixel at 1.56x zoom in E2E).
- **Extension set** (`text/editor/extensions`): StarterKit (history; block
  nodes in the schema with NO toolbar UI yet — Phase 3B), Underline,
  TextStyle, FontFamily, Color, Highlight, TextAlign, Subscript,
  Superscript, Placeholder, plus three custom TextStyle-based metric
  extensions (FontSize, LineHeight, LetterSpacing — world-unit values that
  map 1:1 through the camera-scaled layer) and `PersianKeys` (ZWNJ via
  Ctrl+Shift+Space, R3A.8). Markdown input/paste rules are OFF (Phase 3B
  scope guard).
- **Direction & RTL** (`text/editor/extensions/Direction`): every block
  node carries a `dir` attribute defaulting to `auto` — per-paragraph bidi
  auto-detection by first strong character (UAX #9), zero manual
  re-ordering. The toolbar toggle stamps explicit RTL/LTR on the selected
  blocks (Shift+click returns to auto). Mixed Persian/Latin paragraphs
  coexist correctly in one object (AC3A.4, E2E + VLM verified).
- **Undo contract** (`text/commands/RichTextCommand`): while the editor is
  focused, TipTap's history handles Ctrl+Z at typing granularity; on exit
  the session pushes exactly ONE `RichTextCommand` (before/after document +
  projection + box geometry), so object-level undo restores the whole
  pre-edit content AND box in a single step (AC3A.7, E2E verified:
  one Ctrl+Z reverted a full zoomed edit session's text + geometry).
  Live typing syncs the document into the scene object WITHOUT history
  (mid-typing autosaves capture real content — a reload no longer loses
  the session), comparing against the session baseline at commit.
- **Floating format toolbar** (`ui/components/text/TextFormatToolbar` +
  `FormatControls`): appears above the live selection while editing with
  font family (live font-preview labels, Vazirmatn first), font size
  stepper, bold/italic/underline/strike, sub/superscript, text colour +
  highlight pickers (curated palettes), 4-way alignment, the direction
  toggle, line-height and letter-spacing steppers, clear-formatting and
  the ZWNJ inserter. Every control preserves the editor's focus
  (mousedown default-prevention + the `data-text-format-ui` focusout
  exemption) so clicking a format never ends the session.
- **Inspector rich-text section** (`ui/components/text/InspectorTextSection`):
  the same control set for a selected (not edited) text box — commands run
  through `applyWholeDocumentFormat` (select-all + chain + ONE
  `RichTextCommand`; R3A.6, E2E verified: whole-doc colour + one-step
  undo).
- **Text box size modes** (R3A.7): FIXED (drag-out — wraps at the width,
  height follows content) and AUTO (tap/double-click — width grows to the
  longest line up to 640 world units). Growth anchors the direction-aware
  corner: RTL pins the RIGHT edge (the caret lands exactly on the tap and
  the box grows leftward; AC3A.6 — E2E: right edge held at 500 across the
  whole growth), LTR pins the left edge. A manual width resize (handles or
  inspector) pins an AUTO box to FIXED. Measurements round UP with a 1px
  safety margin (scrollWidth rounds fractions down — a 0.5px-short box
  wrapped its longest line).
- **Editing lifecycle** (R3A.2): double-click or Enter (single selected
  text object) opens the session; Esc/click-away/tool-switch commits.
  Wheel events over the live editor forward to the camera handler (pan/
  zoom stays available while editing) EXCEPT while a text selection is
  active. Sticky notes keep the legacy plain contentEditable session.
- **Persian essentials**: Vazirmatn is the default font (bundled), the font
  list leads with Persian-capable families, ZWNJ shortcut documented in
  the toolbar tooltip, 34 new i18n keys in fa/en, RTL toolbars.

### Fixed

- Fractional measurement wrap: `scrollWidth`/`scrollHeight` round down;
  boxes a fraction short of their longest line wrapped it spuriously
  (fixed with ceil+1 measurement).
- Session-anchor drift: the first-strong-character direction heuristic
  could flip sides mid-typing (neutral "!" then English), re-anchoring the
  box. The anchor direction is now sticky per session (captured at session
  start; creation defaults RTL).
- "Unchanged content" exits blanked the static view: the "none" commit
  path fires no scene event, so no dirty frame ever repainted the cleared
  DOM — `exitRichEdit` now renders the final document synchronously.
- Mid-typing refresh loss: the live document now syncs into the scene
  object per keystroke (history-free), so autosaves capture the content.

### Tests

- 8 new suites / 57 new tests (913 total, all green): Direction extension
  (default auto + explicit + unset + mixed paragraphs + round-trips),
  typography metrics (set/clear/coexist/round-trip), PersianKeys (command
  + real Ctrl+Shift+Space keydown), the shared editor service (ONE
  instance, history reset on swap, lossless round-trips, mount/detach
  identity, static HTML == live DOM), pure richtext model (projections,
  legacy upgrade, emptiness, serialisation, direction heuristics),
  RichTextCommand (exact restore, cycles, removed-object skip, order
  preservation), TextMetrics (mode clamps + both anchors) and 6 new
  TextCommit cases (doc-based + baseline comparison).

## [1.3.0] — Phase 2: object model, selection, manipulation, undo/redo (2026-09-07)

The full Phase 2 interaction contract: real rotation, groups as first-class
citizens, Alt+drag duplication, Shift axis locking, complete z-order and
lock commands — every action exactly one undo step.

### Added

- **Rotation** (`RotateGesture`, `RotateCommand`, `HandlesRenderer`): a
  circular handle above the (rotated) top edge spins the single selection
  around its bounds centre; Shift snaps to 15° steps; Escape restores the
  pre-gesture state without touching history. Rotated objects render their
  TRUE tilted frame — canvas shapes rotate around their centre, DOM text
  boxes/sticky notes rotate via CSS — hit-testing un-rotates the point into
  the local frame, and handle-drag RESIZE runs in the local frame so tilted
  edges stay tilted while the handles follow the pointer. The status bar
  shows a live angle chip (`rotate:live`/`rotate:ended` bus events).
- **Groups** (`GroupObject`, `GroupCommand`, `UngroupCommand`): Ctrl+G wraps
  ≥ 2 top-level objects into a group; children keep ABSOLUTE world geometry
  (bounds derive from the live union), so moving/deleting/duplicating a
  group carries the members and ungrouping is pure bookkeeping. Rotating a
  group spins every member around the group centre (AC2.5, verified
  numerically in E2E). Clicking a grouped child selects the GROUP
  (top-level resolution, Figma contract); the marquee resolves member hits
  to their group too.
- **Alt+drag duplication** (`SelectTool`): holding Alt at press copies the
  selection in place and drags the COPIES; the adds plus the coalesced move
  land as ONE composite undo entry; Escape removes the copies and restores
  the original selection.
- **Shift axis lock** (`SelectTool`): a Shift-held move projects the
  ACCUMULATED displacement onto its dominant axis, so pressing Shift
  mid-drag straightens the whole path.
- **Z-order ops** (`ZOrderOps`, `ZOrderCommand`, `Scene.applyOrder`): bring
  to front / bring forward / send backward / send to back for selections
  (Ctrl+Shift+] / Ctrl+] / Ctrl+[ / Ctrl+Shift+[). Planning runs on the id
  sequence (block moves past unselected neighbours, internal order
  preserved); the command snapshots the full before/after order —
  snapshot-exact undo immune to interleaved mutations.
- **Lock command** (Ctrl+L): locks when any selected object is unlocked,
  unlocks when all are locked; locked objects refuse selection, gestures,
  nudges and inspector edits (the `locked` contract, DECISIONS #42).
- **Selection actions cluster** (`SelectionActions`): a contextual glassy
  pill above the toolbar with duplicate, delete, z-order popover,
  group/ungroup and lock — Persian tooltips carrying the shortcut hints,
  availability mirroring the ops' preconditions.
- **Edit menu section** (`ProjectMenu`): duplicate/delete/group/ungroup/lock
  plus a z-order submenu — the menu twins of the cluster and the keyboard.
- **Inspector rotation field**: degrees, two-way binding, one undo step
  (snapshot-swap `RotateCommand`).
- **Marquee substantial-intersection rule** (AC2.2): an object joins the
  selection when the rectangle covers ≥ 50% of its bounds OR contains its
  centre (the thin-object escape hatch); corner clips no longer select.

### Changed

- **HistoryManager limit 100 → 200** (R2.6: stack ≥ 200), composition root
  and default alike.
- **Arrow-key nudge is now world units** (1, Shift = 10) per R2.5 — no
  longer zoom-compensated screen pixels.
- **Spatial index contract tests** (`LinearSpatialIndex`): insert/remove/
  query/clear/re-insert semantics pinned so an R-tree can swap in later
  (R2.2).

### Fixed

- **Locked members in mixed selections** now refuse moves: the drag frames
  and nudge bursts filter locked ids, so a locked-while-selected object
  never translates (caught as a gap during E2E).
- `RotateCommand` no longer re-adds objects that were deleted between the
  gesture and an undo (the MoveCommand skip convention).

### Tests

- 66 new unit tests: GroupObject math (union bounds, member expansion,
  orbit invariants), RotateCommand/GroupCommand/UngroupCommand undo-redo
  sequences, z-order planning (4 ops + no-ops + undo), selection ops with
  groups (delete/duplicate/nudge/lock), rotation-aware hit-testing,
  rotated covering boxes, marquee substantial-intersection + group
  resolution, SelectTool Phase-2 gestures (rotation handle, Shift snap,
  group rotation, Alt+drag one-step undo, axis lock, group-level click),
  spatial-index contract, 200-object perf budget (AC2.6) — 856/856 green.

## [1.2.1] — Connector usability: click-click creation (2026-09-07)

User report: "I click on shapes but no connector appears." Root causes
found and fixed:

### Fixed

- **Pointer capture crash** (`CanvasSurface`): `setPointerCapture` threw
  `NotFoundError` for synthetic/inactive pointer ids, and the exception
  broke the whole pointerdown chain — the active tool never received the
  press, so the gesture silently did nothing. Capture is now guarded
  (best-effort convenience, never a hard requirement).

### Added

- **Click-click connector creation** (`ConnectorTool`): a TAP on an
  object no longer does nothing — it ARMS the start endpoint (the
  rubber-band draft keeps following the cursor); clicking a DIFFERENT
  object commits the connector, clicking the same object, empty canvas,
  Escape or a tool switch disarms. Drag-to-connect keeps working
  unchanged; both modes share the preview and the single-history-step
  commit path.
- **Status-bar hint**: while the connector tool is active the ready chip
  shows «کلیک اول روی یک شیء، کلیک دوم روی شیء دیگر — یا بکشید»
  (fa) / "Click one object, then another — or drag" (en) with a Spline
  icon instead of the offline indicator.

### Tests

- 5 new ConnectorTool unit tests (tap-arms, click-click commit,
  same-object disarm, empty-canvas disarm, Escape disarm, tool-switch
  disarm); 790 total. Real-mouse E2E verified both modes + undo/redo.

## [1.2.0] — Phase 1 spec alignment: camera & navigation (2026-09-07)

A full-repo audit against the original Phase 1 acceptance spec found four
drifts introduced by later rounds (plus one fresh bug this round's E2E
caught). All are closed — the camera now honours the exact [0.02, 64]
zoom range, fit-to-content, grid toggle and double-click zoom gestures
of the spec.

### Added

- **Zoom range [2%, 6400%]** (`CameraController`): `MIN_ZOOM`/`MAX_ZOOM`
  widened from the interim [0.1, 8] to the spec range; the status bar
  readout renders the full span in Persian digits (۲٪ … ۶۴۰۰٪).
- **`Camera.visibleWorldBBox(viewport)`** (pure method, R1.1): the tight
  axis-aligned world cover of the (possibly rotated) visible quad —
  unit-pinned for identity, zoomed, panned and rotated cameras.
- **`CameraController.fitToBBox(box, viewport, padding)`**: frames any
  world box with per-side padding, rotation-aware (content extents are
  rotated into the screen-aligned axes before scaling), zoom clamped to
  the spec range; degenerate boxes reset the framing. Notifies once.
- **`Ctrl/Cmd+1` — fit all content**: unions every scene object's bbox
  (null-accumulator — the world origin never pollutes the bounds) and
  frames it; an empty scene resets the view.
- **`Ctrl/Cmd+'` — grid toggle**: `uiStore.gridVisible` + renderer
  `setGridVisible` skip the dotted grid and origin marker; the render
  loop repaints once on toggle.
- **Hand-tool double-click zoom**: double-clicking with the hand tool
  (or while space-panning) zooms in one step (×2) anchored exactly at
  the click point, and cancels any open pan drag.

### Fixed

- **Fit-to-content origin pollution** (found by this round's E2E): the
  bounds accumulator started from `emptyBBox()` — the degenerate box at
  the world ORIGIN — so fitting content far from (0, 0) framed a phantom
  box anchored at the origin (two rects at (200,150) fitted to 107%
  instead of 170%). The accumulator now starts as null.

### Changed

- `zoomAt` clamp tests re-pinned for the new range; 17 new unit tests
  (visibleWorldBBox ×4, fitToBBox ×7, HandTool ×6) — 785 total.
- Version chips bumped to ۱٫۲٫۰ / 1.2.0.

## [1.1.0] — Autonomous review round 11: Connectors (2026-09-07)

The last stubbed creation primitive goes live: drag from any object to any
other (or empty canvas) and a routed, arrowed connector appears — and it
STAYS connected. Glued endpoints derive their position from the target's
live bounds (the scene's glue-follow pass), so connectors ride along when
objects move, resize, duplicate, undo or reload.

### Added

- **Anchor system** (`core/model/Anchors.ts`, real): every object exposes
  eight glue anchors (N/E/S/W edge midpoints + corners) derived from its
  bounds — `anchorPositions`, `anchorAt` (wrapped index), `nearestAnchor`
  (snap target), `anchorExitVector` (the flowchart exit direction of an
  anchor).
- **Connector object** (`core/model/ConnectorObject.ts`, real): endpoints
  glued to `{objectId, anchorIndex}` with a cached world position; style
  fields (stroke colour/width/dash, routing, per-end arrowheads);
  `connectorFromEndpoints`, live `resolveConnectorEndpoint(s)` /
  `resolveConnectorPath`, `connectorPathShape` (straight / orthogonal
  elbow / exit-aware curved bezier with perpendicular fallback),
  `sampleConnectorPath` (bezier flattening), `refreshGluedConnector`
  (glue-follow), `connectorBBox`.
- **Glue-follow pass** (`core/model/Scene.ts`): after EVERY mutation the
  scene re-derives every glued connector's endpoint caches against the
  current object list (re-entrancy-guarded, no extra revision) — move,
  resize, duplicate, undo/redo, import and boot-restore all keep
  connectors attached without any command knowing about them.
- **Connector tool** (`interaction/ConnectorTool.ts`, real): press on an
  object glues the start to its nearest anchor; the drag streams a
  rubber-band draft (`rendering/ConnectorOverlay.ts`) with live glue
  candidates — hovered target glows, the end dot snaps (solid + halo)
  over an object and floats (hollow) over empty canvas; release commits
  through `AddObjectCommand`; taps, same-object releases and Escape
  cancel cleanly. `hoverCursor` advertises glue targets ("pointer").
- **Connector rendering** (`rendering/Canvas2DRenderer.ts`): world-space
  routed paths mapped to screen (exit-aware curves computed in world
  space so hit-testing matches pixel-for-pixel), zoom-scaled dash
  patterns, filled arrowheads with tangent-correct orientation, and the
  full rubber-band preview affordances.
- **Reconnect gesture** (`interaction/SelectTool.ts`): a single selected
  connector swaps its resize handles for two endpoint dots; dragging a
  dot re-glues it live (one `UpdateObjectCommand` on release; Escape
  restores the snapshot). Connector hit-testing joins
  `objectHitTest.ts` (sampled path + stroke half-width + tolerant
  broad-phase).
- **Style patching**: `ObjectPatch`/`StyleChanges` gain `strokeStyle`,
  `routingKind`, `startArrow`, `endArrow` and endpoint replacement —
  the connector matrix in `planStylePatch` and the freehand dash field
  are planned and unit-pinned.
- **Toolbar connector picker**: the connector button becomes a popover
  (routing / arrow / dash rows with icon + CSS line previews, colour
  swatches) and mirrors the picked routing in its label, tooltip and a
  dash-style preview strip on the button itself.
- **Inspector connector section**: routing / arrow / line-style radio
  rows plus the shared stroke width + colour pickers; a hint chip
  explains the endpoint-drag re-glue affordance.
- **i18n**: 18 new keys (fa/en) for the picker rows, inspector labels
  and a11y hints; version chip bumped to ۱٫۱٫۰.

### Fixed

- **Connector hit-test broad-phase** (found by the unit-test round): the
  endpoint-box rejection is now padded by the full hit radius, so clicks
  within tolerance just outside a connector's box no longer silently
  miss.
- **Curved routing through source objects** (found by the VLM review):
  glued curved connectors now route flowchart-style along their anchors'
  exit rays instead of the fixed perpendicular control that could sweep
  through the source object's interior.

### Tests

- 203 new unit tests across 10 files (768 total): anchors, connector
  model + paths, scene glue-follow, connector branches of
  bbox/translate/resize, style patch matrix, connector tool gesture
  state machine, reconnect gesture, connector hit-testing, overlay
  contract, endpoint patches. New modules at 90–100% line coverage.

## [1.0.0] — Autonomous review round 9: Project Persists (2026-09-07)

The application earns its 1.0: work survives. The scene (objects, camera,
paint order) is snapshotted into a versioned `.icb` JSON project file,
autosaved to an offline slot every 2 seconds of change, restored on every
boot, and portable via real file export/import — all defensive end-to-end
(a corrupt or future-version file is refused, never a crash). The
milestone mark: draw, reload, continue.

### Added

- **Project file format** (`persistence/ProjectFile.ts`, real): the
  versioned payload contract — `ProjectCameraData` + every
  `SceneObjectData` in paint order; `PROJECT_MAGIC` (".icb"),
  `PROJECT_FILE_VERSION` (1), `AUTOSAVE_STORAGE_KEY`. Pure helpers:
  `buildProjectData(scene)` (snapshot), `validateProjectData(data)`
  (structural validation — ids, kinds, finite numbers, booleans; corrupt
  files never reach the model), `applyProjectData(scene, data)` (clear +
  re-add + camera restore → count), `asRecord` narrow helper.
- **Versioned serializer** (`persistence/VersionedSerializer.ts`, real):
  writes `{magic, version, savedAt, scene}` JSON; `deserialize` parses
  defensively (JSON errors, wrong magic, non-integer/zero/future version,
  migration-chain break, validation failure → all `null`).
- **Migration chain** (`persistence/migrations/index.ts`, real):
  `runMigrations(data, from, to, chain)` walks version steps forward;
  a missing step refuses the load. `MIGRATIONS` is empty — version 1 is
  current (the chain walker is proven by unit tests with fake chains).
- **Storage backend abstraction** (`persistence/StorageBackend.ts`, new):
  `IProjectStorage` (async, Tauri-fs-shaped) + `WebStorageBackend`
  (localStorage with an availability probe and per-op try/catch — blocked
  storage degrades to "no persistence", the app keeps working).
- **Autosave service** (`persistence/AutosaveService.ts`, real): the
  single writer of the autosave slot. `markDirty` on scene/camera change
  (wired in `App.ts`), a 2s interval tick, `saveNow(reason)`
  (reentrancy-guarded; emits `persistence:saved`/`persistence:save-failed`
  on the typed bus), `clearStorage` (new project),
  `attachWindowFlush` (visibilitychange + beforeunload best-effort flush —
  localStorage writes are synchronous, so the last strokes survive a
  reload even between ticks).
- **Restore on boot** (`App.ts`): the composition root reads the slot,
  deserialises, applies, reseeds the `IdGenerator` past every loaded id
  (no collisions), clears history (a loaded document starts fresh) and
  emits `project:restored`. A corrupt/absent slot simply starts empty.
- **Project menu** (`ui/components/ProjectMenu.tsx`, new): a glassy
  Radix dropdown at the canvas's inline-start top corner — Save now
  (Ctrl+S hint chip), **Download project (.icb)** (Blob download of the
  exact desktop payload), **Open project…** (file picker →
  `project:import-requested` → composition-root apply; corrupt files are
  refused with a shake + red-dot marker on the menu button), **New
  project** (clear + camera reset + slot reset). `project:import-failed`
  event for the feedback.
- **Ctrl+S** (`ui/hooks/useCanvasShortcuts.ts`): manual save, bypassing
  the timer (preventDefault — the browser dialog never appears).
- **Autosave status chip** (`ui/components/StatusBar.tsx`): a tone-mapped
  state machine chip — idle (muted), dirty (primary pulse dot — the same
  ping animation as the editing chip), saved (emerald check + localised
  HH:MM via `Intl.DateTimeFormat`), failed (red alert). `saveState` +
  `lastSavedAt` added to `useCanvasStatus` (event-driven +
  service-seeded).
- **5 typed bus events** (`core/events/EventBus.ts`):
  `persistence:saved {timestamp, reason}` (auto | manual | flush),
  `persistence:save-failed {reason}`, `project:restored {objectCount}`,
  `project:import-requested {raw}`, `project:new-requested
  {discardUnsaved}`, `project:import-failed {reason}`.
- **i18n** (fa/en): 11 new keys (project.*, status.save.*,
  a11y.saveState); version ۱٫۰٫۰ / 1.0.0.

### Changed

- `Scene.clear()` (new method): drops every object, prunes the selection,
  bumps the revision once — the document-reset primitive used by loads and
  New project.
- `IdGenerator.reseed(usedIds)` (new method): moves the counter past the
  max numeric suffix of its own prefix (foreign/non-numeric ids ignored;
  never backwards) — restored objects never collide with new ids.
- `useCanvasStatus`: seeds object count/zoom/selection/history state from
  the live services at install time (the boot-time restore emits its
  scene events before the hook subscribes — events alone left stale
  zeros; found by reload E2E).
- Project-file migration barrel + serializer/autosave stubs → real
  implementations (the Phase 0 JSDoc contracts held: no signature changes).

### Verified (agent-browser E2E, real CDP input)

Draw → chip dirty → 2s tick → saved + time ✓; `.icb` JSON in
localStorage (magic/version/objects) ✓; **reload → full restore** of
freehand + stickyNote (Persian text in the DOM overlay) + shape, camera
included (zoom ۱۲۵٪ + world offset proven by pointer readout) ✓; status
seeding after reload ✓; Ctrl+S immediate save ✓; file import via the
real picker (camera + objects + text applied, autosaved) ✓; corrupt file
→ refused, scene untouched, shake + red dot ✓; New project → clear +
camera reset + slot reset ✓; download → correct `.icb` blob payload ✓;
visibilitychange flush → immediate save ✓; VLM screenshot review (dark +
light) — all elements present, no defects ✓; zero console errors across
the whole session ✓.

### Tests

110 new unit tests (7 files): ProjectFile 30, AutosaveService 23,
VersionedSerializer 17, IdGenerator 15, WebStorageBackend 9, Scene.clear
8, runMigrations 8 — total **565/565**, typecheck/lint/prettier clean,
coverage 99.73% statements / 99.52% branches / 100% functions (all six
persistence modules at 100% ×4). One real bug (stale status zeros after
restore) found by E2E and fixed with service seeding; the test subagent
found no functional bugs (two theoretical edge notes recorded in
DECISIONS #52).

## [0.9.0] — Autonomous review round 8: Sticky Notes (2026-09-07)

The canvas gets its most expressive object: sticky notes. Tap (N) or drag
out a pastel card, type immediately in Persian, recolour it from an
eight-swatch post-it palette (toolbar picker or the inspector's new Card
section), move/resize/duplicate/delete it like any object — every edit a
command on history. The whole feature reuses the proven text-overlay
machinery: one DOM layer, one edit session planner, one commit pipeline.

### Added

- **Sticky note domain object** (`core/model/StickyNoteObject.ts`, real):
  `StickyNoteObjectData` with inline `text`/`fontSize` (the DECISIONS #36
  inline-text rule), `width`/`height` (the generic sized-kind bbox/resize
  paths apply), `noteColor` (literal CSS pastel) and a fixed dark card ink
  `DEFAULT_STICKY_INK` that stays readable on every pastel in both themes.
  Constants: 220×220 default card (centred on the tap), 18 default font
  size, 80×80 drag minimum, 1.6 line height, 14/12 card padding, and the
  curated `STICKY_NOTE_COLORS` palette (8 warm/neutral pastels, no
  blue/indigo, amber first). The Phase 0 stub's `textDocId` indirection is
  gone. Factory `stickyNoteFromRect` + `defaultStickyNoteRect` + type guard.
- **Sticky tool** (`interaction/StickyTool.ts`, new): the TextTool intent
  pattern for cards — tap edits a hit note or emits
  `sticky:create-requested` (default centred card); drag-out commits the
  dragged rectangle clamped to the note minimum. Never imports the text
  feature module (bus only, CLAUDE.md §1.4). Shortcut **N**; cursor
  crosshair. Registered in `App.ts` (tools: 8) with uiStore-backed
  `getNoteColor`/`getFontSize` providers.
- **`sticky:create-requested` event** (`core/events/EventBus.ts`): typed
  payload (rect + noteColor + fontSize) forwarded by the composition root
  to `TextLayerView.beginStickyCreation`.
- **Card variant in the text overlay** (`text/view/TextObjectView.ts`):
  a `variant` constructor parameter ("plain" text boxes | "card" sticky
  notes, fixed per object id). Cards paint their `noteColor`
  imperatively, use the sticky padding/line-height metrics, and get the
  `.sticky-note-view` class (globals.css): 4px radius, layered paper
  shadow, hairline top sheen, stronger lift + accent ring while editing,
  and a pastel-tinted placeholder.
- **`TextLayerView` widening**: `sync`/`beginEditing`/`endEditing` accept
  both text-bearing kinds; `beginStickyCreation` mirrors
  `beginCreation` (silent pending creation, commit planner decides);
  `TextBearingObject` union exported from `text/commands/TextCommit.ts`;
  the shared `startCreationSession` tail; per-kind placeholder
  (`sticky.placeholder` dictionary key — "یادداشتتان را اینجا بنویسید…").
- **Sticky style plumbing**: `StyleChanges.noteColor` +
  `StylePatchFields.noteColor`; `planStylePatch` sticky branch
  (noteColor + fontSize + color, clamped, no-op-dropping). Inspector
  **Card section**: `stickySwatchOptions()` swatch grid + the
  font-size stepper; the note ink intentionally stays the fixed dark
  card ink this phase.
- **Toolbar sticky picker**: the sticky button opens a popover with the
  8-colour palette (radio tiles with paper-shadowed chips); the picked
  colour lands in uiStore (`stickyColor`, default amber) and the button
  mirrors it with a colour-dot badge. The status bar and layers panel
  already knew the kind ("یادداشت ۱").

### Fixed

- **Focus-race hardening in edit sessions** (found by same-frame E2E):
  a popover's deferred focus restoration could steal the fresh editor's
  focus right after creation, and the focusout handler then silently
  discarded the empty pending note. Fix: a 350ms focus grace period after
  session start (transient steals are not click-aways) plus re-focus
  guards at 0/120/300ms in `enterEdit` (the D40 pattern extended).
  Real-user taps (>50ms after a popover closes) were never affected —
  the guard closes the synthetic-event race.

### Tests

- 455 unit tests (43 new): `StickyNoteObject.test.ts` (16 — constants,
  guard, palette invariants, default rect, factory, bbox/translate/
  resize), `StickyTool.test.ts` (15 — intent log over the bus: tap/
  drag/guards/edit-hit/lifecycle), StylePatches sticky matrix (10 new),
  TextCommit sticky planner (5 new). Coverage 99.66% statements /
  99.36% branches / 100% functions; new modules at 100%.

## [0.8.0] — Autonomous review round 7: Inspector Alive (2026-09-07)

The selection becomes editable. A property inspector docks at the
inline-end bottom corner (mirroring the layers panel at the top): it
auto-opens when the selection goes from empty to non-empty, follows every
live change, and edits strokes, fills, text ink, font sizes and numeric
geometry — every mutation a command on history, batch restyles of
multi-selections in one undo entry, locked objects refusing edits.

### Added

- **Inspector panel** (`ui/components/panels/InspectorPanel.tsx`, real):
  glassy floating panel (`end-4 bottom-16`, mirrors the layers styling)
  that follows the selection — auto-open on the 0→N transition,
  auto-close on N→0, manual toggle always available (D41). Sections
  render per selection content: Stroke (shapes + freehand), Fill
  (shapes), Text (text boxes), Geometry (single sized object — x/y
  position, width/height). The header shows the kind label of a single
  selection or the object count of a multi-selection; locked selections
  show a hint and disable every control (D42).
- **Pure style planner** (`core/commands/StylePatches.ts`, new):
  `planStylePatch(object, changes)` maps one user intent onto the
  kind-valid patch — shapes take fill/stroke/strokeWidth, freehand
  strokes take strokeColor/strokeWidth, text boxes take fontSize/color,
  every other kind (and every no-op change) yields `null` so the model
  never pushes empty history entries. `clampStrokeWidth` (1–48) and
  `clampFontSize` (8–96) bound the editable ranges.
- **Inspector model bridge** (`ui/hooks/useInspectorModel.ts`, new):
  scene/selection snapshot (the `useLayersModel` pattern) plus
  command-backed actions — `applyStyle` batches per-object
  `UpdateObjectCommand`s (skipping locked and incompatible objects,
  D41) into one `CompositeCommand` per user action; `moveTo` routes
  through `MoveCommand` (delta-based, freehand point lists move too);
  `resizeTo` routes through `ResizeCommand` snapshots with min size 1.
- **Inspector controls** (`ui/components/panels/inspector/Controls.tsx`,
  new): `SwatchGrid` (5-per-row theme-token + 8 curated oklch swatches +
  slashed "no fill"; active-ring state; token previews resolve against
  the active render palette, D45), `WidthPicker` (۱/۲/۴/۸ line-bar
  tiles), `FontSizeStepper` (−/+ around an exact field) and
  `NumberField` (uncontrolled input with focus-safe external sync via a
  DOM layout effect, Enter/blur commit, Escape revert, Latin digits LTR,
  D43).
- **ObjectPatch widened** (`core/commands/UpdateObjectCommand.ts`): the
  patch type now carries the style fields (`fill`, `stroke`,
  `strokeColor`, `strokeWidth`, `fontSize`, `color`) with the kind
  matrix documented and enforced by the planner; geometry edits
  deliberately stay on Move/Resize commands.
- **43 new unit tests** (subagent 8-t): the full StylePatches kind
  matrix (39 tests, 100% ×4 coverage) + UpdateObjectCommand style-patch
  exact-restore cycles (4 tests); suite 369 → **412**.
- **i18n**: 36 new keys per language (`inspector.*`, `color.*`,
  `a11y.inspector`); version ۰٫۸٫۰.

### Changed

- **Default stroke width 3 → 2** (`App.ts`): fresh shapes and pen
  strokes now match the inspector's "thin" preset so a default object
  always shows an active state (D44).
- **CSS animation reuse**: the inspector reuses the existing
  `panel-pop-in` keyframes — no new animation code.

### Verified (agent-browser E2E, real CDP input)

- Auto-open on selection; auto-close on empty; manual toggle ✓
- Width preset pick → live canvas restyle; default preset active ✓
- Fill swatch (کهربایی) → live fill + active ring; stroke swatches ✓
- Numeric X edit 300 → 500 → exact move; undo chain (move → fill →
  width, in order) and redo chain ✓
- Multi-selection: count ۲, no geometry section, mixed widths → no
  active preset; batch pick ۴ → both objects restyle; ONE undo reverts
  both (composite) ✓
- Text box: Text + Geometry sections only, kind label, font stepper
  20→24 live-renders the DOM overlay at 24px, ink swatch live-colours
  the text, undo reverts to token ✓
- Locked object (via layers panel): hint + all inputs/buttons disabled;
  unlock re-enables ✓
- Theme flip: swatch previews + text ink render correctly in both
  themes; fa RTL layout intact ✓
- Zero console errors across the whole session ✓
- Unit gates: typecheck ✓, lint ✓, 412/412 tests ✓, coverage 99.63%
  statements / 99.3% branches / 100% functions (StylePatches 100% ×4) ✓

## [0.7.0] — Autonomous review round 6: Text Alive (2026-09-07)

The last creation primitive lands: text boxes. A DOM overlay layer
(CLAUDE.md §1.3's hybrid rendering model) renders every text object
camera-transformed for pixel-perfect Persian/RTL text at any zoom, while
the canvas layer keeps hit-testing, selection frames and handles. Click
with the text tool (or double-click the canvas) to create, double-click a
box to edit, Escape or click-away to commit — every edit is one undo
entry, and empty fresh boxes vanish without history noise.

### Added

- **TextBoxObject model** (`core/model/TextBoxObject.ts`, real): the
  plain-text object kind — `width`/`height` (top-left origin, like
  shapes), inline `text` (D36), `fontSize` (world units), palette-token
  `color`; `isTextBoxObject` guard; `defaultTextBoxRect` (260×64 box
  whose first-line centre aligns with the tap); `textBoxFromRect`
  assembler. The generic sized-kind paths of `objectBBox` /
  `translateSceneObject` / `resizeSceneObject` cover the geometry — text
  boxes are selectable, movable, marquee-able and resizable out of the
  box.
- **Text DOM overlay** (`text/view/TextObjectView.ts` +
  `text/view/TextLayerView.ts`, real): per-object divs transformed
  `translate·rotate·scale(camera)` with world-unit sizing — text stays
  pixel-crisp at any zoom (verified: 260×64 → 508×125 at ۱۹۵٪); layer
  `pointer-events: none`, the edited view alone goes `contenteditable`
  with `pointer-events: auto`; viewport culling (`display: none`), DOM
  paint order follows the scene's array order; the render loop drives the
  layer from its single dirty flag via a structural `RenderCompanion`
  interface (rendering/ never imports text/, D38).
- **Edit sessions** (`TextLayerView.beginEditing`/`beginCreation`/
  `endEditing`): one live editor at a time; creation adds the object to
  the scene WITHOUT history and the **commit planner**
  (`text/commands/TextCommit.ts`, pure) decides the landing — fresh box
  with text → one `AddObjectCommand`; existing box edited → one
  `UpdateObjectCommand`; any box emptied → removal (silent for fresh
  boxes, a recorded `RemoveObjectCommand` for pre-existing ones);
  unchanged text → nothing (D37, Excalidraw rule). Blur, Escape and
  tool-switch all commit with the typed text kept (Figma rule).
- **TextTool** (`interaction/TextTool.ts`, real): tap → create-requested
  (default rect, fontSize from the UI store); tap on a text box →
  edit-requested; drag-out → the dragged rect (clamped to ≥¾ line);
  intents travel the typed EventBus so interaction/ never imports the
  text module (D39). **SelectTool double-click**: hit a text box → edit
  it; empty canvas → create one (Excalidraw parity).
- **New bus events**: `text:edit-requested`, `text:create-requested`,
  `text:edit-began`, `text:edit-ended` (primitive payloads only — core/
  stays UI-free).
- **Font-size picker** (toolbar): the text button is now a popover picker
  (six world-unit sizes ۱۴–۴۸ with Persian labels, radio semantics,
  current size in the button's tooltip) mirroring the shape picker; the
  choice feeds `uiStore.fontSize` and lands on the next created box.
- **Editing chrome** (globals.css): accent ring + soft glow + shadow on
  the live editor, accent caret, accent-tinted `::selection`, and a
  `data-placeholder` `::empty::before` placeholder
  (“متن را اینجا بنویسید…”) — the accent mirrors the canvas painter's
  oklch-340 ink per theme.
- **Editing status chip** (status bar): pulsing accent dot + “در حال
  ویرایش متن” while a session is live (aria-live status).
- **`UpdateObjectCommand` patch type** extended with `text` (the layers
  panel's name/visible/locked patches share the command).

### Fixed

- **Focus steal on creation (round QA catch)**: the initiating click's
  default focus action (canvas clicks hand focus to `<body>`) fired AFTER
  `pointerup`, stole the editor's focus and triggered the focusout
  auto-commit — a fresh text box vanished the instant it was created.
  `enterEdit` now re-focuses in a zero-delay timeout guard, landing after
  the click's focus shift; the session survives its own opening click
  (pinned by the E2E: creation → focused editor → type → commit).

### Changed

- `ITool` gained the optional `onDoubleClick` hook (the canvas surface
  routes real `dblclick` events to the active tool; `TextTool`/
  `SelectTool` implement it).
- `RenderLoop` accepts an optional `RenderCompanion` synced in the same
  animation frame (one rAF drives canvas + DOM layers, §1.3).
- `AppContext` registers `Services.textLayer`; the composition root wires
  the text bus events to the layer and injects the language-aware
  placeholder labels.
- Empty-state hint and both dictionaries mention the text tool (T) /
  double-click; version bumped to ۰٫۷٫۰.

## [0.6.0] — Autonomous review round 5: Resizing & Layers (2026-09-07)

Objects come alive: handle-drag resizing with live dimensions, aspect lock
and undo, plus a full layers panel (rename, visibility, lock, z-order) —
every mutation still one history entry.

### Added

- **Resize geometry** (`core/geometry/resize.ts`, new): pure handle math —
  `RESIZE_HANDLE_IDS` (corners first), `resizeRectFromHandle` (controlled
  edges follow the pointer, untouched edges stay, min-size clamp anchors at
  the untouched edge so inward drags shrink exactly to the minimum and the
  box never inverts; Shift = before-aspect lock — corners scale from the
  dominant drag axis around the fixed corner, edges derive the undragged
  axis around its before centre), `hitResizeHandle` (screen-space anchors
  projected through the camera, corners win ties, strict tolerance),
  `handleAnchors`.
- **`resizeSceneObject`** (`core/model/SceneObject.ts`): kind-aware
  immutable resize. Shapes derive their rect absolutely from the after box
  inset by half the stroke width (padded-bbox semantics round-trip);
  freehand point lists map between pad-inset inner regions so live frames
  never drift outward (stroke width stays constant); sized kinds scale;
  others move. Degenerate before-boxes translate instead of dividing by
  zero.
- **ResizeCommand** (`core/commands/ResizeCommand.ts`, real): snapshot-swap
  command (before/after object data, exact restore like RemoveObject);
  the select tool applies frames live and pushes the finished command
  once (MoveCommand precedent: one gesture = one undo entry).
- **ResizeGesture** (`src/interaction/ResizeGesture.ts`, new): the gesture
  state machine extracted from SelectTool (files ≤300 lines): probe/begin/
  moveTo/commit/cancel; emits `resize:live`/`resize:ended` on the bus;
  Escape restores the before snapshot without touching history (D30
  contract); commit skips when nothing changed.
- **SelectTool resize phase**: pointer-down probes handles before object
  hit-testing (single interactive selection only); `hoverCursor` refines
  the pointer per state (resize handle → move drag → marquee). Hit-testing
  extracted to `interaction/objectHitTest.ts`.
- **Per-handle cursors**: `ToolCursor` gained `nwse/nesw/ns/ewResize`;
  `ITool.hoverCursor?` optional hook applied by the canvas surface after
  every move (purely visual, never tool state).
- **Active-handle highlight** (`HandlesRenderer.setActiveHandle`): the
  dragged handle paints larger with an accent glow; anchors now carry ids.
- **Live W×H readout** (status bar): accent chip subscribes to
  `resize:live`/`resize:ended` and shows Persian-digit dimensions while a
  resize runs (e.g. `۲۰۲ × ۵۲`).
- **LayersPanel** (`ui/components/panels/LayersPanel.tsx`, real): glassy
  floating panel at the inline-end top corner (mirrors automatically in
  RTL), top-most-first rows with per-kind Persian default names
  (`مستطیل ۱`, `خط قلم ۲`), click-to-select (Shift toggles), inline rename
  (double-click, Enter/Escape/blur), visibility eye, lock padlock, and
  bring-forward/send-backward z-order buttons; scrollable capped height;
  always-visible toggle chip with the live object count.
- **Layers model bridge** (`ui/hooks/useLayersModel.ts`): scene/selection
  snapshots via the event bus (useCanvasStatus pattern; Zustand stays
  UI-only) + command-backed actions.
- **UpdateObjectCommand** (`core/commands/UpdateObjectCommand.ts`, new):
  reversible name/visible/locked patches (do = merge into current, undo =
  before snapshot).
- **ReorderCommand** (`core/commands/ReorderCommand.ts`, new) +
  **`Scene.moveObjectTo`**: paint-order moves (array order is the z-order;
  clamped, no-op same-index never bumps the revision).
- **Styling**: shortcut letters on every toolbar button (top-end badge),
  panel pop-in keyframe, version ۰٫۶٫۰, resize-aware empty-state hint.

### Fixed

- **Resize geometry bugs found by the test subagent and fixed**: inward
  handle drags never shrank (provisional rect unioned with the before edge
  instead of tracking the fixed edge — drags could only grow); Shift on
  n/s handles was a no-op with dead vertical branch (the "moving" NaN
  encoding conflated *dragged* edges with *untouched* ones — replaced by
  an explicit `controls` encoding); corner/edge hit-test ties resolved to
  the later anchor instead of the corner (now corners-first with strict
  distance). All three pinned by tests.

### Changed

- `SelectToolDeps` gained `bus` (live-dimension events); `ITool` header
  doc updated (hooks are part of the contract, no longer a Phase 0 stub).
- `uiStore`: `layersPanelOpen` view preference (+ setters/toggle).
- i18n: `object.*` kind labels, `layers.*` panel strings,
  `a11y.dimensions`; fa/en dictionaries in sync.
- vitest coverage scope: 23 modules (resize, Resize/Update/Reorder
  commands added).

# Changelog — Infinite Canvas Studio

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.5.0] — Autonomous review round 4: Shapes Alive (2026-09-07)

The shape tool lands: six primitives drawn with live preview, a toolbar
picker, and full selection/manipulation integration — plus a keyboard
cancel hook for in-progress gestures.

### Added

- **Shape model** (`core/model/ShapeObject.ts`, real): `width`/`height`
  replace the parametric `geometryId` stub (position = world-space
  top-left, axis-aligned like every sized kind); `SHAPE_FILL_TOKEN`
  ("accent") for theme-adaptive fills next to the stroke token;
  `isShapeObject` guard; pure geometry helpers `normalizedRectFromDrag`
  (direction-agnostic min-corner rect, Shift = square constraint keeping
  per-axis drag signs), `defaultShapeRect` (tap placement),
  `shapeFromRect` (assembles the full data); `SHAPE_KINDS` order for the
  picker.
- **ShapeOverlay** (`rendering/ShapeOverlay.ts`): transient draft holder
  for the in-progress shape (StrokeOverlay precedent), notifier-driven
  dirty marking; `RenderLoop` renders it above the scene.
- **Shape rendering** (`Canvas2DRenderer`): all six primitives (rectangle,
  rounded rect, ellipse, triangle, diamond, 5-point star) with
  token-resolved translucent fill under a crisp stroke, viewport culling
  by padded bounds, zero-size guard; `renderShapeDraft` for the live
  preview; `shapeFill` added to `RenderPalette` (dark 20% / light 14%
  accent tints).
- **Shape tool** (`interaction/ShapeTool.ts`, real): drag-out creation
  with a live preview streamed through the overlay; Shift constrains to a
  square; releases smaller than 8 world units place a default 96×96 shape
  centred on the release point; commits through `AddObjectCommand` (ids
  from the shared generator); Escape mid-drag cancels via the new
  `ITool.onCancel?` hook.
- **Toolbar shape picker**: the shape button opens a popover with the six
  primitives (icon + Persian label each, active ring, `role=radio` +
  `aria-checked`); the picked kind lives in `uiStore.shapeKind` and the
  button icon mirrors it, so S always draws the last-picked primitive;
  chevron badge hints at the picker; tooltip shows the picked kind.
- **Escape priority** (`useCanvasShortcuts`): an in-progress tool gesture
  consumes the cancel first, only then clears the selection.
- i18n: `toolbar.shapePicker`, `shape.kind.*` (fa/en), `empty.hint` now
  mentions the shape flow; version → ۰٫۵٫۰ / 0.5.0.

### Fixed

- **Shape bbox padding** (flagged by the test subagent): `objectBBox`
  now pads shape bounds by half the stroke width (mirroring freehand), so
  thick outlines stay inside selection/marquee boxes; partial shape
  fixtures fall back to the degenerate position box (defensive guards).

### Verified

- `bun run typecheck` ✓, `bun run lint` ✓, `bun run test` 250/250 ✓
  (39 new: ShapeObject 27, ShapeOverlay 12), `bun run test:coverage`
  100% statements/branches/functions/lines on all 19 included modules.
- agent-browser E2E: rect/ellipse drag-out, tap → default square,
  Shift-drag → exact 260×260 square (pixel-verified bounds 58→320 at the
  computed row), star silhouette matches the computed 5-point vertex
  profile (VLM confirmed at 332% zoom); click-select/drag-move/delete/
  duplicate/undo on shapes; full history undo→0 and redo→5; picker
  popover opens with 6 Persian labels, picks star, auto-closes; Escape
  mid-drag cancels without committing; fa↔en toggle flips shape button
  label; theme switch re-paints shape fills; zero console errors.
- VLM screenshot reviews (dark + light): translucent fills + crisp
  strokes confirmed, toolbar with picker chevron, no glitches.

## [0.4.0] — Autonomous review round 3: Selection & Manipulation (2026-09-07)

Objects become first-class citizens: click-select, drag-move, marquee
multi-select, delete, duplicate and keyboard nudging — every gesture a single
undo entry, with full selection affordances on the canvas.

### Added

- **Selection model** (`core/selection/Selection.ts`, real): de-duplicated
  id set with `add` / `addMany` / `replaceAll` / `remove` / `toggle` /
  `clear` / `has` / `ids` / `size` / `isEmpty`; optional `onChange` notifier
  firing exactly once per applied change (never for no-ops). `Scene.remove`
  prunes the deleted id so the selection never holds ghosts.
- **Shared geometry helpers** (`core/model/SceneObject.ts`): `objectBBox`
  (freehand → padded point bounds; sized kinds → position + width/height;
  parametric kinds → degenerate position box) and `translateSceneObject`
  (immutable translation incl. freehand point lists) — one geometric truth
  for selection, marquee, hit-testing and commands.
- **Move & coalescing** (`core/commands/`): `MoveCommand` (reversible
  translation over an id list, missing ids skipped, zero-delta no-op) and a
  real `Coalescer` folding consecutive same-id-list move commands into one
  summed command — one drag or one nudge burst = ONE undo entry.
- **Select tool** (`interaction/SelectTool.ts`, real): gesture state machine
  (`press` → `move`, or `marquee` on empty canvas). Top-most model
  hit-testing (precise `distanceToSegment` for strokes with a 6px screen
  tolerance, bbox test otherwise), Shift-click toggle, Shift-marquee additive
  selection, click-collapse of multi-selection, live drag via per-frame
  coalesced `MoveCommand`s, deactivate mid-drag commits the applied
  translation.
- **Marquee logic** (`interaction/MarqueeLogic.ts`, real): world-space
  normalised rectangle, model hit-testing via `bboxIntersectsBBox`, hidden/
  locked objects skipped, degenerate start-point rect doubles as generous
  click-to-select.
- **Selection affordances** (`rendering/HandlesRenderer.ts`, real):
  per-object outlines, dashed union box, eight square handles (8px CSS,
  theme-stroked) and the live marquee rectangle (accent tint + border) —
  all painted in screen space (constant size at any zoom) with
  dark/light `SelectionColors` palettes wired through `RenderPalette`.
- **Keyboard manipulation** (`ui/hooks/useCanvasShortcuts.ts`):
  `Delete`/`Backspace` delete the selection (one composite history step),
  `Escape` clears it, `Ctrl/Cmd+A` selects all, `Ctrl/Cmd+D` duplicates
  (16-unit offset, new ids from the shared generator, copies become the
  selection), arrow keys nudge (1 screen px, Shift ×10) with idle-time
  coalescing flushed before any undo/redo/delete.
- **Event bus**: `selection:changed` (`size` payload); selection and
  marquee mutations mark the render loop dirty through the same bus.
- **StatusBar**: live selection count chip (accent styling, pointer icon,
  `role=status` + `aria-live=polite`, fade-out when empty, shortcut hint
  tooltip); undo/redo tooltips now carry their shortcuts.
- **Services**: `selection` and a single shared `idGenerator` (one
  monotonic id sequence for pen, duplication and every future creator).
- i18n: `status.selected`, `a11y.deleteSelection/duplicateSelection/
selectAll/clearSelection`, updated `empty.hint` (fa/en) mentioning the
  select/move/delete flow.

### Fixed

- **Marquee under-selection on fast release** (found via synthetic E2E):
  the rectangle was built from the last `pointermove` sample, so releasing
  far from it selected less than the user saw; `onPointerUp` now grows the
  rect to the release position before resolving.
- **Duplicate id collision** (found via E2E): the shortcut hook allocated
  copy ids from a private `IdGenerator("obj")` colliding with the pen's ids
  (`Scene.add` silently replaced originals); ids now come from the shared
  generator service.
- **Delete/duplicate iteration safety**: both loops snapshot
  `[...selection.ids]` before mutating (scene removal prunes the live set).

### Verified

- `bun run typecheck` ✓, `bun run lint` ✓, `bun run test` 211/211 ✓
  (76 new tests: Selection 24, SceneObject 13, MoveCommand 10, Coalescer 13,
  MarqueeLogic 16), `bun run test:coverage` 100% statements/branches/
  functions/lines on all 17 included core modules.
- agent-browser E2E on realistic streamed pointer sequences: draw (mouse +
  touch) → click-select → drag-move (geometrically verified: undo of the
  move restores the exact original position, proven by erasing at the old
  spot) → marquee (release-jump fix verified) → delete/undo → select-all →
  duplicate/undo → 3-key nudge burst undone by ONE Ctrl+Z → Escape clears;
  theme switch re-paints selection colours; zero console errors.
- VLM screenshot review (dark + light): dashed union box, 8 handles,
  per-object outlines, marquee tint, selection chip all confirmed, no
  visual glitches.

## [0.3.0] — Autonomous review round 2: The Living Canvas (2026-09-07)

The canvas comes alive: pan/zoom navigation, freehand drawing, erasing and
full undo/redo, driven by the first real render loop.

### Added

- **Camera navigation** (`core/camera/CameraController.ts`, real): intent
  API `panBy` / `panByScreen` / `zoomAt` (anchor-preserving "zoom to
  cursor", works under rotation) / `rotateBy` / `reset`, zoom clamped to
  10%–800%, NaN-safe; every mutation fires the `onChange` notifier.
  Inputs: plain wheel pans (shift → horizontal), `Ctrl/Cmd+wheel` zooms at
  the cursor (also covers trackpad pinch), hand-tool drag, hold-`Space`
  temporary hand tool, middle-mouse drag pan, `Ctrl+=/-/0` zoom keys
  (`ui/hooks/useCanvasShortcuts.ts`).
- **Scene model** (`core/model/Scene.ts`, real): live insertion-ordered
  object list, `add` (id-idempotent replace) / `remove` / `findById`,
  monotonic `revision` + `objectCount`, `nextZIndex()`, optional change
  notifier.
- **Command pattern + history**: new `AddObjectCommand` /
  `RemoveObjectCommand`, real `CompositeCommand` (ordered cascade,
  reverse-order undo); `HistoryManager` gained an `onChange` notifier.
  Every mutation flows through commands → `Ctrl+Z` / `Ctrl+Shift+Z` /
  `Ctrl+Y` and status-bar undo/redo buttons work end-to-end.
- **Render pipeline** (`rendering/`):
  - `Canvas2DRenderer` (real): DPR-aware frames (background fill → grid →
    culled objects → pen drafts), smoothed quadratic stroke paths, round
    caps, viewport culling via per-stroke bounds, theme palettes
    (`DARK_PALETTE` / `LIGHT_PALETTE`).
  - `GridRenderer` (real): zoom-adaptive two-scale dot grid (power-of-two
    spacing band 16–64px, exact integer cell indices) + world-origin
    crosshair painted in world space.
  - `RenderLoop` (new): single dirty-flag `requestAnimationFrame` loop —
    paints only when camera/scene/overlay/pointer events mark it dirty.
  - `StrokeOverlay` (new): transient pen drafts rendered above the scene
    until commit.
- **Tools** (`interaction/`, real): `HandTool` (drag-pan),
  `PenTool` (streams points into the overlay, sub-pixel filtering, tap =
  dot, commits via `AddObjectCommand`), `EraserTool` (model hit-testing via
  `distanceToSegment`, live removal, one composite history step per swipe).
- **CanvasSurface input bridge**: native pointer events → normalised
  `ToolPointerEvent`s (screen + world), pointer capture for drag
  continuity, pointercancel handling, non-passive wheel listener, per-tool
  CSS cursors, theme-reactive palette, empty state hides once objects
  exist. CSS dot grid/crosshair replaced by the camera-driven canvas grid.
- **Live StatusBar**: zoom chip (click = reset view), pointer world
  coordinates, object count, undo/redo icon buttons with disabled states —
  all Persian-digit localised (`ui/i18n/numbers.ts`).
- **Event bus payloads**: `camera:changed`, `scene:changed`,
  `history:changed`, `pointer:moved` (throttled ≥3px).
- **Pen stroke colour token**: strokes store `STROKE_COLOR_TOKEN`
  ("primary") resolved by the renderer against the active palette —
  readable in dark AND light theme.
- i18n: `status.objects`, `a11y.undo/redo/resetZoom/position`, updated
  `empty.hint` / `app.phase` / `status.zoom` (now a label) / version →
  ۰٫۳٫۰; fixed the `toolbar.label` typo (جعلهٔ → جعبه).
- 77 new unit tests (58 → 135 total); coverage scope widened to
  CameraController, Scene, HistoryManager and the three commands — 100%
  on all 12 included files (gates ≥90%).

### Fixed

- Strokes drawn in one theme kept that theme's literal colour and became
  nearly invisible after a theme switch → palette-token stroke colours
  resolved at render time.
- `zoomAt` with a non-finite factor could corrupt the camera → guarded.

### Verified

- `typecheck`, `lint`, `test` (135/135) and coverage thresholds pass.
- Browser E2E: pen draws and commits (live object count), ctrl+wheel zoom
  preserves the anchor under the cursor (numerically verified against the
  camera math), hand/space/middle-drag panning, zoom-chip reset, undo +
  redo (single step per eraser swipe), eraser removes strokes, language
  toggle (fa↔en, RTL↔LTR, Persian↔Latin digits), theme toggle with
  theme-adaptive strokes, mobile 420×800 (footer pinned, toolbar centered,
  drawing works), zero console/page errors; VLM screenshot reviews passed
  (dark + light).

## [0.2.0] — Autonomous review round 1: Core math + Toolbar (2026-09-07)

### Added

- **Floating Toolbar** (`ui/components/toolbar/Toolbar.tsx`, was a null stub):
  glassy bottom-center pill (backdrop-blur, entrance animation), 7 tool
  buttons (44px targets) wired to the UI store — active state with accent,
  ring, icon scale and indicator dot; shadcn tooltips with kbd letters;
  full a11y (`role="toolbar"`, `aria-pressed`, per-button Persian labels).
- **Keyboard shortcuts** (`ui/hooks/useToolShortcuts.ts`): V/H/P/E/T/S/C
  switch tools via layout-independent `event.code` (works on Persian
  keyboards); guards for editable targets and Ctrl/Meta/Alt modifiers.
- **Core math implemented** (fills Phase-0 frozen stub contracts, 100%
  coverage, additive-only API changes):
  - `geometry/Vec2.ts` — add/subtract/scale/length/distance + `ZERO`.
  - `geometry/BBox.ts` — `bbox()`, center, union, point containment.
  - `geometry/transforms.ts` — Canvas-order affine matrices: translation,
    rotation, scale, composition (`multiplyMat3`), `applyMat3`.
  - `geometry/hitTest.ts` — `pointInBBox`, `distanceToSegment` (clamped,
    degenerate-safe), `bboxIntersectsBBox` (edges inclusive).
  - `camera/Camera.ts` — documented invertible convention
    (anchor → screen origin; rotate around anchor; scale by zoom);
    `worldToScreen`/`screenToWorld` via the tested transform module;
    `worldOriginToScreen()` helper.
- **Styling deepening**: two-scale dot grid (24px + 120px), pure-CSS origin
  crosshair at canvas center, radial glow + gradient heading in the empty
  state, shortcuts kbd-chip row, status-bar backdrop blur.
- i18n keys: `empty.shortcuts`, `toolbar.label`, `toolbar.active` (fa + en).
- 37 new unit tests (16 → 53 total); vitest coverage scope widened to all
  six implemented core modules — all at 100% (gates ≥90%).

### Verified

- `typecheck`, `lint`, `test` (53/53) pass; coverage 100% on EventBus +
  geometry (4 modules) + Camera.
- Browser E2E: toolbar 7 buttons, live shortcut switching (KeyP → قلم,
  Ctrl+KeyP ignored), statusbar sync, RTL/LTR centering, mobile 420×800
  layout intact (footer pinned, toolbar visible), zero console/page errors;
  VLM screenshot review confirmed the visual design.

## [0.1.0] — Phase 0: Foundation & Empty Shell (2026-09-06)

### Added

- **Dual-shell architecture**: one `src/` tree served by two hosts —
  - Next.js preview shell (`src/app/page.tsx` → `<AppShell />`), and
  - Vite + Tauri 2 desktop shell (`index.html` → `src/main.tsx` → `<AppShell />`).
- **Full §1.4 skeleton**: every folder/file from the permanent project context
  exists with JSDoc'd stubs (core model/camera/selection/commands/history/
  geometry/spatial/id, rendering, interaction, text, ui panels/toolbar,
  persistence, platform) — 67 stub files, APIs frozen for later phases.
- **`core/events/EventBus.ts`**: fully typed generic pub/sub (`on`/`once`/`off`/
  `emit`/`clear`/`listenerCount`) with an `AppEventMap` (app:started,
  ui:language/theme/tool-changed) and Node.js-style snapshot dispatch
  semantics — 16 unit tests, 100% coverage (gate: ≥90%).
- **`AppContext.ts`**: typed service container (`ServiceKey<T>` branding,
  register/get/resolve/tryGet/has, single default instance).
- **`Logger.ts`**: leveled logger (debug/info/warn/error) with pluggable
  `ILogSink`s, child contexts, and level filtering.
- **`platform/tauri/log.ts` + Rust `append_log` command**: rotating log file
  (5 MiB × 3 backups) via Tauri IPC; console-only in the web preview.
- **`App.ts`**: composition root — boots services, bridges UI-store changes
  onto the typed EventBus. Idempotent, host-agnostic.
- **`ui/store/uiStore.ts`**: Zustand UI-only state (language, theme,
  activeTool) — no domain data.
- **`ui/i18n`**: `fa.ts` (default) + `en.ts` dictionaries (23 keys) with `t()`
  and `useTranslation()`; RTL/`lang` sync with the store.
- **`ui/theme/fonts.css`**: Vazirmatn 100–900 (9 woff2 weights, OFL 1.1
  license) bundled locally in `src/assets/fonts` — 100% offline, default UI
  font, Tahoma fallback.
- **Shell UI**: empty full-window DPR-aware `<canvas>` placeholder
  (dot-grid + vignette, no drawing), Persian RTL empty state, bottom
  StatusBar (active tool, zoom, ready/offline chip, language + theme
  toggles, version) — all strings from i18n, Persian digits in fa.
- **Tauri 2 scaffold**: `src-tauri/` with window 1400×900 (min 1024×768),
  title "Infinite Canvas Studio", dark theme, NSIS bundle target, generated
  placeholder icon set (ico/icns/png), `core:default` capability.
- **Toolchain**: strict tsconfig (`noImplicitAny`, `noUncheckedIndexedAccess`),
  ESLint flat config (react-hooks rules, `any` forbidden for project code),
  Prettier, Vitest with coverage gates; scripts: `dev`, `tauri:dev`,
  `tauri:build`, `typecheck`, `lint`, `test`, `format` (+ `test:watch`,
  `test:coverage`, `format:check`, `dev:web`, `build:web`).

### Verified

- `typecheck`, `lint`, `test` (16/16, 100% coverage) all pass.
- Vite desktop bundle builds (`build:web`) with all 9 font weights.
- Browser E2E: dark/RTL/Persian render in Vazirmatn, language toggle
  (fa↔en + rtl↔ltr), theme toggle (dark↔light), status bar pinned bottom,
  no console/page errors.

## [1.10.0] — Phase 3B: blocks, lists, links, paste pipeline, counts & Find & Replace (2026-09-12)

The rich text engine is COMPLETE (per the Phase 3B prompt): block-level
formatting, task lists, links with the Persian open-confirmation, the
sanitised paste pipeline, ZWNJ-aware word counts, the Persian-digits UI
setting and document-wide Find & Replace with camera flight.

### Added

- **Block formatting (R3B.1)**: heading dropdown (متن ساده / عنوان ۱–۳,
  H1–H3 only — StarterKit reconfigured to `levels: [1, 2, 3]`), blockquote,
  code block and horizontal-rule buttons in the floating bar + inspector.
  Central theme styles live in `globals.css` (Vazirmatn-inherited, tuned
  line-heights, first-block zero top margin so box geometry never drifts).
- **Lists (R3B.2)**: TaskList/TaskItem extensions (`nested: true`) with
  click-togglable checkboxes; bullet/ordered/task buttons; the `ListIndent`
  extension binds Tab / Shift+Tab to `sinkListItem`/`liftListItem`
  (bullet+task both). List CONTAINERS joined the Direction global
  attribute so RTL lists put markers/padding on the RIGHT.
- **Links (R3B.3)**: the Link extension (autolink, linkOnPaste, never
  auto-opened). **Ctrl+K** opens the link dialog (URL + editable label;
  selection → label prefill; caret-in-link → whole-run editing; insert
  mode at the caret). A floating link bubble (open/edit/remove) tracks the
  caret; opening ANY link first shows the Persian confirmation, then
  delegates to the OS default browser (`src/platform/tauri/opener.ts` →
  `tauri-plugin-opener` on desktop, `window.open` on web).
- **Paste pipeline (R3B.5)**: `sanitizePastedHTML` — a PURE, DOM-injected
  sanitiser (scripts/styles/handlers/classes/comments stripped; unsafe
  href schemes dropped; remote images removed with a visible Persian
  toast; Word fake-list paragraphs converted to real ul/ol; h4–h6
  downgraded; tables and data: images kept) + `planClipboardPaste` — the
  pure decision table (nested-table rejection stays R6.6; **Ctrl+Shift+V**
  pastes plain text; TSV → table). The editor's `handlePaste` is now a
  thin executor of the plan.
- **Word/character counts (R3B.6)**: CharacterCount extension configured
  with the ZWNJ-aware counters (`src/text/editor/wordCount.ts` — نیم‌فاصله
  is part of a word); the status bar shows a live "۱۲ کلمه · ۳۴ نویسه"
  chip while editing.
- **Persian digits setting (R3B.7)**: `uiStore.persianDigits` (default ON)
  + the settings popover in the status bar; every numeral in the status
  bar honours it instantly (`formatInteger/Zoom/Coords` accept a
  `{language, persianDigits}` locale; bare-language calls keep the
  pre-3B behaviour).
- **Find & Replace (R3B.8)**: Ctrl+F opens the floating panel (works from
  canvas AND inside the editor). Plain substring search over every text
  box + sticky note; next/prev flies the camera (the new
  `CameraController.flyTo` — 300 ms eased, cancelled by user camera
  input) and selects the exact match range inside the object's live
  editor (`FindSelection.resolveDocRange` maps logical offsets to PM
  positions). Replace = one undoable command; **Replace All = ONE
  `CompositeCommand` undo step** restoring everything. Sticky notes
  replace through `UpdateObjectCommand`; text boxes through
  `RichTextCommand` (doc + text + geometry snapshot).
- **Editor↔UI intent channel**: `TextEditorService.setIntentHandler` —
  in-editor Ctrl+K leaves the text layer through an injected handler and
  reaches React via the typed event bus (`ui:link-dialog-requested`,
  `ui:find-requested`, `ui:open-link-confirmation`); `ui:notice` gained
  optional `{name}` placeholder values (Replace All counts).
- **Tauri opener plugin** registered (`Cargo.toml`, `lib.rs`,
  `opener:default` capability) for the desktop link hand-off.

### Changed

- `enableInputRules: true` (R3B.4): all markdown shortcuts live — "# "→H1,
  "## "→H2, "### "→H3, "- "→bullet, "1. "→ordered, "> "→quote, "[] "→task,
  **bold**, *italic*, ~~strike~~, `code`.
- `DIRECTION_BLOCK_TYPES`/Direction extension now cover the three list
  container types + taskItem.
- `app.phase` label → «فاز ۳ب — بلوک‌ها، پیوندها و جستجو».

### Tests

75 new unit/integration tests (1083 total, all green): sanitiser (script
injection, handlers, styles, comments, remote images, Word lists, tables,
task attrs), paste decision table, ZWNJ counters, digits round-trip,
find/replace model (offsets across blocks, cross-node splices, marks
preservation), replace service (one undo step for Replace All across
boxes AND notes) and behavioural input-rule firing through the plugin's
real `handleTextInput` path.

## [1.10.1] — Phase 3B.5: the command-layer retrofit (2026-09-12)

A REFACTOR-ONLY phase (zero user-visible change): every user-invokable
action is now a registered command, identifiers follow the `core.*`
namespace, and hardcoded dispatch funnels through ONE dispatcher.

### Added

- **`src/core/registry/Registry.ts`** — the generic typed registry base
  (register/get/has/list/ids + `onRegistered` after-storage event,
  duplicate-id rejection). 100% unit-test coverage.
- **`src/core/registry/CommandRegistry.ts`** — commands are
  `{id, titleKey, icon?, shortcut?, group, order, execute(ctx),
  isEnabled?(ctx)}`; the `owner.name` scheme is validated, the reserved
  `core.` owner is enforced (§1.7.2), and SHORTCUT CONFLICTS throw at
  registration time (mirrored into the logger).
  `normaliseShortcut` unifies Mod≡Ctrl≡Cmd and `+`≡`-`.
- **`src/interaction/dispatch/CommandDispatcher.ts` + `keyboard.ts`** —
  the single execution funnel (`dispatch`/`dispatchShortcut`/
  `dispatchKeyboardEvent` with PHYSICAL-code mapping, Persian-layout
  safe) plus `commandsInGroup` (the ordered model registry-rendered
  surfaces consume). Unknown ids/shortcuts do nothing.
- **`src/interaction/dispatch/commands.ts`** — the whole core catalog
  (~45 commands): edit (undo/redo/save), view (zoom×4, grid), selection
  (12), tools (9), text (19), find. UI behaviours and editor actions
  arrive through a composition-root `CoreCommandWiring` — interaction/
  never imports ui/.
- **`src/ui/hooks/useCommands.ts`** — dispatcher resolution,
  `dispatchCommand` and `useCommandGroup` (re-renders on
  `onRegistered`): late-registered commands appear in
  registry-rendered surfaces with zero surface edits.
- **`docs/SEAMS.md`** — the living Phase 9/10 spec: every extension
  point (commands, events, tools, object model, rich-text schema, i18n,
  future panels) and what a plugin will hook into.
- **`DECISIONS.md`** — the R3B5.4 SEAMS AUDIT table (every
  dispatch-on-type site found → its replacement) plus the wiring/layering
  decisions and the justified exceptions.

### Changed (behaviour-identical)

- `useCanvasShortcuts` / `useToolShortcuts` keep their guards
  (editable suppression, Escape gesture priority, modifier checks) but
  EXECUTE through the dispatcher; `preventDefault` only when a command
  ran.
- `SelectionActions` renders FROM the `selection` command group and
  dispatches by id (the reference registry-rendered surface).
- `ProjectMenu`'s edit twins and `StatusBar`'s undo/redo dispatch the
  same commands as the keyboard (one funnel, one undo semantics).
- `Canvas2DRenderer`'s per-kind draw if-chain became the
  `canvasDrawers` lookup table (unified signatures, per-entry guards).

### Tests

33 new tests (1116 total, all green): the registry base, the command
registry (scheme/owner/conflicts), the dispatcher (dispatch/shortcut/
keyboard/dummy-seam), the catalog (conflict-free registration, real
scene/history execution parity, EVERY pre-refactor shortcut bound to its
command) — coverage gates still pass (Registry 100%, CommandRegistry
95.8% statements / 92.9% branches).

## [1.11.0] — Phase 4: persistence, recovery, recent files & PNG export (2026-09-12)

The app becomes a real document tool: a plugin-ready persistence layer
(the ObjectRegistry + the v2 `.icb` envelope with the strict
`plugins` passthrough), file commands (Ctrl+N/O/S/Shift+Ctrl+S) with the
title-bar name + dirty marker and the unsaved-changes guard, crash
recovery («بازیابی آخرین تغییرات؟»), the recent-files list, and a REAL
PNG exporter (2x, transparent background, embedded Vazirmatn — verified
live). NOTHING IS EVER LOST: unknown object types open as
«شیء ناشناخته» placeholders that round-trip verbatim.

### Added — the registry + the format (R4.1/R4.2/R4.3/R4.4)

- **`core/registry/ObjectRegistry.ts`** — the ONLY object
  (de)serialization dispatch (§1.7.1): entries carry the namespaced wire
  `typeId` (§1.7.2), the in-memory `kind`, a factory, per-type
  `version` + migration chains (R4.4b), introspectable metadata and
  optional Insert-Panel catalog fields (§1.7.7). Dual typeId/kind
  indexes, duplicate rejection, reserved-owner enforcement, owner
  attribution (§1.7.5).
- **`persistence/objectTypes.ts`** — the seven first-party kinds + the
  opaque entry registered under `core.*` ids; TipTap docs ride inside
  the text objects' payloads; every `deserialize` is field-validated
  (a corrupt object refuses → placeholder, never a crash).
- **File format v2** — `{ schemaVersion, meta: { magic, savedAt },
  camera, scene: { objects }, plugins }`; `plugins` is ALWAYS written
  and never interpreted (§1.7.4). The registered `MigrationV1toV2`
  rewrites v1 files on load (kinds → namespaced typeIds; unknown kinds
  preserved verbatim for the opaque path). Unknown FUTURE global
  versions → Persian error + read-only open (R4.4a); the recovery
  dialog, the read-only notice and `core.file.*` block re-saves.
- **`OpaqueObject` wiring completed** — unknown typeIds render as the
  dashed «شیء ناشناخته» placeholder (locked, selectable), serialize
  back VERBATIM (canvas renderer + layers panel from the prior segment,
  now load-driven end-to-end).

### Added — the document lifecycle (R4.5/R4.6/R4.7)

- **`core.file.*` commands** — New (Ctrl+N), Open (Ctrl+O), Save
  (Ctrl+S: known path re-save / Save-As flow), Save As
  (Ctrl+Shift+S) + `core.export.png`; all unsaved-guarded through the
  shared Persian confirm dialog.
- **`DocumentService`** — path/name/dirty/readOnly state + the plugins
  passthrough holder + the persisted last-disk-save baseline;
  `project:document-changed` drives the new title-bar chip
  («نام فایل *») and the `document.title` sync.
- **`DocumentCloseGuard`** — desktop: `onCloseRequested` → Persian
  dialog → save/discard/cancel (new `core:window:allow-destroy`
  capability); web: `beforeunload`.
- **AutosaveService rework** — 30 s interval; the desktop slot moves to
  the app-data `autosave.icb` (`TauriAppDataStorage`, localStorage
  fallback); boot recovery is a DIALOG when the slot is newer than the
  last disk save (a save also refreshes the slot, so quiet boots follow
  saves); the restored document is deliberately dirty until saved.
- **`RecentFilesService`** — the last ten projects in the File menu
  (path + name), validated per shell (missing files gray out with
  «فایل پیدا نشد»), one click re-opens.
- **Rust**: `save_binary_file` (base64 → bytes, PNG export channel) +
  `delete_text_file` (slot clear), std-only.

### Added — PNG export (R4.8)

- **`DomRasterizer`** — SVG-`<foreignObject>` rasterization with
  Vazirmatn 400/600/700/800 embedded as base64 `@font-face` (collected
  from the live stylesheets); typed errors on font/rasterization
  failure (never silent drops).
- **`PngExporter`** — region (board/selection/bbox) + 1x/2x +
  transparent-background options; composites the REAL
  `Canvas2DRenderer` (offscreen, virtual camera, images preloaded)
  with the mirrored DOM text layer (`transform-origin: 0 0` +
  translate/rotate/scale — the exact live composition, verified
  empirically); the prose CSS is inlined with literal colours.
- **`ExportPngDialog`** — region/scale/background choosers with a live
  pixel-size preview; browser download (web) / native Save dialog +
  `save_binary_file` (desktop). Opened via `core.export.png`.

### Changed

- `VersionedSerializer.deserialize` now returns a typed outcome
  (`ok` + `savedAt` / `future` + `fileVersion` / `corrupt`) — the
  recovery comparison and the read-only flow hang off it.
- `ProjectFile.validateProjectData` became the structural envelope gate
  (per-object validation lives in the registry with placeholder
  fallbacks — one corrupt object no longer refuses the whole file).
- The server bridge's `.icb` magic check accepts both v1 and v2
  envelopes; `serializeProjectFile`/save dispatchers thread the plugins
  passthrough; every save path refreshes the document state and the
  recent list.
- `app.phase` → «فاز ۴ — ذخیره‌سازی، بازیابی و خروجی»; ~45 new i18n
  keys (fa + en); lint debt from the prior segment cleared (18
  pre-existing problems fixed).

### Tests

- 120 new tests (1236 total): ObjectRegistry (18), objectTypes (30),
  ProjectFile registry round-trips + AC4.2/AC4.3 proofs (31),
  VersionedSerializer v2/migration/future/plugins/AC4.3 fixture (24),
  MigrationV1toV2 (10), DocumentService (14), RecentFilesService (10),
  pathNames (7), TauriAppDataStorage (3), PngExporter pure surfaces +
  error paths (20) + the updated suites (AutosaveService 30 s,
  runMigrations chain, SaveToDisk v2, commands file catalog).
- Gates: tsc ✓ eslint ✓ prettier ✓ vitest 1236/1236 ✓; the coverage
  gate now includes ObjectRegistry/objectTypes/MigrationV1toV2/
  DocumentService/RecentFilesService/pathNames (persistence 96.6 %,
  ObjectRegistry 95.5 % — AC4.8 ≥ 80 % exceeded; the browser-only
  rasterizer halves are verified live, see DECISIONS D-4.8).

### Verified (live, agent-browser E2E)

- Round-trip through the local bridge: a v2 fixture (shape + rich-text
  textBox + UNKNOWN `vendor.spacer` object + `plugins` block) saves and
  loads with BOTH the unknown object and the plugins block surviving
  semantically unchanged (AC4.1/AC4.3).
- Recovery: sticky note «سلام فاز ۴» → reload → «بازیابی آخرین
  تغییرات؟» (۱ شیء) → restore → the exact state back; «شروع تازه»
  clears; a boot after a real save stays quiet (AC4.4).
- PNG export at 2x: 536×536 with the sticky at the exact world offset,
  embedded-font Persian text ink on the card, dark-theme background;
  the transparent option yields alpha 0 corners (AC4.7).
- File commands: Ctrl+S pathless → Save-As dialog → typed bridge path
  → saved (title «فایل» clean, no *); Ctrl+N dirty → Persian guard →
  discard → fresh. Recent files: entry renders, click re-opens, a
  missing file grays out + disabled (AC4.5/R4.7).

## [1.12.0] — Phase 5 complete: labels, highlighter, Insert-Image, broken-asset placeholders & snap-to-grid (2026-09-12)

The whiteboard superpowers phase is now fully aligned with the R5.1–R5.6
spec. The four Phase-5 object kinds were already registry customers since
Phase 4 — this round completes the MISSING fine-grained features and
keeps the §1.7 discipline: every new field shipped inside its type's own
registry entry / model file, with zero edits to ProjectFile or dispatch
code.

### Added

- **Connector midpoint labels (R5.3/AC5.3)**: `ConnectorObjectData.label`
  (optional, byte-compatible) rendered as a canvas chip riding the path's
  arc-length midpoint (pure `pathMidpoint` + live `connectorLabelAnchor` —
  glued endpoints drag the label with them); fixed 11px screen font with
  140px ellipsize keeps labels readable at any zoom. Double-clicking a
  connector emits `ui:connector-label-requested` → the new
  `ConnectorLabelEditor` (a bare RTL `<input>` on the midpoint, per the
  "plain input, not TipTap" rule): Enter/blur commits ONE
  `UpdateObjectCommand` (undoable), Escape cancels, empty clears.
- **Pen marker mode + user-adjustable ink (R5.4/AC5.4)**: optional
  `highlighter` flag on freehand strokes painted with 0.45 alpha,
  multiply blend and butt caps; text stays readable by construction (the
  DOM text layer sits above the canvas). The pen toolbar button gained a
  full picker popover — mode (قلم/هایلایتر), width presets (۲/۴/۸/۱۶) and
  the shared ink swatches — all stored in the UI store and resolved at
  stroke start (drafts preview through the same renderer).
- **Insert Image dialog (R5.2)**: File→«درج تصویر…» → `core.insert.image`
  (registered command) → drop-zone dialog feeding the SAME decode pipeline
  as paste/drop (byte-identical pass-through ≤1600px, proportional
  downscale beyond) through the extracted `insertDecodedImage` — one
  image = one undo step, snapped placement, Persian toast.
- **Broken-asset placeholders (R5.2/AC5.2)**: a definitively failed image
  decode now paints a dashed accent frame with «تصویر در دسترس نیست»
  (palette-carried i18n, both shells + PNG export) instead of vanishing;
  still-loading images stay silent (async onload repaints).
- **Snap-to-grid (R5.5/AC5.5)**: the SnapEngine is real — grid crossings
  ranked by distance (`computeSnapCandidates`), plus pure
  `snapPointToGrid`/`snapBoxDisplacement` (min/center/max edge proposals,
  closest wins)/`snapResizeRect` (dragged edges only, min-size re-clamp)/
  `snapRectOrigin` helpers. Wired into move (selection union bounds),
  resize (unrotated frames), every creation tool (text/sticky/table/
  shape tap+drag, connector floating endpoints, image placement) and the
  StatusBar: a magnet toggle (active = accent) + spacing presets
  (۱۰/۲۰/۴۰/۸۰) in the settings popover. Default ON, spacing 20.
- **Aspect lock by default for images (AC5.2)**: images keep their ratio
  WITHOUT Shift; Shift unlocks (the generic contract inverted, Figma-style).
- **Smoothing extracted as pure geometry (AC5.8)**: the midpoint-quadratic
  stroke smoothing moved from the renderer's canvas-coupled `tracePath`
  into node-testable `smoothedStrokePath` (src/core/geometry/
  strokeSmoothing.ts); the renderer now consumes it verbatim —
  behaviour-identical, testable.
- ~30 new fa/en i18n keys; `app.phase` → «فاز ۵ — استیکی، تصویر، اتصال
  و قلم».

### Changed

- **Visible grid base 24 → 20** (DECISIONS D-5.4): the snap default (20)
  and every adaptive zoom level (20·2ⁿ) now align — snapped edges land on
  the visible dots at every zoom.
- The move gesture computes snapped DESIRED displacement per frame and
  applies only the delta to the coalescer (D-5.6): one snapped drag is
  still ONE undo entry; Shift axis-lock and rotated-frame resizes skip
  snapping (D-5.5).

### Tests

- 46 new tests (1282 total): SnapEngine (23 — candidates/ranking/config,
  box displacement proposals, resize-edge snapping with min-size clamps,
  rect origin), pure stroke smoothing (5), connector label geometry +
  live anchor follow + double-click intent (10), registry round-trips for
  the new optional fields incl. pre-Phase-5 byte-compatibility (8),
  SelectTool drag snapping incl. off/Shift/undo-entry contracts (5) —
  plus the full 1236-test regression re-run.
- Gates: tsc ✓ eslint ✓ prettier ✓ vitest 1282/1282 ✓; live boot
  verified (fa/rtl, فاز ۵ label, fs bridge API alive).

## [1.13.0] — Phase 6 complete: ContextMenuRegistry, vertical alignment & column distribution (2026-09-12)

The tables phase is now fully aligned with the R6.1–R6.8 spec. The
pre-existing table engine (grid picker + table tool, 6 style presets,
zeebra, per-cell backgrounds, drag-resize with `colwidth` persistence,
RTL direction + inheritance, Excel/Word paste with nested-table
rejection, auto-sizing boxes, one-undo-step structural edits) gains the
three audited gaps: the generic **ContextMenuRegistry** with the ENTIRE
table menu as registered contributions, **per-cell vertical alignment**
(top/middle/bottom, per cell AND per selection) and the **uniform
column-distribution** command — plus `core.table.insert` as a registered
command and the direction-aware insert-column-left/right semantics.

### Added

- **`src/core/registry/ContextMenuRegistry.ts` (R6.2)**: context-menu
  items are REGISTERED CONTRIBUTIONS `{target, item, order}` — target =
  `{region: "canvas"|"table"|"text"}` optionally narrowed by
  `objectType` (a concrete kind or the `"*"` any-object wildcard);
  item = a leaf `{kind:"command", commandId}` (label/disabled state
  resolve from the CommandRegistry), a separator, or a `{kind:"submenu",
  build}` whose builder runs at menu-build time. `buildMenu(target)`
  merges matching contributions with stable ordering (order asc,
  registration tiebreak) and collapses doubled/leading/trailing
  separators; empty submenus drop. The AC6.7 seam: registering a dummy
  item makes it appear WITHOUT touching menu-building code.
- **`src/ui/contextMenu/contributions.ts`**: the app's contributions —
  the ENTIRE table context menu (rows/columns submenus with
  direction-aware left/right, merge, split h+v, headers, direction,
  vertical-alignment submenu, distribute, presets submenu, delete), the
  canvas menu (select all, insert table/image, fit/reset/grid), the
  object menu (`objectType: "*"` — duplicate/delete/group/ungroup/lock/
  z-order) with per-kind edit-text entries for text boxes and sticky
  notes, and the text region menu (bold/italic/underline/strike, link,
  find).
- **`src/ui/components/ContextMenuHost.tsx`**: renders the merged menu
  at the right-click anchor — RTL, viewport-clamped, outside-click and
  Escape closable, submenus expand in place, disabled states from
  `isEnabled`, dispatch through the shared CommandDispatcher; icons are
  host-mapped per command id (the registry stays icon-free).
- **Right-click plumbing (R6.2)**: the canvas resolves the target by
  hit-testing (right-clicking an unselected object selects it first,
  Figma-style) and emits `ui:context-menu-requested`; the rich-text
  editor's `handleDOMEvents.contextmenu` resolves its region (`"table"`
  when the caret sits in a table cell, else `"text"`) and forwards it
  through the intent handler → the same bus event → the UI store slice
  → the host. The browser's native menu never appears.
- **Per-cell vertical alignment (R6.4)**: a `valign` attribute on cells
  and header cells (top/middle/bottom as `vertical-align` inline style,
  round-tripping through JSON and the static HTML render) +
  `setCellVerticalAlign`/`currentCellVerticalAlign`/`selectedCellPositions`
  (CellSelection iterates through the library's own `forEachCell`) —
  settable per caret cell AND per multi-cell selection. Toolbar: a
  vertical-alignment dropdown in the floating table bar; context menu:
  the alignment submenu.
- **Axis-aware cell splitting (R6.2 "split cell h + v")**:
  `splitCellAlongAxis(host, "row"|"column")` — the horizontal split
  keeps the colspan and gives every spanned row its own cell; the
  vertical split keeps the rowspan and carves the colwidth per column.
  Modelled on the stock `splitCellWithType` algorithm (positionAt
  resolution, insert mapping, CellSelection restore) so behaviour
  matches the library. Offered as «تفکیک افقی/عمودی» in the toolbar's
  split dropdown and the context menu.
- **Uniform column distribution (R6.3)**: the pure planner
  `planColumnDistribution` (equal shares, minimum clamp, exact-sum
  remainder) + `distributeTableColumns` (gathers per-column widths from
  every cell's `colwidth` — the same channel the drag-resize plugin
  uses — writes the equal share back onto every cell incl. span slices;
  auto-layout tables without a measurable fallback bail cleanly).
  Toolbar button + `core.table.distributeColumns` command.
- **Direction-aware visual column inserts (R6.2)**:
  `core.table.insertColumnLeft/Right` carry VISUAL semantics —
  `logicalInsertForSide` resolves the table's direction (RTL renders
  column 1 rightmost, so "left" = logical AFTER) and executes the
  matching TipTap command. Labels and actions both direction-aware.
- **The table command family (AC6.7)**: 24 new registered commands —
  `core.table.insert` (R6.1: inserts into the live editor, or with
  nothing being edited creates a fresh table text object at the viewport
  centre through the `table:create-requested` flow), all structural
  row/column operations, merge, split h+v, header toggles, direction,
  distribute, the three alignments and the six style presets. The
  catalog's `table` wiring (`runTableAction`/`canTableAction`) executes
  against the live shared editor; `insert` is always available, the rest
  probe `editor.can()`/span checks gated on a live editing session.
- ~14 new fa/en i18n keys (column sides, split h/v, distribute,
  alignment, context-menu labels); `app.phase` → «فاز ۶ — جدول‌ها و منوی
  زمینه».

### Changed

- `selectedCellPositions` (the per-cell styling base) now iterates
  CellSelections through `forEachCell` — the previous `nodesBetween`
  range missed the selection's head cell.
- The floating table toolbar's split button became a dropdown (stock
  full split + horizontal + vertical) and gained the alignment dropdown
  and the distribute button; the direction toggle, presets, cell
  background and header menus are unchanged.
- `CommandGroup` gained `"table"`; the command registry lists the table
  family in `commandsInGroup("table")` (palette-ready for Phase 7).

### Tests

- 36 new tests (1318 total): ContextMenuRegistry (13 — region/objectType
  matching incl. the `"*"` wildcard, stable ordering, separator
  collapsing, submenu builders + empty-drop, duplicate-id rejection, the
  AC6.7 dummy-contribution seam + onRegistered re-render, the app's
  contribution completeness), table command catalog (4 — every command
  exists/dispatches/executes through the wiring, disabled refusal,
  visual column ids), live editor table commands (19 — valign
  caret/CellSelection/round-trip/static-HTML/undo, split h+v/undo/1×1
  refusal, the distribution planner + doc writes + span carving + auto
  bail + null gathering, direction logic + RTL render + goToNextCell
  navigation) — plus the full 1282-test regression re-run.
- Gates: tsc ✓ eslint ✓ prettier ✓ vitest 1318/1318 ✓.
