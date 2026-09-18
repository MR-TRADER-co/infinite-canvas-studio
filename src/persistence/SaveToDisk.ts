/**
 * Save-to-disk: writes the current project to a user-chosen location in the
 * app's own `.icb` format (the versioned JSON envelope produced by
 * {@link VersionedSerializer}).
 *
 * Two address modes, one per shell:
 * - **Desktop (Tauri)**: the user types an absolute path; the payload is
 *   written by the `save_text_file` IPC command (see `src-tauri/src/lib.rs`)
 *   which creates parent directories as needed. This is the "آدرسی که بهش
 *   میدم" flow — the typed address IS the write target.
 * - **Web**: browsers cannot write to arbitrary typed paths, so the
 *   equivalent of "giving an address" is the File System Access save picker
 *   (`showSaveFilePicker`) — a REAL folder + file-name choice that streams
 *   the payload to the chosen location. When the API is unavailable the
 *   caller falls back to a plain download.
 *
 * Pure path normalisation is separated from the platform dispatchers so the
 * rules (quote stripping, `.icb` extension policy) are unit-testable.
 */
import type { Scene } from "@/core/model/Scene";
import type { VersionedSerializer } from "@/persistence/VersionedSerializer";
import { buildProjectData } from "@/persistence/ProjectFile";
import type { Bookmark } from "@/core/bookmarks/BookmarkService";
import type { StylesSection } from "@/core/knowledge/StyleRegistry";
import type { PropertySchemaSection } from "@/core/model/Properties";
import type { LinksSection } from "@/core/knowledge/LinkRegistry";
import { isTauriEnvironment } from "@/platform/tauri/log";
import { saveFileDialog } from "@/platform/tauri/dialog";
import { saveViaLocalFsBridge } from "@/persistence/LocalFsBridge";

/** Canonical extension of the app's project format. */
const ICB_EXTENSION = ".icb";

/** Filter group offered by the native OS save picker. */
const ICB_DIALOG_FILTER = [
  { name: "Infinite Canvas Project (.icb)", extensions: ["icb"] },
];

/**
 * The document sections riding EVERY disk save (the save-path fix):
 * bookmarks, named styles, the property schema and the link registry —
 * callers collect them from the composition root so no save path
 * (typed path / native dialog / web picker / download fallback) ever
 * silently drops a persisted section again.
 */
export interface ProjectSaveSections {
  /** Camera bookmarks (R7.9). */
  readonly bookmarks?: readonly Bookmark[];
  /** Named user styles (R13.3). */
  readonly styles?: StylesSection;
  /** Known property names → types (pack R11.3). */
  readonly propertySchema?: PropertySchemaSection;
  /** Manual/plugin links (pack R11.2, §1.7.8). */
  readonly links?: LinksSection;
}

/** Outcome of a save-to-disk attempt. */
export type SaveToDiskResult =
  | { readonly kind: "saved"; readonly path: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Normalises a user-typed save path into a canonical form, or rejects it.
 *
 * Rules (mirrored by unit tests):
 * - surrounding double quotes are stripped (Windows "Copy as path" pastes
 *   `"C:\…\board.icb"` with quotes),
 * - the `.icb` extension is enforced: appended when missing, REPLACED when
 *   a foreign extension was typed (the save format is app-defined; a
 *   `.txt` file would vanish from the open-dialog's `.icb` filter),
 * - paths that end in a separator (a directory, no file name), contain
 *   control characters or characters Windows forbids (`< > | ? * "`) are
 *   rejected.
 *
 * @param raw - the path exactly as typed by the user.
 * @returns the canonical path, or null when the input is unusable.
 */
export function normalizeSavePath(raw: string): string | null {
  let path = raw.trim();
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1).trim();
  }
  if (path.length === 0) {
    return null;
  }
  // Directory-only input ("C:\Users\me\Desktop\") — no file name to write.
  if (path.endsWith("/") || path.endsWith("\\")) {
    return null;
  }
  if (/[\u0000-\u001f<>|?*"]/.test(path)) {
    return null;
  }
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const fileName = path.slice(separator + 1);
  if (fileName.length === 0) {
    return null;
  }
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) {
    // No extension at all, or a hidden dot-name (".backup"): append the
    // format extension — the bare ".icb" dot-name is already the format.
    if (dot === 0 && fileName.toLowerCase() === ICB_EXTENSION) {
      return path;
    }
    return `${path}${ICB_EXTENSION}`;
  }
  const extension = fileName.slice(dot).toLowerCase();
  if (extension === ICB_EXTENSION) {
    return path;
  }
  // Foreign extension → enforce the app format.
  return `${path.slice(0, path.length - extension.length)}${ICB_EXTENSION}`;
}

