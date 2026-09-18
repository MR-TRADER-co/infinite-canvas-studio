# DECISIONS

Architecture decisions and their rationale, newest first. Entries
`#1–#20` were recorded before the Phase 3B.5 retrofit (summarised in the
repository history); the numbered entries below continue from there.

---

## #61 — فاز P1 «سند روی بوم»: the PDF rides the media rails — poster-only canvas, hash sidecar, schema v6 (2026-09-18)

The PDF extension's binding PART A contract, phase P1. The core
decision chain (each mirrors the audio/video precedent — the extension
was designed to add zero new architecture):

1. **Poster-only canvas (A.1/A.3).** A PDF NEVER renders live on the
   infinite canvas — the object is a captured page bitmap + badges,
   drawn on the EXACT `drawVideo` affine path. The thumbnail state
   holds no `<canvas>`/`<iframe>` per PDF; the only rendering cost is
   one decoded bitmap through the shared PosterBitmapCache.
2. **Hash sidecar, hashes-only payload (A.2.1).** The `.icb` carries
   `assetHash` + `thumbHash` + page metadata; the bytes live in the
   M1 sidecar AssetStore, content-addressed (identical imports
   dedupe, ACP1.4), the inbox→sidecar relocation rides the SAME
   manifest (`collectPdfAssetHashes` joined to the video/audio list).
3. **pdf.js bundling (A.2.5).** `pdfjs-dist@6` — the worker
   (`pdf.worker.min.mjs`), the cmaps (Persian CID fonts) and the
   standard fonts are copied VERBATIM into `public/pdfjs/` (the
   `public/ffmpeg/` precedent) and served same-origin: 100% offline,
   Tauri's asset protocol compatible, never a CDN byte. The main
   library lazy-imports on the first poster render.
4. **Signature gate before objects (A.2.4).** The `%PDF-` magic is
   verified (first KiB) INSIDE the funnel — an invalid file toasts in
   Persian and creates nothing (Appendix P-1's matrix); no conversion
   path exists (pdf.js reads valid PDFs natively).
5. **Page posters as assets (A.2.2).** Each rendered page poster
   (max 1000px, JPEG q0.8) is WRITTEN into the store and hashed into
   the object's `thumbHash`; `PdfPageCache` (asset,page)→hash LRU
   keeps flip-backs render-free while eviction only drops the map
   entry (the store still holds every poster).
6. **Schema v6 (§1.7.4).** The additive V5→V6 step normalises
   `core.pdf` payloads (thumbHash coalesce, currentPage clamp);
   foreign types pass through verbatim, the unknown-type law intact.
7. **The wheel page-flip (A.2.7).** A plain wheel over the object
   flips `currentPage` (debounced 300ms) through the SAME
   UpdateObjectCommand seam (one undo step per pause); modifier
   wheels keep zoom/pan exactly as before.

## #62 — فاز P2 «نمایشگر سند»: the floating PDF viewer — one window, DOM text layer, three-player hand-off (2026-09-18)

1. **Screen-space, one window (A.2.3).** The viewer is a portal above
   every panel with NO scrim — the canvas stays interactive while
   reading. ONE instance across ALL THREE floating players: the store
   holds `playerPdfId` beside the video/audio ids and every `open`
   clears the other two (the A2 one-line hand-off, extended).
2. **pdf.js DOM rendering (RP2.3).** The current page renders as a
   canvas layer (fit-width × internal zoom, device-pixel capped) +
   pdf.js's `TextLayer` overlay — transparent positioned spans, so
   mouse highlight selection and Ctrl+C copying are the BROWSER's
   native behaviour (no custom selection engine to break on Persian
   bidi). The pdf.js text-layer CSS core is inlined in globals.css
   (Apache-2.0, noted) to avoid importing the whole viewer
   stylesheet. Image-only scans select nothing, silently (fixture b).
3. **Worker/size rationale (A.2.5/RP2.1).** Default 800×600/min
   400×500 (a document wants width; the video window's 640×400 is
   tuned for 16:9 film), position/size/internal-zoom persisted in the
   dedicated `pdf-viewer/v1` localStorage slot — never the project
   file.
4. **Memory discipline (RP2.4/ACP2.4).** Only the current page holds
   DOM; a page turn clears the previous text layer BEFORE the next
   renders; closing destroys the canvas + text layer and revokes
   nothing (no blob URLs — the bytes stream through the shared doc
   LRU, whose evictions destroy the worker documents). Idle CPU after
   close: 0.

## #57 — فاز M1 «رسانهٔ زنده»: the sidecar AssetStore keeps videos OUT of the .icb (2026-09-16)

The binding PART A contract mandates `<projectPath>.assets/` sidecars with
hash-named files, a media inbox for unsaved projects, relocation on the
first Save As, and KB-scale project files. In the WEB shell there is no
Tauri fs — so the sidecar lives on the SERVER filesystem the
LocalFsBridge already trusts (`/api/assets/*` routes guarded exactly like
`/api/fs/*`: absolute, inside the bridge roots, `.icb`-adjacent), while
the client store speaks the same pure path algebra
(`persistence/assetPaths.ts` is shared verbatim by both halves). The
desktop shell later swaps in an fs-backed twin behind the same
`Services.assetStore` key.

- **Content addressing**: every asset file is named by its SHA-256
  (client Web-Crypto computes, server node:crypto VERIFIES — a mismatch
  is refused). Reads resolve through the chain [project sidecar, inbox]:
  any copy with the same hash is valid, which is exactly what makes the
  inbox-fallback (autosave restore) and the copy-on-later-Save-As
  semantics safe.
- **Relocation semantics** (A.2.1): the first Save As MOVES inbox files
  into the sidecar (they belonged to no project); a later Save As to a
  new path COPIES (the old project keeps resolving); both hooks live at
  the two shared completion points — `performDiskSave` and the save
  dialog's `noteSaved` — so no save route can bypass them.
- **The renderer seam**: `media/AssetUrlResolver.ts` is a tiny
  settable delegate (hash → URL) because importing the composition root
  from `rendering/` would cycle (App → CanvasSurface → renderer). Until
  boot — and in unit tests — the resolver is null and posters render as
  the dashed placeholder, identical to a missing asset.
- **PosterBitmapCache is a module singleton shared by ALL renderers**
  (the live canvas + every exporter instance): the decode-once contract
  (A.2.2/ACM1.10) is process-wide, and the decode counter is the test
  hook that pins it. The browser HTTP cache backs the immutable
  content-hashed read URLs (zoom/pan never re-fetch).
- **Intrinsic dims named `naturalWidth/Height`** (not the spec's bare
  `width/height`): the ImageObject naming is the codebase's established
  contract for "intrinsic vs placed", and A.2.7/A.2.10 defer every
  behaviour to ImageObject — the generic sized-object geometry
  (bbox/resize/rotate/group) then applies to videos for free.
- **The duration badge reads LTR at the bottom-right corner** (the
  YouTube/Aparat convention — media chrome is never mirrored, A.2.8)
  while its DIGITS follow the app's Persian-digits setting through the
  palette-injected formatter (the `guideNumberFormat` pattern — the
  renderer stays framework-free).
- **M1's import gate**: the five native extensions enter; video-typed
  foreign extensions (.avi/.flv/.mkv) are REFUSED with the Persian
  toast — M2's `FormatProbe` + ffmpeg.wasm convert dialog owns them
  (RM2.5). Known-but-unplayable containers imported through M1's gate
  (none of the five) keep the film-icon fallback poster.
- **Sandbox dev-server note**: Turbopack served a stale
  `numbers.ts` module after in-place edits (an "export not found" ghost
  that survived HMR reloads); the reliable recovery is `rm -rf .next`
  + a clean restart. The detached dev server needs
  `setsid --fork` to survive the tool's command boundary.

## #21 — Phase 3B rich text completion (2026-09-12)

- **CharacterCount via custom counters**: the extension is configured
  with `wordCounter`/`textCounter` functions from
  `src/text/editor/wordCount.ts` instead of the defaults, pinning the
  ZWNJ-is-part-of-a-word contract (AC3B.6) in one tested module.
- **Paste pipeline split**: the decision table
  (`planClipboardPaste`, pure) and the sanitiser (`sanitizePastedHTML`,
  pure with an injected DOM parser) are separate from the editor's thin
  `handlePaste` executor — the whole pipeline is node-testable without
  clipboard events; the Chromium-only `shiftKey` on `ClipboardEvent` is
  read defensively (anything else counts as unmodified).
- **Find & Replace executes through the model commands**: single
  Replace lands ONE `RichTextCommand`/`UpdateObjectCommand`; Replace All
  bundles per-object commands into ONE `CompositeCommand` (AC3B.8). An
  open edit session is committed FIRST (`commitEditing`), so
  replacements always operate on persisted documents and never fight
  TipTap's internal history.
- **Link opening is confirmed, then delegated**: `openExternalLink`
  tries `plugin:opener|open_url` (Tauri) and falls back to
  `window.open` — the app itself still performs zero network calls.
  `tauri-plugin-opener` was added to the Rust shell for the desktop
  build.
- **In-editor Ctrl+K leaves through an injected intent handler** (never
  a ui import from the text layer); Ctrl+F is handled at the shell's
  window level only (keyboard events bubble out of the editor), keeping
  a single dispatch path per intent.

## #22 — Command layer retrofit (Phase 3B.5, 2026-09-12)

- **`Registry<T>` is the one base** for every future seam (commands now;
  panels, inspector sections, object kinds later). Duplicate ids throw
  at registration; `onRegistered` fires after storage so late
  subscribers re-reading `list()` always see the new entry.
- **`core.` owner is enforced at registration** (§1.7.2): third-party
  owners are rejected until Phase 9's plugin runtime owns a namespace.
  Ids allow hierarchical names (`core.text.bold` — the spec's own
  examples are hierarchical).
- **Shortcut conflicts throw at registration time** and mirror into the
  logger; `normaliseShortcut` unifies Mod≡Ctrl≡Cmd and `+`≡`-`, so the
  same string compares equal everywhere.
- **Wiring over imports**: the catalog
  (`interaction/dispatch/commands.ts`) receives service keys and
  UI-bound closures through `CoreCommandWiring` (built in `App.ts`) —
  interaction/ never imports ui/, and the catalog is node-testable with
  stub wirings. Service contracts for autosave/text layer are
  STRUCTURAL (covariance makes the real keys assignable).
- **Keyboard hosts keep their guards, the dispatcher owns execution**:
  `useCanvasShortcuts`/`useToolShortcuts` decide WHEN a keypress may
  dispatch (editable-target suppression, gesture priority, modifier
  guards); `dispatchKeyboardEvent` decides WHAT runs. `preventDefault`
  only happens when a command actually ran — unregistered shortcuts do
  nothing (AC3B5.3).

### Seams audit (R3B5.4) — every dispatch-on-type site found and its replacement

| Site | Before | After / status |
| --- | --- | --- |
| `Canvas2DRenderer.render` | if-chain on object kind (`isFreehandObject → drawFreehand` …) | `canvasDrawers` lookup table (unified signatures, per-entry type guards) |
| `useCanvasShortcuts` | 40-line switch on `event.code` re-implementing actions | guards + single `dispatcher.dispatchKeyboardEvent` (actions live in `core.*` commands) |
| `useToolShortcuts` | map of code→tool + direct store call | dispatches the `core.tools.*` commands (plain-key shortcuts) |
| `SelectionActions` | hardcoded button list calling `SelectionOps` directly | renders FROM the `selection` command group; clicks dispatch by id |
| `ProjectMenu` edit helpers | duplicate `SelectionOps` calls (menu twins) | dispatch the same `core.selection.*` commands |
| `StatusBar` undo/redo | direct `history.undo()` callbacks | dispatch `core.edit.undo/redo` |
| `TipTapFactory.handlePaste` | inline table/nested checks | `planClipboardPaste` tagged union (sum-type action, registry-style) |
| `Canvas2DRenderer.drawShape`'s `switch (shapeKind)` | kept | geometry math within ONE object's primitive kind — data-driven, not object-type dispatch |
| `InspectorPanel`'s `kind ===` chains | kept (documented) | replaced by Phase 7's `InspectorSectionRegistry` (the phase that introduces per-type section contributions) |
| `hooks/use-toast.ts` reducer | kept (documented) | unused shadcn scaffold file, no consumer — dead code to be pruned with the scaffold cleanup |

### Migration discipline notes

- Zero behaviour change verified by the full Phase 3B checklist re-run:
  1116 tests green (1083 pre-refactor + the 3B.5 layer's own 33), the
  typecheck clean, and the app boots with the same interactions.
- `SelectionActions` is the reference implementation for
  registry-rendered surfaces (AC3B5.2): a dummy command registered in
  the `selection` group appears with zero component edits
  (`tests/interaction/commands.test.ts` proves the model;
  `useCommandGroup` re-renders on `onRegistered`).

---

## Phase 4 — Persistence: Save/Load, Autosave, Export PNG (+ object registry)

### D-4.1 — The v2 file envelope and the namespaced wire `typeId`

`PROJECT_FILE_VERSION` moves 1 → 2. The envelope becomes
`{ schemaVersion, meta: { magic, savedAt }, camera, scene: { objects }, plugins }`
(exactly R4.2); every object payload carries `typeId` (the registry id,
`core.shape` style per §1.7.2) + `typeVersion` instead of the in-memory
`kind`. The registered `MigrationV1toV2` step rewrites old files on load
(known kinds → `core.*` typeIds; unknown kinds keep their value verbatim
so they load as opaque placeholders — §1.7.4). The global migration chain
now runs over the WHOLE root (the v1→v2 step restructures the envelope),
not just the scene half.

### D-4.2 — Corrupt objects degrade to placeholders, corrupt envelopes are refused

Per R4.3 the load path is two-tier: the ENVELOPE must be structurally
sound (camera numeric + objects an array — else the whole file is
"corrupt" and refused); individual OBJECTS are validated through their
registry entry's `deserialize`, and a refusal (unregistered typeId,
broken per-type migration chain, malformed fields) materialises an
`OpaqueObject` placeholder retaining the raw JSON verbatim. One corrupt
object never kills the file, and nothing is ever dropped.

### D-4.3 — Future-version files open read-only (lenient parse, no migrations)

A `schemaVersion` above the current one yields the `future` outcome: the
serializer parses best-effort WITHOUT migrations (registry/opaque
objects), the root emits the Persian error
(`file.futureVersion`) and opens the document read-only
(`DocumentService.setReadOnly(true)`): autosave keeps running into the
recovery slot, but `core.file.save`/`saveAs` and the close-guard's save
refuse (`file.readOnlyBlocked`) so a re-save can never destroy
future-format data. Per-OBJECT future `typeVersion`s refuse the same way
(the object becomes a placeholder).

### D-4.4 — Recovery is a DIALOG now (behaviour change from pre-Phase-4)

Boot no longer silently restores the autosave slot: when the slot is
newer than the persisted last-disk-save timestamp
(`infinite-canvas-studio/last-disk-save/v1`), the Persian
«بازیابی آخرین تغییرات؟» dialog offers the restore; «شروع تازه» clears
the slot. Every successful disk save ALSO refreshes the slot
(`performDiskSave` → `autosave.saveNow("flush")`), so a boot right after
a save (slot == disk) stays quiet — the dialog only appears when real
unsaved-to-disk work exists. The slot itself moved to the app-data
`autosave.icb` on the desktop shell (`TauriAppDataStorage`, falling back
to localStorage when the app-data path or IPC is unavailable); the web
shell keeps localStorage. The 30 s interval (R4.6) replaced the 2 s
one; the visibilitychange/beforeunload flush stays as the crash net.

A restored document is deliberately DIRTY: the recovered state exists
only in the slot, so the title-bar «*» and the close guard protect it
until the user saves to disk.

### D-4.5 — The Ctrl+S family are FILE commands now

`core.edit.save` (autosave-slot save) is replaced by the `core.file.*`
family: `new` (Ctrl+N), `open` (Ctrl+O), `save` (Ctrl+S — re-saves the
known path, else opens Save-As), `saveAs` (Ctrl+Shift+S), plus
`core.export.png`. The unsaved-changes guard routes new/open (and the
window close) through the shared `UnsavedConfirmDialog`
(`ui:unsaved-confirm-requested` → `ui:unsaved-confirm-resolved`); the
close guard intercepts `onCloseRequested` on the desktop (new
`core:window:allow-destroy` capability) and `beforeunload` on the web.
The menu's «ذخیرهٔ همین حالا» item became «ذخیره» (the file save); the
autosave slot is purely internal.

### D-4.6 — PNG export composites the REAL renderer + a mirrored DOM layer

The exporter reuses `Canvas2DRenderer` itself (a fresh instance over an
offscreen canvas, grid off, no handles, `preloadImages` awaited) with a
virtual camera — `zoom = scale / devicePixelRatio` compensates the
renderer's DPR pipeline so device pixels land at exactly `scale` per
world unit. The text layer is REBUILT as self-contained HTML
(`buildTextLayerHtml`: one absolutely-positioned div per text-bearing
object, `transform-origin: 0 0` + `translate() rotate() scale()` — the
EXACT composition of the live `TextObjectView`, whose `origin-top-left`
class was the decisive detail) and rasterized through
SVG-`<foreignObject>` with Vazirmatn 400/600/700/800 embedded as base64
`@font-face` rules collected from the live stylesheets (external
resources cannot load inside SVG images). Prose/table/list CSS is
inlined with literal colours (CSS variables don't resolve in the SVG
context). Fonts and rasterization failures throw TYPED errors (never
silently dropped content). The export deliverables: browser download
(web) / native Save dialog + the new `save_binary_file` IPC (base64 →
bytes, desktop).

The live-view transform composition was verified EMPIRICALLY in the
browser (measured rects at zoom 1 and 1.16) before the exporter was
wired — the naive `left/top` + scale-about-centre placement was off by
`(s−1)·size/2` and is exactly why the export mirrors the live transform
string instead.

### D-4.7 — Known honest behaviour: content-driven re-measure dirties a fresh open

Opening a file whose auto-size text boxes measure differently than
stored (hand-edited fixtures, or boxes authored in another context)
re-measures on load (`TextLayerView.refreshStaticGeometry`) — the object
data genuinely changes, so the document marks dirty and the title shows
«*». Files saved by the app itself open clean. Keeping the honest dirty
flag beats absorbing the re-measure with a fragile grace window.

### D-4.8 — Browser-only export code stays outside the node coverage gate

The strict ≥90 %/85 % coverage gate now includes ObjectRegistry,
objectTypes, MigrationV1toV2, DocumentService, RecentFilesService and
pathNames. `DomRasterizer`'s font collection + SVG rasterization,
`exportToPng`'s DOM compositing and `TauriAppDataStorage`'s IPC paths
are browser/Tauri-only: their PURE surfaces (bounds planner, HTML
builder, prose CSS, typed errors, base64, join fallback) are unit-tested
and the full pipeline is verified LIVE (agent-browser E2E: 2x export
536×536 with embedded-font Persian text, sticky at exact world offset,
transparent-background alpha 0). AC4.8's "persistence + ObjectRegistry
≥ 80 %" measures 96.6 % / 95.5 % on the gated surface.

## #35 — Phase 14 (rebuilt): the wiki-link knowledge graph (2026-09-14)

**Context:** rebuild-queue item (a) from the Task-4 handover — the
wiped pack Phases 11–12 wiki-link lineage re-implemented as the
user-facing «فاز ۱۴ — پیوندهای دانش» (v1.21.0).

- **#35a — the grammar is tiny and lossless:** `[[عنوان]]` + `#برچسب`
  are the ONLY constructs; both live verbatim in the object text (the
  Markdown interop keeps them as plain text, #34d). All matching goes
  through `normaliseKnowledgeKey` (Arabic ي/ك → Persian ی/ک, ZWNJ
  drops, whitespace collapse, latin casefold) so keyboard drift
  resolves; keys cap at 96 chars.
- **#35b — titles resolve name > first heading > PLAIN first line:**
  the first-line/heading fallback STRIPS wiki markup first — a line
  that is nothing but `[[links]]`/`#tags` yields NO title, so a
  link-note never becomes a resolution target of its own links (and
  never inflates the stats).
- **#35c — link spans end at the FIRST `]]`:** a title may contain
  single brackets («[[اینجا ] نه]]» → «اینجا ] نه»); the parser never
  balances nested structures. Empty/whitespace-only titles are never
  links.
