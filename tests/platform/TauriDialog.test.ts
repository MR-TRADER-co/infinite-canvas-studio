/**
 * Unit tests for the Tauri dialog wrappers (the native OS file pickers):
 * the plugin is only contacted inside the Tauri WebView, the public option
 * shape is mapped onto the plugin's, non-string open results collapse to
 * null, and any plugin failure degrades to null instead of crashing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openFileDialog, saveFileDialog } from "@/platform/tauri/dialog";

/** Hoisted state driving the mocked environment/plugin. */
const state = vi.hoisted(() => ({
  enabled: false,
  openResult: null as string | string[] | null,
  saveResult: null as string | null,
  openError: null as string | null,
  saveError: null as string | null,
  openOptions: [] as unknown[],
  saveOptions: [] as unknown[],
}));

vi.mock("@/platform/tauri/log", () => ({
  isTauriEnvironment: () => state.enabled,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async (options?: unknown) => {
    state.openOptions.push(options ?? null);
    if (state.openError !== null) {
      throw new Error(state.openError);
    }
    return state.openResult;
  }),
  save: vi.fn(async (options?: unknown) => {
    state.saveOptions.push(options ?? null);
    if (state.saveError !== null) {
      throw new Error(state.saveError);
    }
    return state.saveResult;
  }),
}));

beforeEach(() => {
  state.enabled = false;
  state.openResult = null;
  state.saveResult = null;
  state.openError = null;
  state.saveError = null;
  state.openOptions.length = 0;
  state.saveOptions.length = 0;
});

describe("dialog wrappers — outside the Tauri WebView", () => {
  it("both pickers resolve to null without contacting the plugin", async () => {
    await expect(openFileDialog({ title: "x" })).resolves.toBeNull();
    await expect(saveFileDialog({ title: "x" })).resolves.toBeNull();
    expect(state.openOptions).toHaveLength(0);
    expect(state.saveOptions).toHaveLength(0);
  });
});

describe("saveFileDialog — the native save picker (desktop)", () => {
  it("returns the picked path with the options mapped onto the plugin", async () => {
    state.enabled = true;
    state.saveResult = "C:\\Users\\me\\Desktop\\board.icb";
    const picked = await saveFileDialog({
      title: "Save project",
      defaultPath: "infinite-canvas.icb",
      filters: [
        { name: "Infinite Canvas Project (.icb)", extensions: ["icb"] },
      ],
    });
    expect(picked).toBe("C:\\Users\\me\\Desktop\\board.icb");
    expect(state.saveOptions).toHaveLength(1);
    expect(state.saveOptions[0]).toEqual({
      title: "Save project",
      defaultPath: "infinite-canvas.icb",
      filters: [
        { name: "Infinite Canvas Project (.icb)", extensions: ["icb"] },
      ],
    });
  });

  it("collapses a dismissal (null) to null", async () => {
    state.enabled = true;
    state.saveResult = null;
    await expect(saveFileDialog()).resolves.toBeNull();
  });

  it("collapses a plugin failure to null instead of throwing", async () => {
    state.enabled = true;
    state.saveError = "plugin not registered";
    await expect(saveFileDialog()).resolves.toBeNull();
  });
});

describe("openFileDialog — the native open picker (desktop)", () => {
  it("forwards single-file mode and returns the picked path", async () => {
    state.enabled = true;
    state.openResult = "C:\\Users\\me\\Desktop\\board.icb";
    const picked = await openFileDialog({
      filters: [
        { name: "Infinite Canvas Project (.icb)", extensions: ["icb"] },
      ],
    });
    expect(picked).toBe("C:\\Users\\me\\Desktop\\board.icb");
    expect(state.openOptions[0]).toMatchObject({
      multiple: false,
      directory: false,
    });
  });

  it("collapses a dismissal (null) to null", async () => {
    state.enabled = true;
    state.openResult = null;
    await expect(openFileDialog()).resolves.toBeNull();
  });

  it("collapses unexpected non-string results to null (defensive)", async () => {
    state.enabled = true;
    state.openResult = ["C:\\one.icb", "C:\\two.icb"];
    await expect(openFileDialog()).resolves.toBeNull();
  });

  it("collapses a plugin failure to null instead of throwing", async () => {
    state.enabled = true;
    state.openError = "dialog:default capability missing";
    await expect(openFileDialog()).resolves.toBeNull();
  });
});
