/**
 * Unit tests for the load-from-disk dispatcher (recall half of the "save at
 * an address" system): the shared typed-path policy rejections, the web
 * branch (local server bridge via stubbed fetch), the desktop branch
 * (Tauri `read_text_file` IPC via mocked modules) and the desktop NATIVE
 * picker branch (the «پنجرهٔ بازکردن خود ویندوز» → verbatim read).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadProjectFromPath,
  loadProjectViaNativeDialog,
} from "@/persistence/LoadFromDisk";

/** Hoisted state driving the mocked Tauri environment/invoke. */
const tauri = vi.hoisted(() => ({
  enabled: false,
  invokeError: null as string | null,
  invokeResponse:
    '{"magic":".icb","version":1,"scene":{"camera":{"x":0,"y":0,"zoom":1,"rotation":0},"objects":[]}}',
  lastCall: null as { cmd: string; args: Record<string, unknown> } | null,
}));

vi.mock("@/platform/tauri/log", () => ({
  isTauriEnvironment: () => tauri.enabled,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    tauri.lastCall = { cmd, args };
    if (tauri.invokeError !== null) {
      throw new Error(tauri.invokeError);
    }
    return tauri.invokeResponse;
  }),
}));

/** Hoisted state driving the mocked native open picker. */
const native = vi.hoisted(() => ({
  picked: null as string | null,
  lastOptions: null as Record<string, unknown> | null,
}));

vi.mock("@/platform/tauri/dialog", () => ({
  openFileDialog: vi.fn(async (options?: Record<string, unknown>) => {
    native.lastOptions = options ?? null;
    return native.picked;
  }),
}));

/** JSON `Response` helper. */
const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  tauri.enabled = false;
  tauri.invokeError = null;
  tauri.lastCall = null;
  native.picked = null;
  native.lastOptions = null;
  vi.stubGlobal("window", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadProjectFromPath — shared typed-path policy", () => {
  it("rejects invalid input before any I/O", async () => {
    const result = await loadProjectFromPath("   ");
    expect(result).toEqual({ kind: "failed", reason: "invalid-path" });
  });
});

describe("loadProjectFromPath — web branch (local server bridge)", () => {
  it("delivers the raw payload read through the bridge", async () => {
    const raw =
      '{"magic":".icb","version":1,"scene":{"camera":{"x":1,"y":2,"zoom":1,"rotation":0},"objects":[]}}';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, { ok: true, path: "/tmp/board.icb", contents: raw }),
      ),
    );
    const result = await loadProjectFromPath("/tmp/board.icb");
    expect(result).toEqual({ kind: "loaded", path: "/tmp/board.icb", raw });
  });

  it("normalises the typed path before hitting the bridge", async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) =>
      jsonResponse(200, { ok: true, path: "/tmp/board.icb", contents: "{}" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await loadProjectFromPath('"/tmp/board"');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const sent = JSON.parse(init.body as string);
    expect(sent.path).toBe("/tmp/board.icb");
  });

  it("surfaces not-found as a machine-readable failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(404, { ok: false, error: "not-found", message: "gone" }),
      ),
    );
    const result = await loadProjectFromPath("/tmp/missing.icb");
    expect(result).toEqual({ kind: "failed", reason: "not-found" });
  });

  it("surfaces non-ICB payloads as a machine-readable failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(422, { ok: false, error: "not-icb", message: "junk" }),
      ),
    );
    const result = await loadProjectFromPath("/tmp/junk.icb");
    expect(result).toEqual({ kind: "failed", reason: "not-icb" });
  });
});

describe("loadProjectFromPath — desktop branch (Tauri IPC)", () => {
  it("reads the file through the read_text_file command", async () => {
    tauri.enabled = true;
    const result = await loadProjectFromPath("C:\\Users\\me\\board.icb");
    expect(result).toEqual({
      kind: "loaded",
      path: "C:\\Users\\me\\board.icb",
      raw: tauri.invokeResponse,
    });
    expect(tauri.lastCall).toEqual({
      cmd: "read_text_file",
      args: { path: "C:\\Users\\me\\board.icb" },
    });
  });

  it("normalises the typed path before the IPC call", async () => {
    tauri.enabled = true;
    await loadProjectFromPath("/home/me/board");
    expect(tauri.lastCall).toEqual({
      cmd: "read_text_file",
      args: { path: "/home/me/board.icb" },
    });
  });

  it("fails with the IPC error message when the read is refused", async () => {
    tauri.enabled = true;
    tauri.invokeError = "No such file";
    const result = await loadProjectFromPath("/home/me/missing.icb");
    expect(result).toEqual({ kind: "failed", reason: "No such file" });
  });
});

describe("loadProjectViaNativeDialog — the native Windows open picker (desktop)", () => {
  it("is unsupported on the web shell without opening the picker", async () => {
    const result = await loadProjectViaNativeDialog();
    expect(result).toEqual({
      kind: "unsupported",
      reason: "native-dialog-desktop-only",
    });
    expect(native.lastOptions).toBeNull();
  });

  it("reports cancelled when the OS picker is dismissed", async () => {
    tauri.enabled = true;
    native.picked = null;
    const result = await loadProjectViaNativeDialog();
    expect(result).toEqual({ kind: "cancelled" });
    expect(tauri.lastCall).toBeNull();
  });

  it("offers only .icb files in the picker", async () => {
    tauri.enabled = true;
    native.picked = "C:\\Users\\me\\Desktop\\board.icb";
    await loadProjectViaNativeDialog();
    expect(native.lastOptions).toMatchObject({
      filters: [{ name: expect.any(String), extensions: ["icb"] }],
    });
  });

  it("reads the picked path VERBATIM through read_text_file", async () => {
    tauri.enabled = true;
    native.picked = "C:\\Users\\me\\Desktop\\board.icb";
    const result = await loadProjectViaNativeDialog();
    expect(result).toEqual({
      kind: "loaded",
      path: "C:\\Users\\me\\Desktop\\board.icb",
      raw: tauri.invokeResponse,
    });
    expect(tauri.lastCall).toEqual({
      cmd: "read_text_file",
      args: { path: "C:\\Users\\me\\Desktop\\board.icb" },
    });
  });

  it("fails with the IPC error message when the read is refused", async () => {
    tauri.enabled = true;
    native.picked = "D:\\gone.icb";
    tauri.invokeError = "read refused";
    const result = await loadProjectViaNativeDialog();
    expect(result).toEqual({ kind: "failed", reason: "read refused" });
  });
});