/** Minimal structural type of `window.showSaveFilePicker` (portable). */
interface SaveFilePickerLike {
  readonly name: string;
  createWritable(): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
  }>;
}

/** Options accepted by the File System Access save picker. */
interface SavePickerOptionsLike {
  readonly suggestedName?: string;
  readonly types?: readonly {
    readonly description?: string;
    readonly accept: Record<string, readonly string[]>;
  }[];
}

/**
 * @returns the save picker when the environment exposes one, else null.
 */
function getSavePicker():
  ((options?: SavePickerOptionsLike) => Promise<SaveFilePickerLike>) | null {
  if (typeof window === "undefined") {
    return null;
  }
  const candidate = (window as unknown as { showSaveFilePicker?: unknown })
    .showSaveFilePicker;
  return typeof candidate === "function"
    ? (candidate as (
        options?: SavePickerOptionsLike,
      ) => Promise<SaveFilePickerLike>)
    : null;
}

/**
 * @param scene - the live scene to snapshot.
 * @param serializer - the project serializer producing the `.icb` payload.
 * @param plugins - the document's passthrough section (§1.7.4), written
 *        verbatim into the file's `plugins` field (R4.2).
 * @param sections - the document sections riding the save (bookmarks,
 *        styles, the property schema, the link registry — none when
 *        omitted, e.g. in unit tests).
 * @returns the serialised project file contents.
 */
export function serializeProjectFile(
  scene: Scene,
  serializer: VersionedSerializer,
  plugins?: Readonly<Record<string, unknown>>,
  sections?: ProjectSaveSections,
): string {
  return serializer.serialize(
    buildProjectData(
      scene,
      plugins,
      sections?.bookmarks,
      sections?.styles,
      sections?.propertySchema,
      sections?.links,
    ),
  );
}

/**
 * Saves the project at the typed absolute path — desktop shell only.
 *
 * @param scene - the live scene to snapshot.
 * @param serializer - the project serializer producing the `.icb` payload.
 * @param rawPath - the path exactly as typed by the user.
 * @param plugins - the document's passthrough section (§1.7.4).
 * @param sections - the document sections riding the save.
 * @returns the save outcome (`unsupported` on the web — the dialog routes
 *          web users to the system picker instead).
 */
