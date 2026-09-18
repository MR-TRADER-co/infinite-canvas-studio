# SEAMS — Extension Points (the living Phase 9/10 spec)

> Phase 3B.5 deliverable (R3B5.5). This document lists EVERY extension
> point the app exposes after the command-layer retrofit, and what a
> future plugin will be able to hook into. It is updated as each seam
> lands; the plugin runtime itself (manifest, sandbox, permissions) is
> Phases 9–10 scope and deliberately NOT built here.

## 1. Commands (live)

**Where**: `src/core/registry/CommandRegistry.ts` (the registry),
`src/interaction/dispatch/CommandDispatcher.ts` (the single execution
funnel), `src/interaction/dispatch/commands.ts` (the core catalog),
registered at boot in `src/App.ts` (`registerCommandLayer`) and exposed
as the services `Services.commands` / `Services.commandDispatcher`.

**Contract**: a command is
`{id, titleKey (i18n), icon?, shortcut?, group, order, execute(ctx), isEnabled?(ctx)}`.

- **Ids** follow `owner.name` (hierarchical names allowed —
  `core.text.bold`, `core.selection.bringFront`). The `core.` owner is
  RESERVED for the first-party app; other owners are rejected until the
  plugin runtime owns its namespace (§1.7.2).
- **Shortcuts** use the `Mod-/Alt-/Shift-` + physical-key notation
  (`Mod-Shift-Z`, `Escape`, `v`). Conflicts are detected at REGISTRATION
  time (registration throws + logs through the logger sink);
  `normaliseShortcut` unifies Mod ≡ Ctrl ≡ Cmd and `+` ≡ `-`.
- **Execution**: one funnel — `dispatcher.dispatch(id, ctx)`. Toolbar
  buttons, menu items, the global keyboard handlers and the future
  command palette (Phase 7) all execute IDENTICALLY through it.
- **Context**: `{ services: AppContext }` — commands resolve their
  dependencies lazily through the typed service locator; UI behaviours
  (tool activation, dialog intents, editor actions) arrive through the
  composition-root wiring (`CoreCommandWiring`), never direct imports.

**Current surface** (the `core.*` catalog, ~45 commands):
`core.edit.*` (undo/redo/save), `core.view.*` (zoom in/out/reset/fit,
grid), `core.selection.*` (select-all/clear/duplicate/delete ×2 keys/
group/ungroup/lock/z-order ×4), `core.tools.*` (9 tools, plain-key
shortcuts), `core.text.*` (18 editor actions + the Enter edit-selection
entry + the link dialog), `core.find.open` (Ctrl+F).

**How a plugin will hook in**: register commands under its own owner
(`myplugin.panel.foo`) once the CommandRegistry opens third-party owners
(Phase 9); they appear in every registry-rendered surface automatically —
SelectionActions already proves the pattern (a late-registered entry in
the `selection` group appears with zero surface-code edits, and responds
to its shortcut via the dispatcher).

## 2. Events (live)

**Where**: `src/core/events/EventBus.ts` (the typed map), emitted and
subscribed app-wide.

Typed payloads decouple feature modules: `text:edit-requested`,
`text:create-requested`, `sticky:/table:create-requested`,
`ui:tool-changed`, `ui:language/theme-changed`, `ui:notice` (with
`{name}` placeholder values), `ui:link-dialog-requested`,
`ui:find-requested`, `ui:open-link-confirmation`, `camera:changed`,
`scene:changed`, `history:changed`, `selection:changed`, resize/rotate
gesture events, `text:edit-began/ended`, persistence events,
`project:import/new/restored`.

**How a plugin will hook in**: subscribe to domain events (the same
`bus.on` API); Phase 9 adds a permissions-gated listener registration so
plugins only see the events their manifest allows.

## 3. Tools (live)

**Where**: `src/interaction/ToolManager.ts` + the per-tool classes
implementing the `Tool` interface (`onPointerDown/Move/Up`,
`onCancel?`, `onKeyDown?`).

Tools are constructor-injected (scene/history/ids/overlays/bus) and
activated by id through `ui:tool-changed` → `ToolManager.activate`.
A plugin adds a tool by implementing the interface and emitting its
activation event; the manager itself needs no edits (Phase 9 wraps this
in a ToolRegistry contribution).