- **#35d — tag starts are word-boundary anchored with a ZWNJ
  carve-out:** «کلمه#داخل», «a#b» and «##دابل» reject; a ZWNJ inside
  the preceding token («می‌شود#برچسب») reads as a fresh tag start (the
  ZWNJ is not a word character — the token is already split); tags
  need ≥1 letter (numbers-only is noise).
- **#35e — the index is an immutable snapshot per rebuild:** the
  service rebuilds from the scene seam 250 ms after the last
  `scene:changed` (its own schedule, read-only), emits
  `knowledge:changed` with aggregate stats, and hands every caller the
  same frozen maps. An empty scene returns the SHARED
  `EMPTY_KNOWLEDGE_INDEX` singleton (identity checks downstream).
- **#35f — the section surfaces, it does not manage:** outgoing chips
  (resolved = fly-to; broken = red/dashed «ناموجود»), backlink rows
  (fly-to + select) and tag chips are the whole UI — editing happens
  in the text itself; the section re-renders off `knowledge:changed`,
  never off its own state. Markdown interop's `[[wiki]]` chips now
  re-bind to this service (the #34d seam closed).

## #34 — Phase 13 (rebuilt): schema v3 styles, single-level auto-layout, one-way mirror (2026-09-14)

**Context:** the Knowledge Pack's Phase 13 re-implemented on the rolled-
back v1.19.0 base (see CHANGELOG 1.20.0's workspace note).

- **#34a — styles section (schema v3):** user styles persist in the
  project file's `styles: {version, styles}` section; built-ins are
  NEVER persisted (re-materialised at boot). Migration 2→3 is purely
  additive (empty section; a pre-existing section passes verbatim).
- **#34b — auto-layout is SINGLE-LEVEL:** a frame with `layout` never
  flows inside another auto-layout frame; connectors/freehand/group
  members stay out (the GROUP as a whole may sit in a flow). Containment
  is the TOP-LEFT corner inside the body — a child dropped near the far
  edge flows and the frame then GROWS to wrap (never shrinks).
- **#34c — the Markdown mirror is ONE-WAY:** writes happen only after
  successful disk saves; mirror files are never read back. The `.icb`
  stays the source of truth (AC13.2 notice). The web route reuses the
  save bridge's root policy + validates every entry (relative `.md`
  paths only, size caps).
- **#34d — `[[wiki]]` chips stay LITERAL in this build:** the wiki-link/
  backlink semantics shipped with the wiped pack Phases 11–12; the
  exporter/importer preserve the text verbatim so the round-trip is
  lossless TODAY and the chips re-bind when the knowledge service is
  rebuilt.
- **#34e — R13.6 (multi-window) DEFERRED** per the pack's own deferral
  clause — single-writer multi-window needs the desktop shell to verify.
- **#34f — StaticTextCache ships policy-first:** the pure module (warm/
  cold, signatures, LRU, drift) is fully virtual-clock tested; the
  DOM-hide + canvas-draw wiring is a small follow-up on the renderer
  pass (documented in KNOWN_LIMITATIONS).

## Phase 5 — Sticky, Images, Connectors, Freehand (+ snap) (2026-09-12)

### D-5.1 — Image bytes live INLINE as data URLs (R5.2's "decide and log")

The R5.2 storage decision: **inline data URLs inside the object data**,
not a sidecar assets folder. Rationale: the web shell has no file-system
(the sidecar would only work on the desktop shell), a single-file `.icb`
stays portable across both shells and survives localStorage autosave,
and byte-preservation is honoured at import (small PNG/JPEG pass through
byte-identical; only oversized bitmaps are downscaled to protect the
localStorage quota, logged since Phase 1). The trade-off (bigger files,
re-encode on downscale) is accepted for a fully offline product.

### D-5.2 — Connector labels are PLAIN text, edited by a bare `<input>`

R5.3 explicitly demands "plain input, not TipTap". The label is a plain
`string` on `ConnectorObjectData` (optional — pre-Phase-5 files stay
byte-compatible), rendered as a canvas-painted chip riding
`pathMidpoint` (arc-length midpoint for elbows, `t = 0.5` for beziers)
at a FIXED 11px screen font (AC5.3 "readable at any zoom"), overlong
captions ellipsizing at 140px. Double-click opens a floating
`<input>` (bus event `ui:connector-label-requested`); Enter/blur commits
one `UpdateObjectCommand` (one undo step), Escape cancels, and an empty
caption CLEARS the label (renderer and serializer both treat "" as
absent). The chip re-projects every frame while editing (the name-badges
rAF pass) so it keeps riding the midpoint through pans and re-glues.

### D-5.3 — Highlighter = stored flag + paint-time alpha/multiply

The marker mode is a single optional boolean on `FreehandObjectData`
(persisted; drafts preview it through the same renderer). Rendering:
`globalAlpha 0.45`, `globalCompositeOperation "multiply"`, butt caps —
the spec's "semi-transparent, multiply blend". Two structural notes:
(1) text lives in the DOM layer ABOVE the canvas, so highlighted text
stays readable by construction (AC5.4) — the multiply only blends with
canvas ink (grid, shapes, strokes, images); (2) the WIDE visual width
IS the stored `strokeWidth` (the composition root floors marker widths
at 8), so the eraser and hit-tests — which use the stored width — stay
consistent with the visual. The multiply against transparent canvas
regions degrades gracefully to plain translucent ink (the compositing
formula passes source through where destination alpha is 0).