export async function saveProjectToPath(
  scene: Scene,
  serializer: VersionedSerializer,
  rawPath: string,
  plugins?: Readonly<Record<string, unknown>>,
  sections?: ProjectSaveSections,
): Promise<SaveToDiskResult> {
  const path = normalizeSavePath(rawPath);
  if (path === null) {
    return { kind: "failed", reason: "invalid-path" };
  }
  if (!isTauriEnvironment()) {
    return { kind: "unsupported", reason: "web-cannot-write-typed-path" };
  }
  try {
    const core = await import("@tauri-apps/api/core");
    await core.invoke("save_text_file", {
      path,
      contents: serializeProjectFile(scene, serializer, plugins, sections),
    });
    return { kind: "saved", path };
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Saves the project through the NATIVE OS save dialog — desktop shell only,
 * the «پنجرهٔ ذخیرهٔ خود ویندوز» flow: the user browses the real folder tree
 * and names the file; the payload is then written at the picked path via
 * `save_text_file` (with the same `.icb` normalisation as the typed flow).
 *
 * @param scene - the live scene to snapshot.
 * @param serializer - the project serializer producing the `.icb` payload.
 * @param suggestedName - pre-filled file name in the native dialog.
 * @param plugins - the document's passthrough section (§1.7.4).
 * @param sections - the document sections riding the save.
 * @returns the save outcome (`cancelled` when the picker was closed,
 *          `unsupported` outside the desktop shell).
 */
export async function saveProjectViaNativeDialog(
  scene: Scene,
  serializer: VersionedSerializer,
  suggestedName: string,
  plugins?: Readonly<Record<string, unknown>>,
  sections?: ProjectSaveSections,
): Promise<SaveToDiskResult> {
  if (!isTauriEnvironment()) {
    return { kind: "unsupported", reason: "native-dialog-desktop-only" };
  }
  const picked = await saveFileDialog({
    defaultPath: suggestedName,
    filters: ICB_DIALOG_FILTER,
  });
  if (picked === null) {
    return { kind: "cancelled" };
  }
  return saveProjectToPath(scene, serializer, picked, plugins, sections);
}

/**
 * Saves the project through the system save picker (web shell): the user
 * navigates to a REAL folder and names the file — the web twin of "giving
 * an address". Requires the File System Access API (Chromium browsers,
 * top-level pages).
 *
 * @param scene - the live scene to snapshot.
 * @param serializer - the project serializer producing the `.icb` payload.
 * @param suggestedName - pre-filled file name in the picker.
 * @param plugins - the document's passthrough section (§1.7.4).
 * @param sections - the document sections riding the save.
 * @returns the save outcome (`cancelled` when the user closes the picker,
 *          `unsupported` when the API is absent — caller falls back to a
 *          plain download).
 */
export async function saveProjectViaPicker(
  scene: Scene,
  serializer: VersionedSerializer,
  suggestedName: string,
  plugins?: Readonly<Record<string, unknown>>,
  sections?: ProjectSaveSections,
): Promise<SaveToDiskResult> {
  const pick = getSavePicker();
  if (pick === null) {
    return { kind: "unsupported", reason: "no-file-system-access-api" };
  }
  let handle: SaveFilePickerLike;
  try {
    handle = await pick({
      suggestedName,
      types: [
        {
          description: "Infinite Canvas Project (.icb)",
          accept: { "application/json": [".icb"] },
        },
      ],
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "AbortError") {
      return { kind: "cancelled" };
    }
    return { kind: "failed", reason: name || String(error) };
  }
  try {
    const writable = await handle.createWritable();
    await writable.write(
      serializeProjectFile(scene, serializer, plugins, sections),
    );
    await writable.close();
    return { kind: "saved", path: handle.name };
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @returns whether the system save picker is available in this shell.
 */
export function hasSystemSavePicker(): boolean {
  return getSavePicker() !== null;
}

/**
 * Writes the project file at a KNOWN path through the shell's dispatcher
 * (R4.5: the Ctrl+S re-save path) — the desktop `save_text_file` IPC or
 * the local server bridge on the web. The document's passthrough section
 * rides along (§1.7.4) — and so does EVERY persisted document section
 * (bookmarks, styles, the property schema, the link registry).
 *
 * @param scene - the live scene to snapshot.
 * @param serializer - the project serializer.
 * @param rawPath - the absolute path (already normalised by the save flow
 *        that produced it).
 * @param plugins - the document's passthrough section.
 * @param sections - the document sections riding the save.
 * @returns the save outcome (`saved` carries the written path).
 */
export async function writeProjectFile(
  scene: Scene,
  serializer: VersionedSerializer,
  rawPath: string,
  plugins?: Readonly<Record<string, unknown>>,
  sections?: ProjectSaveSections,
): Promise<SaveToDiskResult> {
  if (isTauriEnvironment()) {
    return saveProjectToPath(scene, serializer, rawPath, plugins, sections);
  }
  const payload = serializeProjectFile(scene, serializer, plugins, sections);
  const result = await saveViaLocalFsBridge(rawPath, payload);
  return result.kind === "saved"
    ? { kind: "saved", path: result.path }
    : { kind: "failed", reason: result.code };
}
