/**
 * Plugin package readers (R9.1 install-from-zip / folder, R9.7 sample).
 *
 * A package is `manifest.json` + the entry JS + optional `i18n/<lang>.json`
 * dictionaries + an optional icon asset. Layouts:
 * - ZIP: the files at the archive root, or inside ONE top-level folder
 *   (common export shape — the common prefix is stripped);
 * - FOLDER: an absolute path read through the Tauri IPC (desktop shell;
 *   the web shell has no arbitrary-folder reads — the dialog says so);
 * - SAMPLE: the in-repo sample fetched from `/plugins-sample/` (offline
 *   public asset, R9.7).
 *
 * Layering: browser/Node-compatible TypeScript (fflate works in both).
 */
import { unzipSync } from "fflate";
import type { PluginPackage } from "@/plugins/host/LifecycleManager";
import type { OwnerDictionary } from "@/ui/i18n";

/** The maximum accepted zip size (MB, guards memory). */
const MAX_ZIP_BYTES = 8 * 1024 * 1024;

/**
 * Parses one plugin package out of unzipped entries.
 *
 * @param entries - the zip entries (path → bytes).
 * @returns the package, or a Persian error message.
 */
export function packageFromZipEntries(
  entries: ReadonlyMap<string, Uint8Array>,
): PluginPackage | { error: string } {
  const decoder = new TextDecoder();
  // Strip a single common top-level folder when every path shares one.
  const paths = [...entries.keys()].filter((path) => !path.endsWith("/"));
  const firstPath = paths[0];
  const folder =
    firstPath !== undefined && paths.every((path) => path.includes("/"))
      ? (firstPath.split("/")[0] ?? null)
      : null;
  const strip = (path: string): string =>
    folder !== null && path.startsWith(`${folder}/`)
      ? path.slice(folder.length + 1)
      : path;
  const files = new Map<string, string>();
  for (const [path, bytes] of entries) {
    if (path.endsWith("/") || path.startsWith("__MACOSX")) {
      continue;
    }
    const relative = strip(path);
    if (relative.length === 0) {
      continue;
    }
    files.set(relative, decoder.decode(bytes));
  }
  const manifestRaw = files.get("manifest.json");
  if (manifestRaw === undefined) {
    return { error: "فایل manifest.json در بسته پیدا نشد." };
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestRaw) as unknown;
  } catch {
    return { error: "فایل manifest.json قابل تجزیه نیست (JSON نامعتبر)." };
  }
  const manifest = manifestJson as { entry?: string; icon?: string };
  const entryPath =
    typeof manifest.entry === "string" && manifest.entry.length > 0
      ? manifest.entry
      : "entry.js";
  const entrySource = files.get(entryPath);
  if (entrySource === undefined) {
    return { error: `فایل ورودی «${entryPath}» در بسته پیدا نشد.` };
  }
  const mutableDictionaries: Record<string, Record<string, string>> = {};
  for (const language of ["fa", "en"] as const) {
    const raw = files.get(`i18n/${language}.json`);
    if (raw === undefined) {
      continue;
    }
    try {
      mutableDictionaries[language] = JSON.parse(raw) as Record<string, string>;
    } catch {
      return { error: `فایل i18n/${language}.json قابل تجزیه نیست.` };
    }
  }
  const dictionaries: OwnerDictionary = mutableDictionaries;
  let iconDataUrl: string | undefined;
  const iconPath = manifest.icon;
  if (typeof iconPath === "string" && iconPath.length > 0) {
    const icon = entries.get(
      folder !== null ? `${folder}/${iconPath}` : iconPath,
    );
    if (icon !== undefined) {
      iconDataUrl = `data:image/svg+xml;base64,${toBase64(icon)}`;
    }
  }
  return {
    manifestJson,
    entrySource,
    dictionaries,
    iconDataUrl,
  };
}

/**
 * Unzips + parses one plugin zip archive.
 *
 * @param archiveBytes - the raw zip bytes.
 * @returns the package, or a Persian error message.
 */
export function readPackageFromZip(
  archiveBytes: Uint8Array,
): PluginPackage | { error: string } {
  if (archiveBytes.byteLength > MAX_ZIP_BYTES) {
    return { error: "حجم بستهٔ افزونه بیش از حد مجاز (۸ مگابایت) است." };
  }
  try {
    const entries = unzipSync(archiveBytes);
    return packageFromZipEntries(
      new Map(Object.entries(entries)) as Map<string, Uint8Array>,
    );
  } catch {
    return { error: "فایل زیپ قابل خواندن نیست (آرشیو خراب است)." };
  }
}

/**
 * Reads one plugin package from a zip File (the browser upload path).
 *
 * @param file - the uploaded `.zip` file.
 * @returns the package, or a Persian error message.
 */
export async function readPackageFromZipFile(
  file: File,
): Promise<PluginPackage | { error: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return readPackageFromZip(bytes);
}

/**
 * Reads one plugin package from a FOLDER path (desktop shell only —
 * the Tauri IPC reads each member; the web shell lacks arbitrary
 * folder reads).
 *
 * @param folderPath - the plugin folder's absolute path.
 * @returns the package, or a Persian error message.
 */