### D-5.4 — Snap grid = 20, aligned with the visible grid (BASE 24 → 20)

R5.5 fixes the snap default at 20 world units; the visible grid's base
spacing was 24. Keeping both would mean snapped edges NEVER land on the
visible dots (24·2^n is never a multiple of 20). The grid base moved to
20 so every adaptive zoom level (20·2^n) is a multiple of the snap
spacing: snapped objects land on dots at every zoom. Snapping is
ALWAYS-ON by default (the spec's "optional" = the StatusBar magnet
toggle), with the spacing configurable (10/20/40/80 presets in the
settings popover). Object/anchor candidates (smart guides) are
explicitly Phase 7 — the engine's `SnapCandidate` contract already
speaks their kinds.

### D-5.5 — Shift (explicit precision) beats the grid; rotated resizes skip snap

Interaction precedence, uniformly: while Shift is held during a move or
resize, the axis lock / aspect lock wins and snapping is skipped — Shift
is an explicit precision gesture. Resizes of ROTATED objects skip
snapping too (their world-axis edges are not their visual edges). Image
resizes invert the generic Shift contract per AC5.2 ("aspect ratio
locked by default"): images lock WITHOUT Shift and Shift UNlocks them.

### D-5.6 — Snapped drags stay ONE undo entry

The move gesture still coalesces per-frame `MoveCommand`s; snapping
changes only the DESIRED displacement each frame (edge/center proposals
of the drag-start bounds, closest to the raw placement), so the
frame delta is `desired − applied` and the history contract is
untouched: one drag = one undo entry, whatever the snap state.

## Phase 6 (R6.1–R6.8) — tables, context menus, alignment, distribution

### D-6.1 — Context-menu contributions target regions + an objectType wildcard

The R6.2 spec's contribution target is `{objectType? | region}`. The
implemented shape is `{region: "canvas"|"table"|"text", objectType?}`
where `objectType` narrows CANVAS targets only: `undefined` matches
every right-click (empty canvas or over any object), a concrete kind
("textBox") matches itself, and the `"*"` wildcard matches any
non-empty object hit — this is what keeps selection operations
(duplicate/delete/group/z-order) off the empty-canvas menu without a
second matching concept. Non-canvas regions never carry an objectType
(a table-cell right-click is a table-cell right-click).

### D-6.2 — Context-menu labels/icons/disabled state resolve FROM the CommandRegistry

Leaf contributions carry only a `commandId`. The host resolves the
command's `titleKey` (i18n) and probes `isEnabled` at open time;
sub-submenus (rows/columns/alignment/presets/z-order) are builders that
run at build time so they can depend on live state. Icons are
host-mapped per command id inside ContextMenuHost — the registries stay
free of UI imports (the CommandEntry `icon` field stays reserved for
Phase 7's palette). Consequence: every menu action is a registered
command (AC6.7) and the palette gets the same actions for free.

### D-6.3 — Visual insert-column semantics, direction resolved at execution

`core.table.insertColumnLeft/Right` mean VISUAL left/right. The
executor reads the table's `dir` and maps: RTL (column 1 rightmost) →
visual "left" = logical `addColumnAfter`; LTR → "left" =
`addColumnBefore`. This keeps labels truthful in both directions (the
RTL user clicking «درج ستون در سمت چپ» gets a column to the left)
without duplicating the library's logical commands. Tested pure via
`logicalInsertForSide`.

### D-6.4 — Split h/v modelled on the stock splitCell algorithm; valign on the same attr channel as backgroundColor

The axis splits reuse prosemirror-tables' own position resolution
(`TableMap.positionAt`, mapped inserts, CellSelection restore) instead
of shelling out to the full split + re-merge — behaviour stays
library-consistent and each split is ONE transaction = one undo step
(R6.8). Vertical alignment rides the same per-cell attribute channel as
`backgroundColor` (parse/render HTML inline style), so JSON round-trip,
static rendering and the PNG exporter mirror pick it up with zero
renderer changes (the exporter's static HTML carries the inline
styles). Paste-time cell styles stay stripped (R3B.5 strict
sanitisation) — Word paste keeps structure + text + inline marks only,
which is R6.6's "basic formatting".

### D-6.5 — Column distribution preserves the CURRENT total; auto tables bail without a measurement

`distributeTableColumns` redistributes the current total (sum of the
cells' `colwidth` attrs) equally, clamped by the resize plugin's
minimum (the minimum wins when the total cannot honour it). Tables that
were never drag-resized carry no `colwidth`; the live shells pass a DOM
measurement (table clientWidth ÷ grid columns) as the fallback, and
headless/zero-measure contexts bail with `false` rather than inventing
widths. Writes go through EVERY cell's `colwidth` (spanning cells get
their column slice) — the exact channel the drag-resize plugin reads,
so the colgroup and the serialized document both update.


### D-7.1 — Ctrl+K splits by focus; smart guides have no separate toggle

The Phase 7 spec assigns Ctrl+K to BOTH the R3B.3 link dialog and the
R7.11 palette. They coexist by focus: while a rich-text session is live
the editor's own Ctrl+K opens the link dialog (the window-level
dispatcher suppresses shortcuts inside editable targets); anywhere else
Ctrl+K opens the palette. Smart guides ship WITHOUT a separate
visibility toggle (the spec only demands the Alt bypass + the grid's own
magnet toggle); grid snap and guide snap are computed independently in
the move gesture (guides apply after the grid adjustment, both are
bypassed while Alt is held mid-drag).

### D-7.2 — Align/Distribute reference frame = FULL selection bounds (locked included)

`alignSelection` aligns the MOVABLE objects onto the bounds of the FULL
selection (locked objects refuse to move but still define the frame —
the Figma contract); `distributeSelection` plans equal gaps over the
movable set (the 3-object threshold applies to the selection). Both
commit through ONE composite of MoveCommands.

### D-7.3 — Image cards launch the asset flow; radius/shadow/opacity omitted

The Insert Panel's image card opens the Insert-Image dialog on both
click and drop: a contentless placeholder object would be useless, and
the dialog IS the toolbar-equivalent path (the R5.2 `core.insert.image`
command). The spec's shape-section extras (radius, shadow, opacity) are
omitted: the shape model carries no such fields (fill/stroke/strokeWidth
only) — adding them is model+renderer+serializer churn outside this
phase's registry-composition point. The COMPOSITION seam (R7.2) is fully
delivered; new sections are registrations.

### D-7.4 — Panel docks are floating glass columns, not reflowing sidebars

The Phase 7 dock panels stay in the established floating-glass overlay
language (absolute columns at the logical dock edges, capped heights,
icon rails for toggles) instead of Figma-style reflowing sidebars: the
canvas never reflows, the RTL mirroring comes free from logical CSS, and
the placement contract (left|right|bottom) is honoured verbatim.
Panel-state persistence is per-panel-id in localStorage, merged over the
registry's `defaultOpen` values on boot.

### D-7.5 — Bookmarks ride the v2 envelope as an optional field

`ProjectData.bookmarks` is an OPTIONAL top-level field of the v2
envelope (written only when non-empty): older files simply have no
field (reads as "no bookmarks"), the loader validates defensively
(corrupt entries drop — never a crash), and no version bump or migration
is needed — the same approach the `plugins` passthrough took for
forward-compatibility.

### D-7.6 — The catalog's card variants live in metadata, not in code paths

One registry entry may cover several insertable widgets (the shape kind
covers rect + ellipse): `ObjectCatalogMeta.cards` carries per-variant
{key, icon, titleKey, order, factory} so the Insert Panel and the
`core.insert.*` commands resolve EVERYTHING from metadata — the panel
never branches on kind (AC7.13's zero-panel-code-edits proof holds for
variants too). The insert engine (`insertCatalogObject`) translates the
card's factory output so its bbox CENTRE lands exactly on the target
world point (kind-aware translation — freehand points and connector
endpoint caches ride along); text kinds open an edit session after the
single AddObjectCommand.

### D-8.1 — Settings live in the UI store, persisted as app data

The R8.2 settings remain slices of the existing Zustand UI store (single
live truth, every consumer already selects narrow slices); the new
`ui/settings/settingsPersistence.ts` hydrates once on boot and persists
each change to localStorage under the project's key convention. This is
APP data (never the .icb project file) per the spec. A separate settings
service would have created a second source of truth for slices the store
already owns (theme, language, snap…); the dialog's sections read/write
the store directly, so every change is live by construction.

### D-8.2 — Frame containment is GEOMETRIC, not parentId mutation

"Objects can be moved into frames" is implemented as geometric
membership: a slide contains every non-frame object whose bounds
INTERSECT the frame rectangle, computed at presentation/export time.
Moving an object into a frame region is enough — no parentId writes, no
history entries, no move-commit hooks in SelectTool, and the editor keeps
showing overflow (children clip visually ONLY in presentation mode,
Figma-style). A parentId model would have threaded frame adoption through
move commands, undo, the layers tree and the serializers for zero user
visible gain in this phase.

### D-8.3 — Presentation slides rasterise the canvas, mount LIVE DOM text

Each slide renders the frame's content as a PNG raster (the proven
export pipeline: fresh offscreen renderer + theme palette) with the
text layer mounted as REAL HTML (the export HTML builder, scaled and
clipped to the frame, live fonts) — that is what keeps links clickable
(AC8.5) while preserving pixel-exact Persian shaping for everything
else. Fullscreen uses the standard requestFullscreen API (works in both
shells); navigation keys are RTL-aware (in Persian the LEFT arrow moves
forward).

### D-8.4 — Version history: SQLite on the desktop, a localStorage engine on the web

The service speaks ONE statement family (INSERT/SELECT/DELETE against
`core_versions`, ORDER BY ts DESC, id DESC) through the DbAccess gate.
The desktop shell binds it to `tauri-plugin-sql` (sqlite:appdata.db);
the web shell (and any plugin-unavailable environment) runs the same
statements over a localStorage-backed engine with per-path pruning (20)
and quota shedding. Tests cover the service through the local engine;
the SQLite path is the same statements (compile-verified on Windows
during the packaging run).

### D-8.5 — SVG vectorises geometry; text embeds as raster (documented)

The SVG exporter vectorises shapes, sticky cards and frames (their
geometry is primitive) and embeds the text layer (plus connectors,
strokes, images) as a single raster <image> — the exact limitation the
spec asks to document in the dialog. Vectorising Persian text would
require path-level shaping (harfbuzz-in-JS) and font subsetting for
correct output; the raster path guarantees fidelity today and stays
honest about it.

### D-8.6 — PDF is a PRINT pipeline, not a hand-built PDF

The PDF export builds an A4-landscape print document (one page per
frame, or fit-all) embedding the proven PNG rasters and opens it in a
hidden iframe's print dialog — the user picks «Save as PDF». Hand-built
PDFs with Persian text need embedded shaped fonts (the same complexity
class as D-8.5); the print path delivers correct Persian today, on both
shells, with zero new dependencies.

### D-8.7 — Templates are generated .icb resources with a builder fallback

The template builders (`core/templates/templates.ts`) are the single
source of truth; `scripts/generateTemplates.ts` serialises them into
`public/templates/*.icb` (checked in, served by both shells since Vite
copies public/ into the Tauri bundle). The gallery fetches the files and
imports them through the regular pipeline; when a fetch fails (missing
file, odd proxy) it serialises the builder directly — identical
semantics, still fully offline.

### D-8.8 — open-file reaches the WebView twice (immediate + delayed re-emit)

The Rust setup hook emits `open-file` for a cold-start .icb argument
immediately AND re-emits it 2.5 s later on a plain std thread: the
frontend listener attaches asynchronously after the WebView loads, and a
single early emit can race it. The re-emit is idempotent (importing the
same file twice lands the same document). Single-instance launches emit
once (the WebView is warm).

---

## #26–#33 — Phase 10 (2026-09-12)

### #26 — Calendar data scope is GLOBAL (plugin storage)

The calendar's events live in the plugin's namespaced storage, not in
the project file (R10.3 explicitly logs this decision). Rationale: a
calendar is a cross-project artifact — you do not lose your meetings
because you opened another board; and the planner's "task completed →
calendar event" automation (AC10.4) must fire regardless of which
project is open. Uninstall still archives + restores it exactly
(AC10.6).

### #27 — Planner is per-project with a browser-local global overview

Tasks/goals live in the project file's `plugins.planner` section
(projectRead/projectWrite consented). The «نمای کلی» toggle reads a
mirror the plugin maintains in its own storage: every write updates a
`globalIndex` entry keyed by the plugin-generated projectId. The
overview is therefore THIS DEVICE'S view of every planner dataset this
browser has seen — an honest, offline "global" with no server and no
cross-device claims.

### #28 — Lunar holidays are a bundled approximation table