## 4. Object model (LIVE since Phase 4 — the ObjectRegistry)

**Where**: `src/core/registry/ObjectRegistry.ts` (the registry),
`src/persistence/objectTypes.ts` (the core registrations),
`src/core/model/*` (the data contracts), the serializer
(`persistence/VersionedSerializer` + `migrations/`), the renderer lookup
(`Canvas2DRenderer.canvasDrawers`) and the DOM overlay (`TextLayerView`).

- **The registry is the ONLY (de)serialization dispatch** (§1.7.1): every
  object type registers `{ typeId (owner.name), kind, titleKey, version,
  migrations?, factory, serialize, deserialize, catalog? }`. Save looks
  entries up by in-memory `kind`; load by wire `typeId`. Adding an object
  type = a new file + one `register()` call — persistence code never
  edits (AC4.2 proven by the dummy-type round-trip test).
- Wire payloads carry `typeId` + `typeVersion`; unknown typeIds, future
  per-type versions and refused payloads all materialise
  `OpaqueObject` placeholders retaining the raw JSON verbatim (§1.7.4).
- The `plugins: {}` file section is a strict passthrough (never
  interpreted; survives load→save unchanged — §1.7.4).
- Third-party owners are rejected at registration until the Phase 9
  runtime constructs `new ObjectRegistry(true)`; owner attribution is
  enumerable (`entriesOfOwner`) for wholesale unregistration (§1.7.5).
- Insert-Panel catalog metadata (`catalog: { icon, titleKey, group,
  order, preview? }`) rides the entries (§1.7.7) — the Phase 7 Insert
  Panel will render EXCLUSIVELY from it.
- The renderer's per-kind dispatch remains a table lookup
  (`canvasDrawers`) — Phase 9 generalises it to registry contributions.
- In-memory `SceneObjectKind` stays a closed union for the CORE kinds;
  plugin types (Phase 9) carry their own kind strings (the registry's
  byKind index accepts any string).

## 5. Rich text schema (live)

**Where**: `src/text/editor/extensions/index.ts` (the TipTap extension
set of the ONE shared editor), `Direction` (per-block `dir` attributes),
`ListIndent`, the R3B.5 paste pipeline
(`pastePlanner` → `pasteSanitizer`).

TipTap's extension system is itself the seam: a plugin contributes nodes
/marks/commands through the same `createTextExtensions` list. The
paste sanitiser's allow-list (`pasteSanitizer.ts`) is the security
boundary for foreign content — new schema surfaces must extend it
deliberately.

## 6. i18n (LIVE since Phase 8 — mergeNamespace)

**Where**: `src/ui/i18n/{index,fa,en,numbers}.ts` — every visible string keys
into the dictionaries; `TranslationKey` is derived from the Persian
dictionary, so a missing key fails the typecheck. Phase 8's
`mergeNamespace(owner, dict)` is LIVE: external dictionaries merge at
runtime under `owner:key` namespaces — cross-owner conflicts are detected
and logged (first definition wins, core never shadowed), re-merging the
same owner REPLACES its namespace, `removeOwnerNamespace(owner)` uninstalls
it. `ownerOfKey(key)` probes ownership; `onNamespacesChanged` notifies
hosts. This is the API future plugin UI strings plug into (§1.7.2).

## 7. Panels & inspector sections (LIVE since Phase 7)

- `ui/registry/PanelRegistry` — `{id, titleKey, icon, component,
  placement: left|right|bottom, order, defaultOpen}` contributions; the
  `PanelContainer` dock renderer + `ui/panels/registerPanels.ts`
  registrations (Layers, Inspector, Search, Outline, Minimap, Insert,
  History). Open/closed state persists (localStorage). A plugin panel
  (Phase 9) registers here through its own owner namespace.
- `ui/registry/InspectorSectionRegistry` — `{id, target, component,
  order, titleKey?}` contributions resolved per selection kind
  (exact kind → `text` → `*`); the Inspector shell composes FROM the
  registry (`inspector/sections.tsx` holds the core sections).
- The Insert Panel catalog reads ObjectRegistry `catalog` metadata
  (including the `cards` variant lists, D-7.6) — plugin object types
  (Phase 9) will appear as cards with ZERO panel edits.