export async function readPackageFromFolder(
  folderPath: string,
): Promise<PluginPackage | { error: string }> {
  const read = async (member: string): Promise<string> => {
    const { readProjectFileRaw } = await import("@/platform/tauri/openFile");
    const path = folderPath.replace(/[\\/]+$/, "") + "/" + member;
    return readProjectFileRaw(path);
  };
  let manifestRaw: string;
  try {
    manifestRaw = await read("manifest.json");
  } catch {
    return {
      error:
        "خواندن پوشه ممکن نیست — نصب از پوشه فقط در نسخهٔ دسکتاپ کار می‌کند (در وب از فایل زیپ استفاده کنید).",
    };
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestRaw) as unknown;
  } catch {
    return { error: "فایل manifest.json قابل تجزیه نیست (JSON نامعتبر)." };
  }
  const manifest = manifestJson as { entry?: string };
  const entryPath = manifest.entry ?? "entry.js";
  let entrySource: string;
  try {
    entrySource = await read(entryPath);
  } catch {
    return { error: `فایل ورودی «${entryPath}» در پوشه پیدا نشد.` };
  }
  const mutableDictionaries: Record<string, Record<string, string>> = {};
  for (const language of ["fa", "en"] as const) {
    try {
      mutableDictionaries[language] = JSON.parse(
        await read(`i18n/${language}.json`),
      ) as Record<string, string>;
    } catch {
      // Absent dictionary: skipped.
    }
  }
  const dictionaries: OwnerDictionary = mutableDictionaries;
  return { manifestJson, entrySource, dictionaries };
}

/**
 * Fetches the in-repo sample plugin (offline public asset, R9.7).
 *
 * @returns the sample package, or a Persian error message.
 */
export async function readSamplePackage(): Promise<
  PluginPackage | { error: string }
> {
  const base = "/plugins-sample/sticky-shape-pack";
  try {
    const [manifestResponse, entryResponse, faResponse, enResponse] =
      await Promise.all([
        fetch(`${base}/manifest.json`),
        fetch(`${base}/entry.js`),
        fetch(`${base}/i18n/fa.json`),
        fetch(`${base}/i18n/en.json`),
      ]);
    if (
      !manifestResponse.ok ||
      !entryResponse.ok ||
      !faResponse.ok ||
      !enResponse.ok
    ) {
      return { error: "بستهٔ افزونهٔ نمونه در این نصب موجود نیست." };
    }
    const manifestJson = (await manifestResponse.json()) as unknown;
    const entrySource = await entryResponse.text();
    const fa = (await faResponse.json()) as Record<string, string>;
    const en = (await enResponse.json()) as Record<string, string>;
    return {
      manifestJson,
      entrySource,
      dictionaries: { fa, en },
      iconDataUrl: `${base}/icon.svg`,
    };
  } catch {
    return { error: "خواندن افزونهٔ نمونه ممکن نشد." };
  }
}

/** The bundled first-party plugin ids (Phase 10). */
export const FIRSTPARTY_PLUGIN_IDS: readonly string[] = [
  "calendar",
  "planner",
  "reporter",
  "ai-analyst",
  "dailynotes",
] as const;

/**
 * Fetches one bundled FIRST-PARTY plugin (R10.3–R10.6 — real plugins
 * shipped with the app as offline public assets; installed through the
 * SAME consent flow as any third-party package).
 *
 * @param pluginId - one of {@link FIRSTPARTY_PLUGIN_IDS}.
 * @returns the package, or a Persian error message.
 */
export async function readFirstPartyPackage(
  pluginId: string,
): Promise<PluginPackage | { error: string }> {
  if (!FIRSTPARTY_PLUGIN_IDS.includes(pluginId)) {
    return { error: "افزونهٔ داخلی شناخته نشد." };
  }
  const base = `/plugins-firstparty/${pluginId}`;
  try {
    const [manifestResponse, entryResponse, faResponse, enResponse] =
      await Promise.all([
        fetch(`${base}/manifest.json`),
        fetch(`${base}/entry.js`),
        fetch(`${base}/i18n/fa.json`),
        fetch(`${base}/i18n/en.json`),
      ]);
    if (
      !manifestResponse.ok ||
      !entryResponse.ok ||
      !faResponse.ok ||
      !enResponse.ok
    ) {
      return { error: "بستهٔ افزونهٔ داخلی در این نصب موجود نیست." };
    }
    const manifestJson = (await manifestResponse.json()) as unknown;
    const entrySource = await entryResponse.text();
    const fa = (await faResponse.json()) as Record<string, string>;
    const en = (await enResponse.json()) as Record<string, string>;
    return {
      manifestJson,
      entrySource,
      dictionaries: { fa, en },
      iconDataUrl: `${base}/icon.svg`,
    };
  } catch {
    return { error: "خواندن افزونهٔ داخلی ممکن نشد." };
  }
}

/**
 * @param bytes - raw bytes.
 * @returns the base64 form (btoa when available, Buffer otherwise).
 */
function toBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}