Solar Hijri holidays are exact (fixed every year). Lunar religious
holidays drift ~11 days/year; the calendar bundles a per-year
approximation table for 1403–1405 and labels every approximated entry
«(تقریبی)» (docs/CONTRACTS.md + KNOWN_LIMITATIONS). The dataset is
plain data in the plugin — users can extend coverage by adding events.

### #29 — The hub answers outcomes, never throws, for availability

Every consumer-facing failure (no provider / version mismatch / dead
provider / 4 s timeout) returns `{ok: false, reason, message}` with a
Persian message. Consumers render the notice and switch the feature
off. This is the AC10.1 contract: degradation is DATA, not control flow.

### #30 — Automations fire through the command dispatcher

A command action routes through the SAME dispatcher the keyboard and
palette use — undoable commands stay undoable because the path is
identical (one execution, one history push). Datahub-write actions are
not undoable (they mutate plugin-owned data outside the scene graph);
the log records every firing either way.

### #31 — app.network.fetch gained a body (POST) for the AI backends

Phase 9 shipped a GET-only fetch. The AI Analyst needs
OpenAI-compatible/Ollama POSTs, so the host handler now accepts
{method, headers, body} with guards: methods from a fixed set, headers
capped at 32 entries, body a string ≤ 512 KB, http(s) only. The app
core still performs ZERO network calls of its own.

### #32 — The AI confirm gate crosses sandboxes through storage

The headless command persists the pending request
("pendingRequest" KV); the panel region renders the verbatim preview
from it and the ONLY send path is the confirm handler (button or the
region message {type: "confirm-send"}). No confirmation token, no
fetch — that invariant is what AC10.5 tests.

### #33 — First-party plugins are REAL plugins, no private APIs

The four Phase 10 plugins are ordinary packages under
public/plugins-firstparty/ installed through the same consent dialog
as third-party code. They call only the public SDK surface — dogfooding
IS the proof the spec asks for. The host contributes exactly one
contract (project.digest); everything else flows through the bridge.

### #34 — The sample rule targets the REAL contract (addEvent + `__today__`)

The one-click AC10.4 rule originally named a `createEvent` method that
only existed in the test mock — against the real calendar plugin it
would log a Persian failure and create nothing. The shared
`SAMPLE_RULE_ACTION` (rules.ts) now names the plugin's real `addEvent`
and passes `date: "__today__"`, a marker the engine resolves to today's
Jalali date at fire time (recursive, per firing — saved rules stay
correct across days). The panel's one-click button, the builder's
default form and the tests all read the SAME constant, so the shape can
never drift from the contract again.

### #35 — Plugin panel regions carry a definite height (h-56)

PluginRegionFrame sized its host with `h-full` inside the dock's
auto-sized `flex-1` scroll container — circular, so the section
collapsed to a ~59px sliver and the region clipped to ~20px (latent
since Phase 9; the first-party panels made it visible). The host now
carries a definite `h-56` (224px): dock sections size properly, the
region iframe scrolls internally, and settings regions render
unchanged.

### #36 — Live query cards store the QUESTION, never the answer (R15.2)

The `core.query` object persists only its spec (`queryType` +
`queryTarget`). Result rows are computed at render time — the canvas
via a palette-injected `queryResolver` (the renderer stays
framework-free, same seam as `opaqueLabel`), the inspector via the
service snapshot. Consequences: results never enter the scene, never
pollute undo, never go stale in a saved `.icb` (an old file re-opens
with fresh answers), and the 250 ms knowledge debounce is the only
liveness cost. The alternative (caching rows on the object) was
rejected: it would make every knowledge change an implicit scene
mutation.

### #36a — The knowledge graph is deterministic, not physical (R15.1)

`layoutKnowledgeGraph` ranks titles by degree (ties broken by the
normalised key sort), places the busiest node at the centre of a
single ring, and pushes broken targets to a dashed outer ghost ring —
pure, key-sorted, no physics engine. The graph therefore renders
IDENTICALLY across rebuilds and reloads (a force layout would jump on
every `knowledge:changed`, fighting the 250 ms debounce). Dense graphs
(>~40 titles) will crowd the panel ring; accepted for the studio's
note-scale graphs, revisitable with ring pagination if real projects
hit it.

### #36b — Islands, not «unlinked», is the orphan rule (R15.2)

An object is an island only when it has a TITLE but no outgoing links,
no backlinks AND no tags — a titled note that merely carries `#برچسب`
is connected (findable through the tag graph), and an untitled object
cannot be a knowledge island at all (it is invisible to the wiki
grammar). This keeps `orphans` a knowledge question, not a layers
question.

## #37 — Phase 17: structured object properties (2026-09-15)

### #37a — Optional fields, not a schema bump (R11.3's letter vs. §1.7.4's spirit)

The pack asked for a `schemaVersion` bump + migration for properties.
The implementation ships them as OPTIONAL fields instead: `properties`
rides each object's wire (absent = none) and `propertySchema` rides
the project root (absent = no known fields). This satisfies both
acceptance criteria of AC11.3 (old files open fine; round-trips are
exact) WITHOUT invalidating a single existing file or growing the
migration chain — the unknown-data law (§1.7.4) already guarantees
older readers keep the fields alive. A bump would have been pure
ceremony; the optional-field route is byte-compatible.

### #37b — The schema is document metadata, not undoable state

`PropertySchemaStore` edits (explicit type assignment, inference)
mark the document dirty and persist, but are NOT part of undo history
(the styles precedent): a schema edit re-types EDITORS, never values —
undoing "the schema learned نوع=عدد" would be semantic noise. Property
VALUE edits stay fully undoable (one UpdateObjectCommand per edit,
whole-record swap).

### #37c — Type inference is first-use, name-aware, and never re-infers

`inferPropertyType` runs only when a name is unknown: arrays → tags,
numbers → number, booleans → boolean, ISO-date strings OR date-like
NAMES («deadline», «تاریخ سررسید»-style English names) → date, else
text. `select` NEVER infers (its options live in the schema, not the
value). Known names are immutable to inference — explicit assignment
always wins.

### #37d — The tags property folds into ONE tag truth (R11.4)

`buildKnowledgeIndex` gained a Pass 3: the structured `tags` property
of ANY object kind merges into the same tag map as text `#tags`
(dedup per object, first-spelling-wins display). The graph stats,
live tag queries and the search chips therefore see one truth; tag
ids are a set (pass-ordered, not document-ordered — documented in the
tests).

### #37e — Filters alone browse; text + filters AND (R11.9)

`searchScene` with active chips and NO query lists every matching
object as a label-only group (the panel becomes a tag/property
browser); with a query, groups must satisfy both. The chips are a
DIRECT scan (propertyValueEquals with Persian folding) — the full
QuerySpec engine stays Phase 12's job, per the pack.

## #38 — Phase 18: manual links & the tag pane (2026-09-15)

### #38a — Wiki links stay text; the registry owns every OTHER kind (§1.7.8 reading)

A literal LinkRegistry for wiki links would DUPLICATE state the text
already owns (and undo would need text rewriting). The law's intent —
one link truth, every surface a projection — is kept by scoping the
registry to `manual`/`plugin` links (the kinds whose ONLY home would
otherwise be nowhere) while wiki links remain intrinsic `[[…]]` text
parsed by the index. AC11.7's audit surface: no link state outside
`LinkRegistry` + the text itself.

### #38b — Dangling-by-title entries are never pruned in memory

`ObjectLinkEntry` stores BOTH the target id and a title snapshot.
A gone target = dangling (projections vanish) which auto-resolves by
title the day a matching object appears — so AC11.4 (delete → links
vanish; undo → BOTH return exactly) needs zero extra bookkeeping:
deleting makes entries inert, undo re-activates them. Only the SAVE
path filters (source-gone entries drop from the `links` section).

### #38c — Registry mutations are commands; projections re-derive

Add/remove link = one `ICommand` each (removeAll = one composite),
pushed through the SAME HistoryManager as scene edits. The registry
emits change events → the root marks dirty, drains the diff into
`object:linking-changed` and schedules the SAME 250ms knowledge
rebuild (extracted to `scheduleKnowledgeRebuild`). No projection
state anywhere to reconcile.

### #38d — The target picker is a dialog, not a canvas pick-mode

R11.6's "click target object" is realised as a searchable picker
dialog (kind icons + titles, titled-first): robust on huge canvases,
keyboard-friendly, and it doubles as the link manager (existing links
with per-row remove + resolved/dangling chips). The context menu's
remove item is «حذف پیوندهای دستی این شیء» (one composite undo);
per-link removal lives in the picker + the inspector rows.

### #38e — Every save route carries every section (the Save-As bug)

The Save-As paths (typed path / native dialog / web picker /
download) serialized only scene+plugins — bookmarks, styles AND the
Phase-17 propertySchema were silently dropped (only autosave carried
them, which is why it slipped). Fixed structurally: one
`ProjectSaveSections` bundle threaded through `serializeProjectFile`
and every dispatcher; UI callers collect it from the live services.

## #39 — Phase 19 decisions (structured scene queries)

### #39a — One engine, three consumers (the §1.7.9 seam)

`core/knowledge/QueryEngine.ts` is the ONLY query mechanism: the
filter card, the inspector's spec editor and the datahub
`scene.query` contract all call `runSceneQuery` with the SAME
`SceneQuerySpec` shape. No DSL, no eval — a JSON structure validated
by `normalizeSceneQuerySpec` at every boundary (persistence read,
card resolver, hub entry).

### #39b — `ne ""` is the existence check; missing values pass `ne`

A filter `prop ≠ ""` reads as «این ویژگی را دارد» — a missing value
FAILS it (documented + tested). For every other needle, a missing
value passes `ne` and fails everything else. Numbers compare
numerically with Persian-digit parsing (the properties editor's
coercion reused); ISO dates compare as codepoints (correct for
YYYY-MM-DD); missing sort values stay LAST regardless of direction.

### #39c — The filter card keeps the four knowledge kinds as siblings

The R15.2 knowledge kinds (backlinks/tag/broken/orphans) remain first-
class query types; the structured filter is a FIFTH kind (`filter`)
on the same object type — one registry entry, one serializer, two
catalog cards (🔍 islands + 🧮 filter). The spec editor renders only
for the filter kind; the knowledge kinds keep their simple target
input (back-compat: old cards deserialize unchanged).

### #39d — Presentation columns live on the OBJECT, not the spec

The ≤3 results-table columns are the CARD's concern (presentation),
so they ride `QueryObjectData.columns` — NOT the engine's
`SceneQuerySpec` (which stays the pack's exact wire shape for the
datahub contract). The engine is column-agnostic; views resolve
column values through `queryColumnValue`.

### #39e — Recursion guard = the card's own id

`excludeIds` receives the querying card's id only (R12.2's
"QueryObjects are excluded from their own results"): a filter card
never matches itself, while a user CAN still query for other cards.
The engine takes the guard as a parameter (pure, testable); the
canvas resolver and the inspector both pass `[card.id]`.

### #40a — R12.3's arrange is a DETERMINISTIC in-house FR layout (no d3)

The pack specced "d3-force on-canvas arrange"; the project is a
zero-runtime-dependency offline app (GraphLayout already rolls its own
radial layout). GraphArrange implements fixed-iteration Fruchterman–
Reingold in pure TS — same intent (force-directed graph layout on the
canvas), no dependency, and DETERMINISTIC (stable node order + FNV-1a
hash tie-breaks; d3's default simulation is seeded-random and would
jump between runs). Seeding from the CURRENT object centres keeps the
arrange feel local (a re-arrange after small edits moves little).

### #40b — Titles are the arrange nodes; shared titles cluster; ghosts pull

A title shared by several objects is ONE physics node — its members
land in a ≤√n-column grid cluster around the node centre (clusterGap
36). Broken-link targets join as ghost nodes with full mass (their
sources feel the pull) but produce no moves. Exclusions: locked,
grouped, and objects fully inside an auto-layout frame (their frame's
reflow owns them — moving them would be immediately undone).

### #40c — R12.4 edges resolve geometry at PAINT time

The edge model carries only ids (+ broken payloads); the painter
resolves object boxes from the live scene each frame. Edges therefore
track dragged objects with ZERO extra invalidation wiring — the frame
rebuilds only on knowledge/selection changes (ids + highlight), while
camera/scene changes already mark the loop dirty. A 400-edge cap +
viewport culling guard dense graphs; the stub direction is FNV-hashed
per key so missing-title stubs never jump between frames.

### #40d — The knowledge-edge overlay is OFF by default and session-scoped

`uiStore.knowledgeEdgesVisible` defaults false (edges over a busy
board are a VIEW MODE, not a permanent fixture) and is NOT persisted
across sessions (predictable boots; the grid toggle's precedent is a
settings-backed default, but this overlay is intentionally
ephemeral). Surfaces: Ctrl+Shift+E, the palette entry, and the panel's
pressed-state toggle.

