/**
 * Unit tests for the save-to-disk path policy and web dispatch branches:
 * quote stripping (Windows "Copy as path"), the .icb extension policy,
 * directory-only / forbidden-character rejection, the web-shell behaviour
 * of the two platform dispatchers (jsdom = web, no Tauri, no File System
 * Access API → `unsupported`), and the desktop NATIVE-picker flow (the
 * «پنجرهٔ ذخیرهٔ خود ویندوز» → `save_text_file` IPC write).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasSystemSavePicker,
  normalizeSavePath,
  saveProjectToPath,
  saveProjectViaNativeDialog,
  saveProjectViaPicker,
  serializeProjectFile,
} from "@/persistence/SaveToDisk";
import { Scene } from "@/core/model/Scene";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import { VersionedSerializer } from "@/persistence/VersionedSerializer";
import { vec2 } from "@/core/geometry/Vec2";

/** Hoisted state driving the mocked native-picker desktop environment. */
const native = vi.hoisted(() => ({
  enabled: false,
  picked: null as string | null,
  lastOptions: null as Record<string, unknown> | null,
  invokeError: null as string | null,
  lastCall: null as { cmd: string; args: Record<string, unknown> } | null,
}));

vi.mock("@/platform/tauri/log", () => ({
  isTauriEnvironment: () => native.enabled,
}));

vi.mock("@/platform/tauri/dialog", () => ({
  saveFileDialog: vi.fn(async (options?: Record<string, unknown>) => {
    native.lastOptions = options ?? null;
    return native.picked;
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    native.lastCall = { cmd, args };
    if (native.invokeError !== null) {
      throw new Error(native.invokeError);
    }
    return null;
  }),
}));

describe("normalizeSavePath (the typed-address policy)", () => {
  it("strips surrounding double quotes (Windows Copy-as-path pastes)", () => {
    expect(normalizeSavePath('  "C:\\Users\\me\\Desktop\\board.icb"  ')).toBe(
      "C:\\Users\\me\\Desktop\\board.icb",
    );
  });

  it("keeps a correct .icb path untouched", () => {
    expect(normalizeSavePath("C:\\Users\\me\\board.icb")).toBe(
      "C:\\Users\\me\\board.icb",
    );
    expect(normalizeSavePath("/home/me/board.icb")).toBe("/home/me/board.icb");
    expect(normalizeSavePath("C:\\Users\\me\\BOARD.ICB")).toBe(
      "C:\\Users\\me\\BOARD.ICB",
    );
  });

  it("appends .icb when no extension was typed", () => {
    expect(normalizeSavePath("C:\\Users\\me\\Desktop\\board")).toBe(
      "C:\\Users\\me\\Desktop\\board.icb",
    );
    expect(normalizeSavePath("/tmp/my-board")).toBe("/tmp/my-board.icb");
  });

  it("replaces a foreign extension with the app format", () => {
    expect(normalizeSavePath("C:\\Users\\me\\board.txt")).toBe(
      "C:\\Users\\me\\board.icb",
    );
    expect(normalizeSavePath("/home/me/archive.tar.gz")).toBe(
      "/home/me/archive.tar.icb",
    );
  });

  it("treats dot-files as names (no extension surgery)", () => {
    expect(normalizeSavePath("/home/me/.icb")).toBe("/home/me/.icb");
    expect(normalizeSavePath("/home/me/.backup")).toBe("/home/me/.backup.icb");
  });

  it("rejects empty and whitespace-only input", () => {
    expect(normalizeSavePath("")).toBeNull();
    expect(normalizeSavePath("   ")).toBeNull();
    expect(normalizeSavePath('""')).toBeNull();
  });

  it("rejects directory-only paths (no file name)", () => {
    expect(normalizeSavePath("C:\\Users\\me\\Desktop\\")).toBeNull();
    expect(normalizeSavePath("/home/me/")).toBeNull();
    expect(normalizeSavePath("C:\\")).toBeNull();
  });

  it("rejects characters Windows forbids in file names", () => {
    expect(normalizeSavePath("C:\\Users\\me\\bo?ard.icb")).toBeNull();
    expect(normalizeSavePath("C:\\Users\\me\\bo|ard.icb")).toBeNull();
    expect(normalizeSavePath("C:\\Users\\me\\bo<ard>.icb")).toBeNull();
    expect(normalizeSavePath('C:\\Users\\me\\bo"ard.icb')).toBeNull();
    expect(normalizeSavePath("C:\\Users\\me\u0000\\board.icb")).toBeNull();
  });
});