- The command palette (`ui/palette/CommandPalette.tsx`) renders the
  CommandRegistry ONLY (fuzzy search, shortcut hints, RTL).

## 7b. Settings sections (LIVE since Phase 8)

- `ui/registry/SettingsSectionRegistry` — `{id, titleKey, component,
  order}` contributions; the `SettingsDialog` composes FROM the registry
  (the dialog names NO section — AC8.3's zero-dialog-edits seam). Core
  sections live in `ui/settings/sections.tsx` (general, appearance,
  text, canvas, storage) and register through
  `ui/settings/registerSettings.ts`.
- Every setting reads/writes LIVE state (the UI store slices) — there is
  no Apply button; `ui/settings/settingsPersistence.ts` hydrates on boot
  and persists each change into APP data (localStorage — never the
  `.icb` project file).
- New settings arrive as new sections (a plugin's Phase 9 settings UI is
  a registration inside its iframe region).

## 7c. SQLite namespacing (LIVE since Phase 8 — DbAccess)

**Where**: `src/core/db/DbAccess.ts` — the `core_` table prefix is the
HOST's reserved namespace. Every host SQL statement flows through the
`DbAccess` gate, which REFUSES (fail-closed) any statement whose target
table is not `core_`-prefixed. The host migrations
(`core_versions` + its index) run once per instance. Phase 9's plugin
runtime receives its own DbAccess bound to the plugin's own prefix +
migrations — the isolation is structural, not conventional.
Backends: `tauri-plugin-sql` (`sqlite:appdata.db`) on the desktop shell;
the localStorage-backed `LocalSqlEngine` speaks the same statement
family on the web (both wrapped by `VersionHistoryService`).

## 8. Justified exceptions (see DECISIONS.md for the full audit)

- **Parametric gestures stay raw**: arrow-key nudging (dx/dy per press +
history coalescing) and Space hold-to-pan (transient mode with tool
restore) are handled by the keyboard host, not commands — a command
signature cannot carry per-press deltas.
- **The Inspector's whole-document formatting** applies PATCHES through
`UpdateObjectCommand`/`applyWholeDocumentFormat`, not the command
funnel — it is a property-panel surface, not an action surface; its
registry arrival is Phase 7's InspectorSectionRegistry.
- **The paste plan's tagged union** (`planClipboardPaste`) is a sum-type
action, not type dispatch — the R3B5.4 audit counts it as registry-style
dispatch.
- **Escaped flow**: `ProjectMenu.saveNow` returns a promise for its busy
state; commands return void, so this one menu action keeps its direct
service call (same undo/save semantics as `core.edit.save`).

## 9. Plugin runtime (LIVE since Phase 9 — the full authoring guide)

The extension seams above are now driven by real third-party code. A
plugin is discovered from a local package (zip / desktop folder / the
in-repo sample), validated, sandboxed, permission-checked, and able to
contribute commands, object types (WITH catalog cards), panels, settings
sections, storage and project data — all through a versioned SDK.

### 9.1 Package layout

```
<package root>/
  manifest.json     — required (see §9.2)
  entry.js          — the plugin's code (the manifest's `entry`)
  i18n/fa.json      — optional Persian dictionary
  i18n/en.json      — optional English dictionary
  icon.svg          — optional icon asset
```

Zips may wrap everything in ONE top-level folder (the common export
shape — the installer strips it).

### 9.2 Manifest

```json
{
  "id": "my-plugin",          // ^[a-z][a-z0-9_-]{1,48}$; NOT "core"/"core.*"; unique
  "name": "My Plugin",
  "version": "1.0.0",         // strict semver
  "sdkRange": "^1.0.0",       // caret or ">=x.y.z <a.b.c"; must intersect the host majors
  "permissions": ["storage"],  // storage | network | projectRead | projectWrite | datahub
  "dependencies": [],          // "other-plugin@^1.2.0" clauses; must be installed
  "entry": "entry.js"
}
```

Every validation failure is a Persian sentence the install dialog shows
verbatim.

### 9.3 The entry contract

`entry.js` defines a global `pluginMain(app)` (the bootstrap calls it;
the global `app` is also available):

```js
function pluginMain(app) {
  if (app.region) {
    // REGION MODE: this sandbox is a UI region (panel body or settings
    // section) — paint your UI into document.body. app.region.id
    // distinguishes panel:<id> from settings:<id>.
    return;
  }
  // HEADLESS MODE: register your contributions.
  app.objects.register({ id: "star", titleKey: "my-plugin:star.title", ... });
  app.commands.register({ id: "insertStar", titleKey: "my-plugin:cmd", execute: ... });
  app.panels.register({ id: "shapes", titleKey: "my-plugin:panel", placement: "right" });
  app.settings.register({ id: "appearance", titleKey: "my-plugin:settings" });
}
```

### 9.4 The SDK surface (major version 1)

| Surface | Notes |
|---------|-------|
| `app.commands.register({id, titleKey, icon?, shortcut?, execute})` | final id `<pluginId>.<id>`; toolbar strip + palette |
| `app.commands.execute(fullId)` | any registered command |
| `app.objects.register({id, titleKey, group?, order?, icon?, preview?, width?, height?, factory, renderWidget?})` | the Insert Panel shows the card automatically; `factory(point)` returns the plugin payload (async ok); `renderWidget(data, size)` returns display HTML |
| `app.objects.create(localTypeId, point?)` | async insert (2 s guard, one undo); omit point for the viewport centre |
| `app.objects.get/list/update/remove` | CRUD (plugin-owned objects only for update/remove; one undo step each) |
| `app.selection.ids()/on(cb)` | live selection |
| `app.panels.register({id, titleKey, icon?, placement, order?})` | the body is the plugin's own iframe region |
| `app.settings.register({id, titleKey, order?})` | rendered inside the plugin's region in the dialog |
| `app.storage.get/set/delete` | namespaced KV — permission `storage` |
| `app.storage.sql(statements)` | the mini row-table engine (CREATE TABLE/DROP/INSERT/SELECT/UPDATE/DELETE with `= ?` and `AND`; Persian errors on anything else) — permission `storage` |
| `app.events.on(appEvent, cb)` | allowlist only: app:started, ui:language-changed, ui:theme-changed, camera:changed, scene:changed, selection:changed, history:changed, project:document-changed, bookmarks:changed, persistence:saved |
| `app.project.read()/write(data)` | the plugin's OWN section in the file's `plugins` passthrough — permissions projectRead/projectWrite |
| `app.i18n.merge({fa, en})` | runtime merge under `<pluginId>:key` (conflicts reported, core never shadowed) |
| `app.network.fetch(url)` | EXTERNAL http(s) only — permission `network`; the app core stays offline |
| `app.region` (regions only) | `{id, post(msg), onMessage(cb)}` |
| `app.scene.insertText({text, width?, fontSize?, position?, props?, select?})` | REAL plain-text box (one undo step; caps: text 8000, width 40..2000, fontSize 8..96) — permission `scene` (pack-14) |
| `app.scene.insertFrame({title?, width?, height?, position?, layout?, props?})` | REAL frame, optionally auto-layout ({dir, gap, padding, itemWidth?}) — permission `scene` |
| `app.scene.addLink({sourceId, targetId, label?})` | plugin-owned registry link (kind "plugin", owner = the plugin; ONE undo step) — permission `scene` |
| `app.scene.listLinks({ownerId?, sourceId?, targetId?})` | read-only registry query — permission `scene` |
| `app.scene.removeLinksByOwner()` | removes every link this plugin owns — permission `scene` |
| `app.scene.focusObject(objectId)` | camera flight + highlight — permission `scene` |
| `app.scene.notifyInfo(message)` | Persian info toast (300-char cap) — permission `scene` |

### 9.5 Sandbox + security model

- Plugin code runs in `<iframe sandbox="allow-scripts">` — NO
  `allow-same-origin`: opaque origin, zero access to app globals, DOM,
  storage or Tauri APIs.
- ALL host↔plugin traffic is the versioned JSON bridge (§9.6) — no
  shared objects cross the boundary.
- Widget views on the canvas are INERT iframes (`sandbox=""`): display
  snapshots only, no scripts. The catalog renders from packaged
  metadata — ZERO plugin messages while it renders/scrolls/filters.
- A plugin crash/timeout NEVER crashes the app: errors land in the
  Plugin Manager; a 2 s factory guard leaves no partial object.

### 9.6 The bridge protocol (v1)

Frames: `hello` (host→plugin identity + SDK major), `ready`
(plugin→host), `req`/`res` (RPC, either direction, typed errors
`{code, message}`), `evt` (one-way pushes). Every frame carries
`v: 1`; malformed frames are dropped fail-closed. The plugin-side shim
is embedded in the sandbox srcdoc (a hand-rolled twin of the canonical
TS shim `plugins/sdk/createPluginSdk.ts` — same wire surface).

### 9.7 Lifecycle semantics

- **install** → validate + consent (every manifest permission in plain
  Persian; partial consent aborts) → record → enable;
- **disable** → every contribution unregisters (commands/types/panels/
  settings/i18n/events); links owned by the plugin are removed from the
  registry (pack-14 AC14.6); existing objects stay in the file (reload →
  opaque placeholders until the plugin returns);
- **uninstall** → disable + storage ARCHIVED (restorable) + record
  removed; the project file's plugin section is never touched;
- **restore** → reinstall from the archive + storage returns exactly.

### 9.8 Permissions

Declared in the manifest, consented at install (the dialog lists each
in plain Persian), enforced at EVERY bridge dispatch (fail-closed typed
errors). `datahub` is declared now for Phase 10.

### 9.9 The sample plugin

`public/plugins-sample/sticky-shape-pack/` — the official example
exercising every surface: 3 decorative shape types with catalog cards,
an insert command, a panel, a settings section, colour persistence.
Install it from the Plugin Manager («افزونه‌ها» panel → ⬆ → «نصب
افزونهٔ نمونه»).

## Media extensions — the PDF rails (فاز P1/P2)

The PDF extension (v1.47.0) rides the SAME seams as video/audio — a
future media type repeats this exact chain with zero dispatch edits:

- **Object type**: `core.pdf` registered through `ObjectRegistry`
  (factory/serialize/deserialize + catalog metadata) — the Insert
  Panel card, the layers icon and the persistence all appear through
  the registry; `core.insert.pdf` is the card's command (opens the
  file picker).