### #40e — R12.7 reuses the card's spec builder idioms inside Search

The Search panel's «کوئری ساخت‌یافته» section is the SAME engine
(runSceneQuery) with the SAME closed operator set — one truth for
structured queries. The old R11.9 FilterPicker popover is superseded;
the TAG chip bar stays because it is the TagPane hand-off receiver
(AC11.5). Composition rule: text/tag filters apply FIRST, the
structured id-set INTERSECTS them; with no text/tags the structured
rows render directly (grouped + sorted + fly-to).


## #41 — Phase 21 decisions (the daily-notes journal loop)

### #41a — Daily notes are REAL text objects created through a permission-gated `app.scene` seam

The pack's spec demanded "a text object titled with the formatted
date" — a REAL core object that survives the plugin's uninstall
(AC14.6), not an opaque plugin widget. Rather than opening the scene
to plugins wholesale, the host grew ONE tightly-validated surface:
`app.scene.insertText/insertFrame/addLink/listLinks/removeLinksByOwner/
focusObject/notifyInfo`, permission `scene`, fail-closed clamps on
every field, one undo step per mutation. The dailynotes plugin is the
reference consumer; the seam is now a documented authoring surface
(docs/SEAMS.md §9.4).

### #41b — The plugin link lifecycle rides the RUNTIME's stop, not just the manager's

AC14.6 ("links owned by it are removed — host lifecycle") initially
landed in LifecycleManager.disable/uninstall — but a DIRECT
`runtime.stop()` (the test harness path) bypassed it. The cleanup
moved INTO `PluginRuntime.stop()` so both paths behave identically;
the manager's copy is redundant-but-harmless belt-and-braces.

### #41c — The Jalali date is BOUGHT through the hub, and its absence is a degrade, not a failure

The plugin queries `calendar.events.toJalali` per creation; a missing
provider returns `{ok: false}` and the note still lands — with a
Gregorian title and the Persian degrade notice (banner + toast +
panel chip). This is the hub's showcase of the graceful-degrade law
(the spec explicitly calls it out as the pattern demo).

### #41d — The chain reconciles atomically; addLink stays the only writer

Consecutive dailies link a→b→c («روز بعد»). When the set drifts (a
note deleted), the whole owner-owned chain is rebuilt atomically
(removeLinksByOwner + re-add) instead of surgical patches — cheaper to
reason about, and undo granularity is per-link anyway.

### #41e — Reporter's mood trend auto-detects the first numeric property

Rather than hard-coding `mood`, the Reporter picks the first
(alphabetical) numeric property name beyond type/date/tags that any
entry in range exposes — the same property discipline the inspector
enforces, zero new schema.

### #42a — The marketplace is a catalog over the SAME install pipeline, not a second one

`PluginMarketplaceDialog` never installs anything by itself: it
fetches manifests (offline public assets) for presentation only, and
every install goes through `readFirstPartyPackage` /
`readSamplePackage` + `LifecycleManager.install(pkg, permissions)`
with the identical consent step (the exact permission list precedes
the accept — AC9.4). One pipeline, one set of semantics, two doors.

### #42b — The catalog is a pure module; the dialog only renders it

`pluginCatalog.ts` (sources, category map, projection,
normalised filtering, install-state merge, featured split) is
side-effect-free and unit-tested; the dialog's fetch layer is a thin
adapter. Curated metadata (categories, the editor's pick) lives in
CODE, not in the manifests — the shipped plugins stay unmodified.

### #42c — The marketplace renders through a portal to document.body

The dock panels' `backdrop-blur` creates a containing block for
fixed-position descendants, which would confine a `max-w-3xl`
catalog inside a ~300px panel shell. The portal escapes it; the
SSR-safe mounted check uses `useSyncExternalStore` (no
setState-in-effect). The narrow install dialog stays where it is —
proven in place since phase 9.

### #42d — Plugin-icon `<img>` is exempt from `no-img-element`, surgically

The plugin icons are tiny bundled SVGs fetched as public assets;
next/image optimisation is meaningless for them. A targeted eslint
override covers exactly `src/ui/components/plugins/**` +
`PluginManagerPanel.tsx` (the family that renders them), taking the
codebase to 0 errors / 0 warnings. `phase-changed/` (the upload's
reference diff-bundle) joined the ignores for the same reason.

## #43 — Phase 23 decisions: the clipboard bridge (2026-09-15)

### #43a — One clipboard state, two channels

The internal selection clipboard (`SelectionClipboard`, deep-cloned
payload with top-level ids + bbox anchor) is the single source of paste
truth. The OS clipboard is a SIDE CHANNEL seeded on copy/cut (single
image → `image/png` at intrinsic size; text-bearing selection →
`text/plain`) — never an input for internal pastes. The buffer survives
undo/cut/reloads-of-attention; the OS write is fire-and-forget with a
Persian failure notice.

### #43b — Mod-V routes by clipboard STATE, not by a shortcut binding

`core.edit.paste` deliberately carries NO shortcut. The raw keydown
gesture (`useCanvasShortcuts`) claims Mod-V only when the internal
buffer has content (preventDefault + the command); an EMPTY buffer lets
the browser's native paste event flow to the import bridge — so OS
images/text import through the event pipeline with zero permission
prompts. A 150ms suppression window keeps an internal paste from
double-importing when a browser still fires the event.

### #43c — The original-quality contract

Image objects carry `naturalWidth/Height` (stored at import); outbound
copies render the ORIGINAL `src` at the INTRINSIC pixel size (never the
placed world size), and the inspector's two resets (full natural /
ratio-only) are single `ResizeCommand`s with centre preservation —
undo restores the drifted state exactly. `MAX_IMAGE_DIMENSION` (1600)
remains the import downscale ceiling (localStorage quota), so
"original" means the stored intrinsic size.

### #43d — External drops land on the drop point and degrade honestly

Dragged-from-web payloads (no File) resolve through
`text/html` `<img src>` → image-looking `text/uri-list` → `text/plain`
priority. Image URLs are FETCHED (user-initiated, CORS-mode) and
imported at the exact drop point at original quality; failure (CORS,
offline) degrades into a text box carrying the address with a Persian
notice — never a silent no-op. `dragover` claims text/uri-list/html
everywhere outside editables and native form fields so the browser
never navigates to a dropped link.

### #43e — Import machinery is dependency-injected

`ui/clipboard/canvasImport.ts` receives scene services as parameters
(`ImportServices`) and imports nothing from the composition root — the
root calls it from its wiring without module cycles; the hook
(`useImageImport`) and the Insert-Image dialog resolve and forward.
The OS bridge (`osClipboard.ts`) is fail-safe by construction: every
API absence (Firefox image write) resolves false and the caller raises
a notice instead of throwing.

## #44 — Phase 24 decisions: the rich Word interop (2026-09-15)

### #44a — Parse clipboard HTML with the EDITOR'S OWN parser

The canvas-level rich paste does not hand-roll an HTML→JSON mapping: the
sanitised fragment (R3B.5 allow-list) is parsed by ProseMirror's
`DOMParser.fromSchema(sharedSchema)` — the very parse rules the live
editor applies to its own pastes. Formatting fidelity is therefore
schema-complete by construction (bold/italic/underline/strike, headings,
lists, tables with spans, links, blockquote, code, hr, `dir`), and a new
schema capability automatically enriches the canvas paste too. The
planner (`planRichTextPaste`) keeps the pure decision: formatted → rich
text box; plain paragraphs → the byte-identical Phase-23 path; nothing
importable → null.

### #44b — Rich pastes are FIXED-width Word-like boxes

`insertRichTextBoxAt` commits `sizeMode: "fixed"` — rich content wraps
like a Word paragraph instead of growing to the longest (possibly
table-wide) line. The size heuristic (`estimateRichPasteBoxSize`) unions
the Phase-23 plain-text estimate with a block walk: headings at their
scaled line height, lists per item, code per source line, tables as
`cols × TABLE_COL_WIDTH` by `rows × TABLE_ROW_HEIGHT`. It is deliberately
generous: the DOM text layer paints overflow and the first edit session
re-measures the box.

### #44c — Word fake lists merge by `mso-list` id, nest by level

Phase 23 converted each Word fake-list paragraph into its OWN list,
slicing every multi-item Word list into fragments. فاز ۲۴ groups
paragraphs by Word's `mso-list:lNNN` id (one id per visual list) into ONE
real ul/ol; `levelN` deeper paragraphs continue the nested list inside
the parent level's LAST item (created on demand), so two-level Word
lists land with real nesting. Id-less payloads keep the legacy
following-REAL-list continuation.

### #44d — The outbound snapshot is a SUBSET SCENE, not a cropped frame

Multi-object copy rasterises a temporary `Scene` containing EXACTLY the
selection (groups ride with their members, parent paint order
preserved) through the standard export pipeline — bystanders that merely
overlap the selection's bounds are NEVER drawn into the snapshot. The
snapshot is transparent 2× PNG with the ACTIVE theme's palette/ink (CSS
variables), rides in ONE `ClipboardItem` with the plain-text projection
when text is present, and a rasterisation failure degrades to the
text-only write. CUT builds the subset BEFORE the removal (the objects
are shared by reference).

### #44e — The raster decision table

`shouldRasterizeSelection`: multi-object → snapshot; lone image → the
Phase-23 original-quality PNG path; lone text-bearing object → pure
`text/plain`; everything else (lone shape/frame/connector/sticker/
freehand) → snapshot. The explicit `core.edit.copyAsImage`
(Mod-Alt-C, «کپی به‌صورت تصویر») overrides the table — ANY selection
(including a lone text box) rasterises on demand.

### #44f — The rasterizer eats XHTML, not HTML

The SVG-`foreignObject` rasterization context parses its payload as XML,
but the text layer hands it HTML serialisation — whose VOID elements
(`<col>` of rich-text tables, `<br>` hard breaks, `<hr>`) are unclosed and
whose entities are HTML-only. One unclosed `<col>` made the ENTIRE SVG
image fail to load: every PNG/SVG export of a canvas containing a table
or hard break died silently at this step (a latent bug since Phase 4.8,
exposed the moment Word paste-in put real tables on the canvas).
`xmlNormalizeFragment` (DOMParser → XMLSerializer round-trip) is applied
inside `rasterizeHtml` — the single funnel for the PNG exporter, the SVG
exporter's embedded text raster AND the فاز-۲۴ selection snapshot — so
every producer is fixed at once and future void elements are covered
automatically.

### #45 — Pin-to-screen anchors are viewport FRACTIONS on physical axes (فاز ۲۵)

A pinned object stores `pinAnchor` as normalized 0..1 fractions of the
VIEWPORT (top-left origin, physical axes — never RTL-flipped), not screen
pixels: a window resize keeps the relative placement and the value is
camera-invariant by construction. The world `position` field is kept
untouched while pinned (rendering ignores it) and restored on unpin by a
`MoveCommand` landing exactly under the anchor — the one documented
exception to "geometry edits never use UpdateObjectCommand", chosen
because `MoveCommand` keeps derived geometry (freehand points, group
members) consistent; the flag itself clears through a plain
`UpdateObjectCommand`. Stale-but-ignored `pinAnchor` after unpin is
accepted (cheaper than field surgery, overwritten on the next pin).

### #45b — Pinned objects are screen furniture; the world pass never sees them

Pinned objects are excluded from EVERY world-space consumer — the
hit-test walk, the marquee, the R-tree spatial index, `fitAll` and the
selection-union — because their world footprints are camera-stale by
definition. They resolve instead through `hitTestPinned` (screen rect =
anchor + intrinsic size at scale 1), render in a dedicated screen pass
(identity camera for canvas kinds, a transform branch for DOM views) and
show no resize/rotate handles (their size is the world size at scale 1;
resizing while pinned is deliberately not offered this phase). Pinnable
kinds: shape, textBox, stickyNote, image, sticker — top-level only.
Connectors/freehand/groups/frames/plugins/queries are world-attached by
geometry (point lists, glue, layouts) and refuse the affordance.

## #46 — Phase 26 decisions: selection & clipboard quality (2026-09-16)

### #46a — Clipboard image writes resolve a TRI-STATE; "unsupported" downloads

The Phase-23/24 write functions returned a bare boolean, conflating "this
browser cannot write images" (Firefox — no `ClipboardItem`) with "the
write failed". فاز ۲۶ splits the outcomes: `"written"` / `"unsupported"` /
`"failed"`. Only `"unsupported"` triggers the fallback — a single image
re-renders at its intrinsic size and downloads as
`infinite-canvas-image.png`; a selection snapshot still writes its
plain-text projection through the TEXT clipboard (Firefox supports that)
and downloads `infinite-canvas-selection.png`. A genuine `"failed"` keeps
the honest error toast — a permission denial must not silently become a
download. The desktop shell (WebView2) always has `ClipboardItem`, so the
fallback is web-only by construction; in a WebView without it the anchor
download still works.