describe("web-shell dispatch branches (jsdom: no Tauri, no FS Access API)", () => {
  it("typed-path saving reports unsupported outside the desktop shell", async () => {
    const scene = new Scene();
    const serializer = new VersionedSerializer();
    const result = await saveProjectToPath(
      scene,
      serializer,
      "C:\\Users\\me\\board.icb",
    );
    expect(result).toEqual({
      kind: "unsupported",
      reason: "web-cannot-write-typed-path",
    });
  });

  it("typed-path saving rejects an invalid path before anything else", async () => {
    const scene = new Scene();
    const serializer = new VersionedSerializer();
    const result = await saveProjectToPath(scene, serializer, "   ");
    expect(result).toEqual({ kind: "failed", reason: "invalid-path" });
  });

  it("the picker reports unsupported when the API is absent", async () => {
    const scene = new Scene();
    const serializer = new VersionedSerializer();
    const result = await saveProjectViaPicker(scene, serializer, "board.icb");
    expect(result).toEqual({
      kind: "unsupported",
      reason: "no-file-system-access-api",
    });
    expect(hasSystemSavePicker()).toBe(false);
  });
});

describe("saveProjectViaNativeDialog — the native Windows save picker (desktop)", () => {
  afterEach(() => {
    native.enabled = false;
    native.picked = null;
    native.lastOptions = null;
    native.invokeError = null;
    native.lastCall = null;
  });

  it("is unsupported on the web shell without opening the picker", async () => {
    const result = await saveProjectViaNativeDialog(
      new Scene(),
      new VersionedSerializer(),
      "b.icb",
    );
    expect(result).toEqual({
      kind: "unsupported",
      reason: "native-dialog-desktop-only",
    });
    expect(native.lastOptions).toBeNull();
  });

  it("reports cancelled when the OS picker is dismissed", async () => {
    native.enabled = true;
    native.picked = null;
    const result = await saveProjectViaNativeDialog(
      new Scene(),
      new VersionedSerializer(),
      "b.icb",
    );
    expect(result).toEqual({ kind: "cancelled" });
    expect(native.lastCall).toBeNull();
  });

  it("suggests the file name and offers only .icb files in the picker", async () => {
    native.enabled = true;
    native.picked = "C:\\Users\\me\\Desktop\\board.icb";
    await saveProjectViaNativeDialog(
      new Scene(),
      new VersionedSerializer(),
      "infinite-canvas.icb",
    );
    expect(native.lastOptions).toMatchObject({
      defaultPath: "infinite-canvas.icb",
      filters: [{ name: expect.any(String), extensions: ["icb"] }],
    });
  });

  it("writes the serialised payload at the picked path via save_text_file", async () => {
    native.enabled = true;
    native.picked = "C:\\Users\\me\\Desktop\\board.icb";
    const scene = new Scene();
    const result = await saveProjectViaNativeDialog(
      scene,
      new VersionedSerializer(),
      "b.icb",
    );
    expect(result).toEqual({
      kind: "saved",
      path: "C:\\Users\\me\\Desktop\\board.icb",
    });
    expect(native.lastCall?.cmd).toBe("save_text_file");
    expect((native.lastCall?.args.path as string).endsWith("board.icb")).toBe(
      true,
    );
    const payload = JSON.parse(native.lastCall?.args.contents as string);
    expect(payload.schemaVersion).toBe(6);
    expect(payload.meta.magic).toBe(".icb");
  });

  it("enforces the .icb extension on the picked path before writing", async () => {
    native.enabled = true;
    native.picked = "C:\\Users\\me\\Desktop\\board";
    const result = await saveProjectViaNativeDialog(
      new Scene(),
      new VersionedSerializer(),
      "b",
    );
    expect(result).toEqual({
      kind: "saved",
      path: "C:\\Users\\me\\Desktop\\board.icb",
    });
    expect(native.lastCall?.args.path).toBe(
      "C:\\Users\\me\\Desktop\\board.icb",
    );
  });

  it("fails with the IPC error message when the write is refused", async () => {
    native.enabled = true;
    native.picked = "D:\\readonly\\board.icb";
    native.invokeError = "permission denied";
    const result = await saveProjectViaNativeDialog(
      new Scene(),
      new VersionedSerializer(),
      "b",
    );
    expect(result).toEqual({ kind: "failed", reason: "permission denied" });
  });
});

describe("serializeProjectFile (the .icb envelope)", () => {
  it("wraps the scene snapshot in the versioned .icb structure", () => {
    const scene = new Scene();
    const shape: ShapeObjectData = {
      id: "obj-1",
      kind: "shape",
      name: undefined,
      position: vec2(10, 20),
      rotation: 0,
      zIndex: 1,
      visible: true,
      locked: false,
      shapeKind: "rectangle",
      width: 100,
      height: 50,
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 2,
    };
    scene.add(shape);
    const payload = JSON.parse(
      serializeProjectFile(scene, new VersionedSerializer()),
    );
    expect(payload.schemaVersion).toBe(6);
    expect(payload.meta.magic).toBe(".icb");
    expect(payload.plugins).toEqual({});
    expect(payload.scene.objects).toHaveLength(1);
    expect(payload.scene.objects[0]).toMatchObject({
      id: "obj-1",
      typeId: "core.shape",
    });
  });

  it("serialises an empty scene into a valid empty project", () => {
    const payload = JSON.parse(
      serializeProjectFile(new Scene(), new VersionedSerializer()),
    );
    expect(payload.meta.magic).toBe(".icb");
    expect(payload.scene.objects).toHaveLength(0);
    expect(payload.plugins).toEqual({});
  });
});