- **Bytes**: the sidecar `AssetStore` (`Services.assetStore`) —
  content-addressed, deduped, relocated on Save As through
  `collectPdfAssetHashes` joined to the shared manifest.
- **Posters**: `Services.pdfRenderer` (`media/PdfRenderer.ts`) — the
  lazy pdf.js wrapper (worker bundled at `public/pdfjs/`); page
  posters are store assets; the canvas decodes them through the
  shared `posterBitmapCache`; `media/PdfPageCache.ts` maps
  (asset, page) → poster hash (flip-backs never re-render).
- **Viewer**: `ui/player/FloatingPdfViewer.tsx` — the THIRD floating
  window (video/audio/PDF) behind the single-id `uiStore` hand-off;
  settings in the `pdf-viewer/v1` app-data slot; page flips (wheel on
  canvas OR viewer navigation) commit through the shared
  `UpdateObjectCommand` seam (`currentPage`/`thumbHash` fields).

## The desktop asset twin — the `icbasset` rails (فاز D1)

The AssetStore seam has TWO implementations behind the one
`Services.assetStore` key, and nothing downstream knows which one is
live:

- **Web shell**: `WebAssetStore` → the `/api/assets/*` routes
  (`lib/serverAssets.ts`, LocalFsBridge-guarded).
- **Desktop shell (exe)**: `TauriAssetStore` → the Rust module
  `src-tauri/src/assets.rs`: WRITES stream as 4 MiB base64 chunks
  through the `asset_write_chunk` IPC (offset-based — resumable and
  idempotent under content addressing); READS stream through the
  custom `icbasset` scheme where the URL carries only the hash and
  the handler resolves [project sidecar, inbox] itself (a Save-As
  relocation never changes a URL), answering `Range` requests as
  bounded 206 slices; `asset_relocate` executes the A.2.1 move/copy
  batch. The composition root picks the twin with one
  `isTauriEnvironment()` guard (App.ts) — the selection is the ONLY
  desktop-aware line in the whole media stack.

Inbox: `<appData>/media-inbox` (Rust-resolved — the TS store never
holds the path). Guards on both halves are identical: 64-hex asset
names, `.assets` sidecar suffixes, hash-verified writes.