### #46b — The count chip's label is INJECTED, never imported

The multi-select count chip lives in `HandlesRenderer` (screen space,
above the frame's top-right corner — RTL-first reading, flipped inside
when it would clip the viewport top). Following the established
framework-free rule (same as `guideNumberFormat` and `queryLabels`), the
renderer never imports the UI dictionaries: the canvas host injects a
locale-aware formatter via `setCountLabelFormat` (Persian digits follow
the R3B.7 UI setting; ASCII when off), re-applied on language/digit
switches. The chip shows the SELECTION count (top-level objects — a group
is 1), matching the status bar's number.

### #46c — Multi-select strength, single-select subtlety

Per-object outlines existed since the early phases but painted at 1 px /
40-45 % alpha — nearly invisible against the group frame, which is why
the affordance read as missing. فاز ۲۶ resolves the style from the
selection size: multi-select paints every member (and every GROUP member,
and every rotated true frame) at 75 % accent alpha / 1.5 px; a single
selection keeps the hairline because the dashed accent frame + 8 handles
dominate there and doubling the outline would add noise, not signal.

## #47 — Phase 27 decisions: pinned-object resizing (2026-09-16)

### #47a — Pin-resize sizes are SCREEN pixels; the fixed point is the opposite corner/edge

The pinned render is scale 1 (فاز ۲۵ invariant), so the stored
width/height ARE the object's on-screen pixels — a pin-resize drag
writes them directly (world footprint at the current camera = size /
zoom, derivable any time without storage). The gesture never stores an
in-object anchor fraction: the shared `resizeRectFromHandle` box math
anchors the min-size clamp at the UNTOUCHED edges, which IS the
opposite-corner-fixed-point semantics (`PIN_RESIZE_FIXED_POINT`
documents it per handle). The top-left `pinAnchor` re-derives from the
new origin and is deliberately UNCLAMPED — the fixed point may
legitimately sit off-screen; every consumer (`pinAnchorToScreen`,
`pinnedScreenRect`, hit-testing, renderers, persistence) tolerates
out-of-range fractions, and the inspector readout shows the raw value.

### #47b — Rotated pinned objects resize in their LOCAL frame; rotation stays a world affordance

Handles ride the ROTATED corners of the screen footprint (rotated around
its centre); the drag pointer un-rotates into the local frame before the
box math (the `ResizeGesture` rotated path mirrored in screen space), so
tilted edges keep their tilt while the box grows. ROTATION of a pinned
object still requires unpinning — a screen-space rotation gesture adds
an axis confusion (which way is "15°" when the camera rotates too) for
little value; the limitation is documented, not silent.

### #47c — The pinned selection identity is AMBER (the pin chrome colour)

Phase 25 painted the selected pinned ring with the violet selection
accent while the IDLE ring was amber — the two languages mixed. فاز ۲۷
unifies: the selected ring (HandlesRenderer), the chrome ring + chip
border (Canvas2DRenderer) and the DOM `.text-object-pinned-selected`
outline all paint the pin-chrome amber `oklch(0.8 0.14 80)`, and the new
resize handles stroke a sibling amber — "pinned" reads at a glance
against the violet world-selection language, on both themes.

### #47d — The inspector's pinned size row writes through ResizeCommand

`useInspectorModel.setPinnedSize` clamps to 8..4096 screen px, keeps the
TOP-LEFT anchor fixed (the row resizes like the se handle), flips an
AUTO text box to FIXED on a width change (R3A.7, via `withManualSizeMode`)
and records ONE `ResizeCommand` snapshot swap per commit — the
geometry-edits-flow-through-ResizeCommand rule (never
`UpdateObjectCommand` for size) holds in screen space too.

### #48a — Pinned objects are EXCLUDED from exports unless the toggle opts in

The phase-25 documentation claimed "pinned objects are excluded from
exports by design" — but nothing enforced it: pinned canvas kinds LEAKED
into the PNG/SVG canvas (the renderer's screen-space pass ran on the
export canvas at devicePixelRatio scale, amber ring and 📌 chip
included), pinned text/sticky objects rendered at their STALE pre-pin
world position in the DOM text layer, and their stale bounding boxes
silently inflated `computeExportBounds` (and every planner built on it —
PDF pages, the dialog's size preview). فاز ۲۸ makes the exclusion REAL:
bounds skip pinned objects, and both exporters render a pinned-aware
PLAN view in which no object is pinned — the renderer's screen pass
stays idle, so no pin chrome can ever reach a file. The exclusion is
the DEFAULT; inclusion is an explicit, per-export opt-in.

### #48b — Included pinned objects ride the world pass as UNPINNED mapped clones (relative footprint)

`buildPinnedExportPlan` maps each included pinned object to the export
image's own geometry: the anchor fraction becomes the same fraction of
the image (`bounds.min + anchor · bounds.size`), and the on-screen
footprint becomes the same RELATIVE size (`object px · export/viewport`
per axis — a note covering 15% of the screen covers 15% of the image;
per-axis mapping, so position AND proportion stay faithful even when
the export aspect differs from the viewport). The mapped clones are
UNPINNED and ride the regular world pass — every per-kind drawer,
culling, z-order and the image cache work unchanged; clones keep their
id (connector glue resolves to the mapped spot) and paint LAST (pinned
furniture floats above the world, mirroring the live screen pass). Text
kinds are the documented exception: the DOM div keeps its STORED size
and CSS-scales via a per-object transform override (`scale(sx, sy)`),
because resizing a text div REFLOWS its content instead of scaling it.
Without a live viewport (headless callers) the mapping degrades to the
stored pixel size at the export scale — same anchor, fixed footprint.

### #48c — Pinned bounds never frame the export (no circularity), and PDF repeats them on every page

The export frame is computed from world content ONLY — even with
inclusion on: a mapped position is a fraction of the final image, so
letting it influence the bounds would be circular (the bounds size the
image that positions the object). Consequence: a pinned object whose
anchor maps outside the world content is CLIPPED at the image edge
(accept + document). In PDF frames-mode each page is its own image, so
the pinned overlay repeats at the same anchor on EVERY page — true to
"pinned to the screen" semantics; the dialog hint states it. Clipboard
selection snapshots UNPIN their subset clones (a snapshot is
world-space; the stored position is exactly where the object drops on
unpin). The minimap and the presentation view still show/omit pinned
objects at their stale world positions — pre-existing behaviour, left
for a follow-up round.

### #48d — The app shell mounts CLIENT-ONLY (no SSR hydration)

Every boot logged a React hydration error: the server-rendered
toolbar/menu markup disagreed with the client tree on Radix `useId`
values (the SSR and hydration passes assign different sibling positions
inside the Slot chains — `aria-controls`/`id` mismatches all the way
down). A full-viewport canvas editor has no SEO/first-paint stake in
SSR markup (Figma-class apps are client applications; the Tauri host
never used this route at all), so `page.tsx` now mounts the shell via
`next/dynamic` with `ssr: false`. The root layout still server-renders
`<html lang="fa" dir="rtl" class="dark">` + the themed `<body>`, so the
first byte stays dark/RTL (no flash); the SSR-safe `useSyncExternalStore`
patterns elsewhere keep working (they simply never run on a server).

### #49 — Minimap and presentation tell the truth about pinned objects (فاز ۲۹)

Two consumers still trusted the stale pre-pin world position of a
pinned object (D-#48c follow-up): the minimap drew ghosts at positions
where nothing renders (and a parked-away pin silently stretched the
map's frame), and presentation slide MEMBERSHIP was geometric over the
stale bbox — so a pinned sticky intersecting a frame mounted a DOM text
ghost on the slide. Both consumers now use the pin contract directly:

- **Minimap**: world content (visible + unpinned) fills and frames the
  map — `minimapContentBounds`. Each visible pinned object paints as an
  amber quad at its LIVE effective world position
  (`pinnedFootprintWorldQuad`: the screen footprint mapped through the
  CURRENT camera), so the footprint travels with the viewport
  rectangle as the camera moves — the map mirrors the real screen
  behaviour (the object follows the view) instead of inventing a world
  position. A scene with no world objects falls back to framing the
  current viewport (better than the "—" collapse: drag-to-pan keeps
  working, pins and the view stay visible).
- **Presentation**: `slideContent` filters pinned objects — screen
  furniture of the EDITOR is never slide content (the same default the
  export pipeline took in D-#48). A self-dismissing hint pill tells the
  presenter on enter when the scene carries pins. The HUD gained a
  segmented, clickable slide-progress strip (jump navigation).

The "live effective world position" reading is deliberately NOT
"include pins in exports"-style mapping: the minimap is a live
navigation surface, so it draws where the object IS (on screen, mapped
through the current camera), not where it WOULD land in a static file.

### #50 — Pinned objects rotate in SCREEN space around the footprint centre (فاز ۳۰)

The last pin transform limitation (D-#47b) is resolved: a single
selected pinned object now carries a round amber rotation grip above
its (tilted) top edge — `pinnedRotateHandleAnchor` mirrors the world
`rotateHandleAnchor` contract (a constant 24px screen offset along the
object's OWN up direction, so the affordance rides the tilt).

- **Pivot**: the footprint CENTRE, captured once at gesture begin — it
  is invariant under rotation (the anchor and size stay fixed), so the
  object spins IN PLACE on screen. This mirrors the world rotation
  pivoting around the bounds centre; no world coordinate is consulted
  (the stored `position` stays camera-stale while pinned, per D-#45).
- **One stored field**: the gesture writes ONLY `rotation` per frame —
  anchor, size and world position untouched — so undo/redo is a pure
  snapshot swap (`RotateCommand`), exact over long sequences. Live
  frames recompute from the before snapshot every move (no drift);
  `cancel()` restores without touching history (the Escape contract,
  D-#30).
- **Reuse over invention**: the `rotation` field already rendered in
  both pinned passes (the DOM text layer's transform and the canvas
  identity-camera pass) — only the AFFORDANCE was missing. The grip
  reuses the amber pin identity (D-#47c) and the `setRotating` glow
  pattern; the status-bar angle chip rides the existing
  `rotate:live`/`rotate:ended` events.
- **Inspector quick turns**: ±90° buttons + a 0° reset
  (`rotatePinnedBy`) cover the common screen-furniture angles with one
  undo step each; the precise numeric entry stays in the geometry
  section's rotation field (it always worked — setting `rotation` is
  kind-agnostic).

With this, pinned objects support the full transform trio on-screen:
move (فاز ۲۵), resize (فاز ۲۷) and rotate (فاز ۳۰) — the "unpin to
transform" era is over.

### #51 — The pins-only export frames the LIVE VIEWPORT; presentations gain the pin overlay (فاز ۳۱)

Two completions of the pinned-export story, both reusing فاز ۲۸'s
mapped-clone machinery rather than inventing new geometry:

- **The 0×0 edge made honest**: a board holding only pinned objects had
  NOTHING for the world bounds pass to frame (فاز ۲۸ correctly skips
  pins), so the dialog read «۰ × ۰ پیکسل» and the export button was
  dead weight. `computeExportBounds` now takes an optional
  `viewportWorldFrame` — when the region frames down to null while
  visible pinned objects exist, the LIVE CAMERA's viewport (world units,
  via the فاز ۲۹ `minimapViewportWorldBounds` helper) becomes the bounds.
  The pinned clones' anchor-fraction placement then maps 1:1 onto the
  user's actual view — the file is literally what's on screen. Guard
  rails: a truly empty board still fails with `no-content` (never frame
  a void), invisible pins don't count, and the fallback NEVER overrides
  real world content. Headless callers omit the frame and keep the
  legacy behaviour (node tests stay deterministic).
- **The presentation parity**: the same opt-in the exports took (فاز ۲۸)
  now exists in the deck — an amber `role=switch` in the presentation
  HUD, rendered ONLY while the presenting scene carries pins. Toggling
  re-rasters the slide through `exportToPng` with `includePinned` +
  `pinnedViewport` (the fullscreen overlay's window — the truth at
  presentation time), and the live DOM text layer composes the plan's
  pinned text objects AFTER the slide's world text with the plan's
  transform overrides (pinned furniture floats on top — the same
  z-order the raster paints). Session-scoped and reset-to-off on every
  entry: a deck stays clean by default (the فاز ۲۹ hint stays honest),
  the presenter opts in per run.
- **Badge honesty**: when the export bounds come from the viewport
  fallback, the dialog's size preview shows an amber «قاب نمای فعلی»
  pill (Scan icon) — a 2656×1170 number with no explanation reads as a
  bug; with the badge it reads as a choice.

### #52 — Dialogs can drag out; sticker inserts can be born pinned (فاز ۳۲)

The sticker picker was the last click-only insert surface (dialog
inserts always landed at the viewport centre). فاز ۳۲ closes the
rebuild-queue item with two rules:

- **The drag-out rides the InsertPanel card pattern, not HTML5 DnD.**
  A pointer press on an emoji cell (grid or recents) crosses a 5px
  threshold, captures the pointer, and spawns a GHOST — a portal-
  rendered chip at `z-[60]` so it rides above the Radix modal (the
  dialog's own `z-50` portal loses the stacking contest by design).
  Releasing inside the canvas rect converts the point through
  `camera.screenToWorld` and the shared `insertStickerObject` engine
  centres the sticker EXACTLY there — one `AddObjectCommand`, one
  undo step — and then CLOSES the picker: the modal's full-viewport
  scrim would otherwise sit over the placed sticker (the E2E caught
  this — the drop read as "empty black canvas" under the dim), and a
  drag-out means "place it and be done" anyway; the CLICK path keeps
  the multi-insert rhythm. Releases outside the rect cancel silently;
  Esc mid-drag cancels the ghost while the dialog's `onEscapeKeyDown`
  `preventDefault` keeps the picker open. A trailing compat click
  after a captured release is eaten by a suppress flag that the next
  `pointerdown` clears — no double inserts, in any browser.
- **Pinned inserts are an INSERT-TIME option, not a post-hoc toggle.**
  The footer's amber switch (session-scoped, reset-to-off per open —
  the فاز ۳۱ presentation precedent) makes `insertStickerObject`
  stamp `pinned: true` plus a `pinAnchor` derived by
  `pinnedStickerAnchor`: `(point − size/2) / viewport`, clamped by
  the shared `screenToPinAnchor` contract. The click path centres the
  viewport's screen point; the drag path centres the release point;
  the cascade fans out in SCREEN space so consecutive pinned picks
  never stack. The stored world position is the drop-point snapshot —
  rendering ignores it while pinned and unpinning recomputes it from
  the anchor (the فاز ۲۵ rule), so the value is advisory only. The
  ghost previews the mode: amber dashed ring + Pin badge while the
  switch is on, primary ring otherwise — the affordance tells the
  truth before the release.

### #53 — فاز ۳۳: opaque paint before emoji glyphs; insert-time sizes; the QA hook

- **Canvas composites colour emoji against the fill ALPHA, not its
  colour.** The R11.1 sticker plate painted with a 6%-alpha fillStyle
  and the emoji fillText inherited it — every sticker since the plate
  shipped rendered ghosted, and the previous E2E rounds' VLM
  "verification" hallucinated the glyph (pixel scans prove 0 warm
  pixels pre-fix). The contract is now pinned by
  `StickerGlyphPaint.test.ts`: NO fillText anywhere in a frame may
  carry an alpha-tagged fillStyle. Monochrome fallback fonts read the
  fill COLOUR, so the reset paint is the theme stroke (opaque in both
  palettes).
- **Insert-time sizes are options, not post-hoc resizes.** The three
  presets (48/96/160) clamp inside `insertStickerObject` — a bad value
  falls back to the default rather than refusing (never eat the
  user's emoji) — and the SAME value feeds the footprint factory and
  the pinned-anchor math, so the pinned path centres the chosen size
  exactly. The session-scoped segmented control resets to the classic
  middle preset per open (the فاز ۳۲ footer precedent); the ghost
  previews at the real size with a 40px floor.
- **QA state reads deserve a first-class seam.** `window.__qa` (dev
  builds only, idempotent, read-only, guarded) exposes the live
  scene/camera/selection — the standing 15-minute review loop should
  never again infer object counts from the status bar or reverse-
  engineer positions from canvas pixel histograms.

### #54 — فاز ۳۴: original bytes at import; the «زمان صفر» insert snapshot

- **"Original quality" means byte-identical, by default.** The Phase-23
  import cap (≤1600px, PNG/JPEG only) quietly re-encoded everything else
  and downscaled every 4K photo. The فاز ۳۴ contract inverts it: every
  decodable MIME (PNG/JPEG/WebP/AVIF/GIF/BMP/SVG) rides through as the
  EXACT original bytes while the decoded edge ≤4096px AND the file
  ≤2.5MB (`planImageImport` is the pure decision seam); only genuinely
  gigantic payloads take the proportional 4096-px fallback — the ~5MB
  localStorage autosave slot physically cannot hold more, and a write
  failure there is ANNOUNCED (`persistence:save-failed`), never silent.
  Honest boundary documented in KNOWN_LIMITATIONS, thresholds exported
  for tests.
- **The reset-to-insert reference is a snapshot taken at insert time, not
  a reconstruction.** `ImageObjectData.initial` captures the exact placed
  width/height/position (post-cascade, post-snap) and rotation at the
  moment the image enters THIS canvas; «بازنشانی به حالت درج» swaps one
  immutable snapshot through a single `ResizeCommand` (one undo step,
  drift exactly reversible). The field is optional and parsed
  defensively: legacy scenes simply lack it and degrade to the
  centre-preserving natural-size reset (فاز ۲۳) — no fabricated data.
  This keeps the user's mental model honest: "اندازهٔ اصلی" = intrinsic
  pixels; "حالت درج" = the time-zero placement; «بازنشانی نسبت» = keep
  width, restore ratio.

### #55 — فاز ۳۵: the rich copy-out is the inbound sanitizer's mirror

- **Outbound HTML must be as distrustworthy-safe as inbound HTML.** The
  same rules the فاز ۲۴ paste sanitizer enforces on the way IN apply to
  what we emit on the way OUT: every text node and attribute escaped
  (five entities), link schemes limited to http/https/mailto/relative
  (`javascript:` degrades to plain text, never an href), colours and
  alignment consciously omitted (the conservative core: headings, marks,
  lists, tables, blockquote, code, hr, dir). A consumer's document can
  never receive markup it did not parse from our serializer.
- **One atomic ClipboardItem, two flavors.** `text/html` + `text/plain`
  ride a single `navigator.clipboard.write` — Word/Outlook/AI chats read
  the structure while every plain-text consumer still finds the
  projection; the فاز ۲۶ tri-state returns `"unsupported"` on Firefox so
  the caller degrades to the plain write instead of losing the copy.
- **The decision table stays honest**: single image → original-quality
  PNG (فاز ۲۳); multi-object → rasterised snapshot (فاز ۲۴); single
  text-bearing object → rich HTML (فاز ۳۵, NEW); no text → plain text.
  Mixed multi-object selections deliberately keep the image path —
  flavour priority between image/html is consumer-specific and changing
  فاز ۲۴'s contract silently would be a regression, not a feature.

## #56 — فاز ۳۶: the Word export is a generated .docx, not a pretender (2026-09-16)

### Context

The user asked for tables to travel out "into a Word Office file". Two
paths existed: (a) ship an HTML blob renamed `.doc` (the classic trick
— Word shows a compatibility banner and re-parses HTML); (b) generate a
real Office Open XML package. The project's interop record (فاز ۲۳–۳۵)
is "the destination app receives the REAL thing" (intrinsic-size PNGs,
atomic dual-flavour clipboard items) — option (a) would break that
promise.

### Decision

1. **Real .docx, zero new dependencies**: a minimal ZIP writer (STORE +
   CRC-32, ~90 lines, deterministic timestamp) packs six static-XML
   parts. No `docx`/`jszip` npm dependency — the exporter stays
   node-testable and the bundle stays lean.
2. **Tables are `w:tbl`, fully**: the prosemirror model's omitted
   spanned cells are re-materialised as `w:vMerge` continuations by a
   pure grid walk; `colwidth` (drag-resized columns) travels as twips;
   `w:bidiVisual` rides the RTL default (the canvas renders column 1 on
   the right — Word must too).
3. **Scope resolution mirrors فاز ۳۵**: selection text-bearing objects
   when any are picked, else the whole scene. Non-text objects never
   enter the Word file (a rasterised snapshot is فاز ۲۴'s contract —
   mixing it here would silently change that decision table).
4. **RTL is auto-detected**, not assumed: paragraphs without a `dir`
   attr get `w:bidi` when their text contains RTL-script characters —
   mixed-language boards open correctly per paragraph.
5. **Filename stays ASCII** (`infinite-canvas-word.docx`): the toast
   explains the content in Persian; ASCII names survive every OS/zip
   encoding without mojibake.

### Consequences

- The export works in EVERY browser (a download needs no clipboard
  permission — it also covers the FirefoxClipboardItem gap for text).
- Colour/alignment of runs stay conservative (the فاز ۳۵ outbound
  policy): textStyle hex colours DO travel (direct formatting), but
  highlights/fonts beyond Consolas do not.
- `.docx` produced with STORE (no DEFLATE): a few KB larger than a
  compressed zip; Word/Word Online/LibreOffice accept it fine.

## #58 — فاز M2: the floating player + the offline converter (reconstructed 2026-09-17)

The M2 code shipped in-tree (FloatingPlayerWindow + FormatProbe +
VideoConverter + ConvertVideoDialog + `public/ffmpeg/`) but its decision
entry was lost to a session cut — reconstructed here because
THIRD_PARTY_NOTICES references it:

1. **The player is a React PORTAL, not a dialog**: screen-space, no scrim
   (the canvas stays interactive), title-bar drag + corner resize through
   hand-rolled pointer capture (the InsertPanel card-drag pattern — NO new
   dependency), one instance at a time through a single-id store slice.
2. **The blob URL lifecycle is strict**: the asset is fetched ONCE into a
   typed blob URL and revoked on every swap/close — zero leaked decoders.
3. **ffmpeg.wasm stays SINGLE-THREADED** (`@ffmpeg/core`, not core-mt):
   the multi-threaded build needs SharedArrayBuffer + COOP/COEP, which
   conflict with the Tauri asset protocol. The 32MB core is bundled in
   app resources (`public/ffmpeg/`), lazy-loaded on first conversion —
   never a CDN fetch.
4. **Settings persist in a dedicated localStorage slot**
   (`infinite-canvas-studio/player/v1`) — app data, never the project.

## #59 — فاز A1 «صوت روی بوم»: audio rides the video rails (2026-09-17)

The audio extension's PART A contract, resolved:

1. **AudioObject mirrors VideoObject field-for-field** (assetHash +
   thumbHash + originalName + mimeType + durationMs + placed width/height
   + optional origAssetHash) — the SAME sidecar AssetStore, PosterBitmapCache,
   placement core, aspect-lock gestures and export raster path. ZERO new
   storage/export machinery (RA1.1's "verify the store handles audio" —
   it does: the store is hash-keyed and content-agnostic; reads pass the
   object's MIME as the response-type hint).
2. **The waveform chip's intrinsic is 480×160 (3:1)** for BOTH the
   generated poster and the fallback plate — the placed footprint never
   jitters when a poster is absent.
3. **Waveform decoding uses a minimal OfflineAudioContext** (1 frame,
   44.1kHz) as a pure decoder host — no device, no permission prompt;
   ~200 max-amplitude buckets paint a centred coral bar field on a dark
   media plate (content, not chrome — dark on both themes).
4. **Extension matrix (Appendix A-1, binding)**: `.mp3/.m4a/.aac/.ogg`
   are the DIRECT set; `.wav/.flac` are the CONVERSION set (A2's gate);
   truly unknown extensions toast and create nothing. A video-TYPED File
   with an audio extension (a renamed `.mp4`) routes to conversion (the
   `-vn` strip case) in A2.
5. **Corrupt-file policy (fixture d)**: a decode failure on a
   probe-passed file keeps the A.2.2 icon-fallback object AND fires the
   Persian error notice «موج صدا ساخته نشد…» — "import error, no crash"
   without violating A.2.2's lenient fallback.
6. **Seam discipline (§1.7.1, the M1 precedent)**: the audio type ships
   as NEW files + registry entry + the additive icon/label map lines
   (LayersPanel KIND_ICONS/KIND_LABEL_KEYS, InsertPanel CARD_ICONS +
   insertCommandId case) — no dispatch logic was touched anywhere.
7. **E2E-found P0 fixed surgically**: double-clicking an audio thumbnail
   fell through SelectTool.onDoubleClick to the empty-canvas text-box
   creation (an unwanted text box appeared). The audio branch now
   early-returns — the documented A1 no-op (A2 wires the player there).
8. **Schema v5** through a normalising MigrationV4toV5 (the V3→V4 shape):
   existing files walk untouched; `core.audio` optional hashes coalesce.

## #60 — فاز A2 «پخش‌کنندهٔ صوت»: one engine, one player, one funnel — the completion contract (2026-09-17)

1. **The mini-player is the video window's twin, not a fork**:
   FloatingMiniPlayer reuses FloatingPlayerWindow's discovered
   mechanism verbatim (title-bar drag + corner resize with hand-rolled
   pointer capture, Esc document listener, blob-URL lifecycle) at
   audio proportions — min 320×100, default 400×120, NO fullscreen.
   Zero new dependencies (A.2.9).
2. **ONE instance ACROSS players, not just among audio players**: the
   store owns the hand-off — `openAudioPlayer` clears `playerVideoId`
   and vice-versa. Opening the mini-player closes the video window;
   opening the video window closes the mini-player. One floating media
   surface at a time, whatever its kind.
3. **The conversion runs on THE SHARED engine, structurally**:
   `AudioConverter.ensureEngine()` calls the PUBLIC
   `videoConverter.ensureLoaded()` — the same lazy-loaded,
   app-resources-fetched, single-threaded `@ffmpeg/core` instance. A
   second ffmpeg CANNOT exist by construction (there is no second load
   path anywhere in the audio profile). Progress rides a second
   `on("progress")` listener on the shared emitter; a CANCEL terminates
   the shared engine (the video converter's own cancel semantic — both
   converters lazy-reload it on the next run).
4. **The input's temp name keeps its REAL extension** (E2E-found): the
   wasm core probes containers extension-first; a bare `audio-input.bin`
   made ffmpeg fail with "Invalid data found when processing input" on
   .wav/.flac payloads. The input lands as `audio-input.wav`/`.flac`
   (a video-typed mislabel honestly lands as `.mp4` so the mov demuxer
   engages — fixture e's `-vn` strip).
5. **The gate is a DIALOG, not a silent conversion** (RA2.5): the user
   sees «تبدیل به MP3 (آفلاین)» / «انصراف» BEFORE any engine load.
   Cancelling creates NOTHING — no object, no temp files, no engine
   load. The queue lives in UI-store view state (never persisted).
6. **The original is KEPT** (A.2.5): the sidecar stores the source file
   next to the converted MP3 (`origAssetHash`); the object points at
   the converted asset with `originalName` preserved for display. The
   artist can always re-convert or extract the original later.
7. **Probe policy (Appendix A-1 as code)**: `.wav`/`.flac` ALWAYS
   convert; `.mp3/.m4a/.aac/.ogg` probe through a detached
   `<audio>`'s `canPlayType` — a refused probe queues for conversion;
   an audio-TYPED file with a foreign extension (.opus/.weba) gets the
   Persian rejection toast; a generic octet-stream file with an unknown
   extension belongs to NO pipeline (silently ignored — the audio
   filter never hijacks foreign payloads).
8. **Closing the mini-player STOPS playback** (A.3 NON-GOALS honored):
   the `<audio>` element exists only while the window is open; the blob
   URL is revoked on close. No background audio, ever.
9. **Settings live in the dedicated slot**
   `infinite-canvas-studio/mini-player/v1` (the video player's
   `playerSettings` pattern): position/size/volume/speed/muted persist
   across restarts; first open centers the window (0,0 = "unset").

## #63 — فاز D1 «دسکتاپ کامل»: the fs-backed AssetStore twin — the `icbasset` protocol (2026-09-18)

The web shell keeps asset bytes on the Next.js server (`/api/assets/*`
guarded by `lib/serverAssets.ts`), but the desktop exe has NO server —
media imports (image posters, audio, video, PDF) were the last gap
between the two shells. The twin registers behind the SAME
`Services.assetStore` seam (a 3-line composition-root swap guarded by
`isTauriEnvironment()`); `WebAssetStore`, the web routes and every
consumer stay untouched.

- **Reads stream through a custom `icbasset` scheme**, not the built-in
  asset protocol: the URL carries ONLY the hash (+ optional
  `project`/`mime` query) and the Rust handler resolves the scope chain
  [project sidecar, inbox] itself — so a Save-As relocation NEVER
  invalidates a URL (the web twin's exact semantics), and no runtime
  scope juggling is needed. `Range` requests are answered as bounded
  206 slices (8 MiB cap) so `<video>` seeking works without ever
  buffering a whole file; non-range `GET`s return the full body (pdf.js
  blob reads, posters). CORS headers are set explicitly because the
  page origin (`http://tauri.localhost`) and the protocol origin
  (`http://icbasset.localhost`) differ on Windows — WebView2 `fetch`
  would otherwise block the PDF byte reads.
- **Writes are chunked IPC**: `asset_write_chunk(scope, hash, offset,
  base64)` — 4 MiB per call (a 500 MB video streams through ~125
  sequential invokes), offsets make an interrupted import safely
  resumable, and content addressing guarantees every offset always
  receives the same bytes for the same hash (idempotent overwrite).
- **The inbox lives at `<appData>/media-inbox`** (the A.2.1 desktop
  twin of the web shell's server-side inbox): persistent across
  reboots — unsaved imports survive restarts on desktop better than
  the web shell's tmpdir inbox. The first Save As MOVES (rename with a
  cross-volume copy fallback); a later Save As COPIES — one IPC
  (`asset_relocate`) executes the whole batch, mode decided TS-side.
- **Guards mirror the server routes byte-for-byte**: asset file names
  must be exactly 64 lower-case hex chars (bytewise, no regex), sidecar
  scopes must end with `.assets`, and the inbox is resolved Rust-side
  (`app.path().app_data_dir()`) — the TS store never needs the path.
- **`assetUrl` stays SYNC**: `window.__TAURI_INTERNALS__.convertFileSrc`
  is injected before any app script runs (the `@tauri-apps/api/core`
  `convertFileSrc` is exactly this call), with a UA-based fallback
  mirroring wry's platform mapping (`http://icbasset.localhost/` on
  Windows/Android, `icbasset://localhost/` elsewhere).
- **Verification without a Rust toolchain** (this box has neither cargo
  nor webkit2gtk): every API used — `register_uri_scheme_protocol`
  (handler `(UriSchemeContext, Request<Vec<u8>>) -> Response<T>`),
  `UriSchemeContext::app_handle`, the generic
  `impl CommandArg for AppHandle<R>`, `generate_handler!`'s `syn::Path`
  entries and `Manager::path().app_data_dir()` — was checked against
  the actual `tauri-2.9.5` + `tauri-macros-2.6.3` crate sources before
  writing the code; the TS twin carries 18 unit tests (chunk
  offsets/base64 round-trip, scope switch, move/copy modes, URL
  formats), and the desktop bundle compiles (`vite build` green).

## #64 — دورهٔ اصلاح ۱ «پنجره‌ها بسته می‌شوند»: pointer-capture clicks, the CSSOM `inset` trap, and the first-drag origin (2026-09-18)

The first exe test round (user report) surfaced two browser-agnostic
defects the web E2E had structurally missed: the floating windows could
not be closed by their × button, and double-clicking a PDF "did nothing".
Both were verified FIRST on the plain web shell (they were never
exe-specific), then fixed and re-verified on the web shell AND on a new
desktop simulation.

- **The × buttons (all three windows) died to pointer-capture
  retargeting**: the title-bar drag calls
  `bar.setPointerCapture(pointerId)`; when the pointerdown started on
  the bar's × BUTTON, the pointerup retargeted to the bar and the
  `click` fired on their nearest common inclusive ancestor — the bar —
  so the button's `onClick` never ran (Esc still worked; the E2E had
  always closed via Esc). The fix is the standard interactive-descendant
  guard (`titleBarDrag.ts`): a pointerdown that starts on a
  button/input/link/menu simply never starts the drag. The InsertPanel
  cards and StickerPicker never had the bug because they capture on the
  ELEMENT that received the pointerdown.
- **The PDF viewer was mounting OFF-SCREEN** (why dblclick "did
  nothing"): its inline style ended with `position: "fixed", inset:
  "auto"` — the CSSOM shorthand `inset` re-assigns all four offsets
  AFTER the earlier `left`/`top` keys, wiping them to `auto`; a fixed
  box with all offsets auto renders at its STATIC flow position (below
  the app content). The viewer was loading and rendering its text layer
  invisibly — the E2E had asserted the DOM (207 spans) but never the
  on-screen rect. The window now mirrors the video/audio players'
  proven pattern (`fixed` class + left/top only) and the FULLSCREEN
  branch owns `inset-0 h-full w-full` (the old base class had dropped
  inset-0 for the non-fullscreen case entirely).
- **First-drag origin**: while the persisted x/y are still the 0/0
  "centre me" sentinel, the window is DISPLAYED centred — the drag
  origin is now that displayed position (`displayedPosRef`, the
  codebase's render-body ref precedent), so the first drag moves the
  window instead of teleporting it to the raw delta.
- **Explorer drag-and-drop in the exe**: Tauri 2's `dragDropEnabled`
  defaults to true — the WebView intercepts OS drops and the HTML5
  `drop` events the import funnel listens for never fire inside the
  exe. `tauri.conf.json` now sets `"dragDropEnabled": false` on the
  main window (no Tauri-side drop consumer exists; the funnel's own
  document-level listeners do the work).
- **Desktop verification without Windows** —
  `scripts/desktop-sim/server.js`: the VITE desktop bundle served with
  an injected `__TAURI_INTERNALS__` shim (convertFileSrc/invoke/
  transformCallback) plus Node twins of `icbasset` and the asset IPC
  commands. The full desktop chain — chunked IPC writes → hash URLs →
  fetch → viewer/player/posters — is now E2E-verifiable on any box.
  The sim round confirmed: boot `{"platform":"tauri"}`, PDF import →
  inbox bytes on disk, on-screen viewer with a 207-span text layer, ×
  closes, wheel page-flips render AND store page posters, the video
  player becomes ready, and an Explorer-style drop imports through the
  real funnel.

## #65 — دورهٔ اصلاح ۲ «متن فارسی»: the pdf.js v6 text-layer CSS contract + the reference viewer's selection machinery (2026-09-18)

The second exe report: the floating PDF viewer (now on-screen, fix1) shows
«متن فارسی به‌هم‌ریخته» and its text «قابل سلکت نیست». The diagnosis ran
on a REAL Persian fixture (Chromium print-to-PDF with embedded Vazirmatn,
generated in-environment) against the desktop sim, and every fix was
validated against a REFERENCE harness built on pdf.js's own
pdf_viewer.css before touching the app.

- **Root cause — a CSS contract violation, not a rendering bug.** pdf.js
  v6's `TextLayer` positions text through CSS custom properties: the
  layer's own box resolves `round(down, var(--total-scale-factor) *
  595px, var(--scale-round-x))` (setLayerDimensions), and every span
  gets `font-size: calc(var(--text-scale-factor) * var(--font-height))`
  plus a measured `transform: rotate/scaleX`. Our P2-era
  `.pdf-text-layer` declared NONE of that machinery. The app even set
  `--scale-factor` on the host (the right var!) — but nothing consumed
  it. Measured consequences: the layer's box drifted up to ~24px off the
  canvas (the invalid round() fell back against RTL over-constraint
  resolution), spans kept the inherited ~16px font size (the PDF's runs
  are ~21px) and no scaleX — so selection highlights painted BESIDE the
  glyphs and drag hit-boxes landed in the line gaps.
- **The fix is a faithful v6 port of pdf_viewer.css's `.textLayer`**,
  renamed `.pdf-text-layer`: the `--scale-factor` → `--total-scale-factor`
  bridge (exactly the `.page` rule), `--scale-round-x/y: 1px`, the
  per-span font-size + rotate/scaleX transform rules, `.markedContent
  { display: contents }`, explicit `user-select: text`, `direction: ltr`
  containment (the reference pins its pages LTR so RTL chrome never
  leaks into text geometry), and a VALID selection color (`color-mix`,
  not `hsl()` wrapping Tailwind 4's oklch var). Pixel-verified after:
  layer box == canvas box EXACTLY, span0 at 21.09px with
  matrix(0.876,…) — bit-identical to the reference harness numbers.
- **The selection UX is not part of the `TextLayer` class** — the
  reference ships it in TextLayerBuilder, which raw-API users must port
  themselves. New `src/ui/player/textLayerSelection.ts`: the
  `.endOfContent` bridge + `selecting` state machine + the `copy` handler
  (`normalizeUnicode` + `removeNullCharacters`), plus the
  pre-Chromium-148 moving-endDiv workaround, guarded the same way. The
  copy fold is EXTENDED over pdf.js's narrow list to BOTH Arabic
  presentation blocks (U+FB50–FDFF, U+FE70–FEFF): logical-order PDFs
  pass through untouched, visual-order PDFs at least paste real Persian
  letters. (Found in passing: pdf.js's own ligature map returns the
  string "undefined" for repeated ﬅ runs — our port maps each.)
- **Parity decisions (measured, not assumed)**: a drag that STARTS on a
  text run selects through everything crossed (452 chars, same as the
  reference); a drag past the last run extends to the page end (716
  chars, the endOfContent bridge). A drag that starts on EMPTY SPACE
  selects nothing in the reference viewer too — generic Chromium
  behavior for absolutely-positioned text; we ship the same behavior
  rather than inventing a non-standard workaround.
- **Regression guards**: tests/ui/player/pdfTextLayerCss.test.ts pins
  the whole CSS contract to globals.css (the class of bug this round
  shipped with — silent, invisible to unit tests, invisible to
  span-counting E2E — is now a failing test), and
  tests/ui/player/textLayerSelection.test.ts covers the machinery's
  lifecycle + the Unicode fold.
