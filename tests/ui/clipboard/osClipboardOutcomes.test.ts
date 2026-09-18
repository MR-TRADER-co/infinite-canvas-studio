/**
 * فاز ۲۶ «کیفیت انتخاب و کلیپ‌بورد» — the TRI-STATE OS-clipboard write
 * outcomes and the Firefox PNG-download fallback helpers.
 *
 * The node runtime stands in for the browser matrix: `ClipboardItem` is
 * absent by default (the Firefox shape), and the Chromium/Safari shapes
 * are stubbed in with `vi.stubGlobal` (the write path needs no DOM —
 * `writeSelectionImageToSystemClipboard` receives the rendered Blob).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canWriteImagesToSystemClipboard,
  writeImageObjectToSystemClipboard,
  writeRichTextToSystemClipboard,
  writeSelectionImageToSystemClipboard,
} from "@/ui/clipboard/osClipboard";
import {
  downloadBlob,
  IMAGE_DOWNLOAD_FILENAME,
  SELECTION_SNAPSHOT_FILENAME,
} from "@/ui/clipboard/blobDownload";
import type { ImageObjectData } from "@/core/model/ImageObject";
import { makeShape } from "../../core/commands/fixtures";

/** A minimal image object (the clipboard paths only touch src/sizes). */
function makeImage(overrides: Partial<ImageObjectData> = {}): ImageObjectData {
  return {
    ...makeShape("image-1", 0, 0, 30, 20),
    kind: "image",
    src: "data:image/png;base64,AAAA",
    naturalWidth: 60,
    naturalHeight: 40,
    width: 30,
    height: 20,
    ...overrides,
  } as ImageObjectData;
}

/** Installs the Chromium-like clipboard (async write + ClipboardItem). */
function stubChromiumClipboard(): ReturnType<typeof vi.fn> {
  const write = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { clipboard: { write } });
  vi.stubGlobal(
    "ClipboardItem",
    class ClipboardItem {
      public readonly payload: Record<string, unknown>;
      constructor(payload: Record<string, unknown>) {
        this.payload = payload;
      }
    },
  );
  return write;
}

describe("writeSelectionImageToSystemClipboard — the فاز ۲۶ tri-state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves \"unsupported\" when ClipboardItem is absent (Firefox) and never attempts the write", async () => {
    const write = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { write } });
    // No ClipboardItem stub → typeof ClipboardItem === "undefined".

    const outcome = await writeSelectionImageToSystemClipboard(
      new Blob(["png"], { type: "image/png" }),
      "متن انتخاب",
    );

    expect(outcome).toBe("unsupported");
    expect(write).not.toHaveBeenCalled();
  });

  it("resolves \"unsupported\" when the async clipboard is missing entirely (insecure origins / SSR)", async () => {
    vi.stubGlobal("navigator", {});
    expect(
      await writeSelectionImageToSystemClipboard(
        new Blob(["png"], { type: "image/png" }),
        null,
      ),
    ).toBe("unsupported");
  });

  it("resolves \"written\" after ONE atomic image+text write", async () => {
    const write = stubChromiumClipboard();

    const outcome = await writeSelectionImageToSystemClipboard(
      new Blob(["png"], { type: "image/png" }),
      "متن انتخاب",
    );

    expect(outcome).toBe("written");
    expect(write).toHaveBeenCalledTimes(1);
    const items = write.mock.calls[0]?.[0] as unknown as Array<{
      payload: Record<string, unknown>;
    }>;
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]?.payload ?? {}).sort()).toEqual([
      "image/png",
      "text/plain",
    ]);
  });

  it("omits the text/plain leg when the projection is null", async () => {
    const write = stubChromiumClipboard();

    const outcome = await writeSelectionImageToSystemClipboard(
      new Blob(["png"], { type: "image/png" }),
      null,
    );

    expect(outcome).toBe("written");
    const items = write.mock.calls[0]?.[0] as unknown as Array<{
      payload: Record<string, unknown>;
    }>;
    expect(Object.keys(items[0]?.payload ?? {})).toEqual(["image/png"]);
  });

  it("resolves \"failed\" when the write rejects (permission denied)", async () => {
    const write = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal("ClipboardItem", class {});

    expect(
      await writeSelectionImageToSystemClipboard(
        new Blob(["png"], { type: "image/png" }),
        null,
      ),
    ).toBe("failed");
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe("writeImageObjectToSystemClipboard — the فاز ۲۶ tri-state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves \"failed\" for an empty source BEFORE any API probing", async () => {
    vi.stubGlobal("navigator", {});
    expect(await writeImageObjectToSystemClipboard(makeImage({ src: "" }))).toBe(
      "failed",
    );
  });

  it("resolves \"unsupported\" when ClipboardItem is absent (Firefox)", async () => {
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn() } });
    expect(await writeImageObjectToSystemClipboard(makeImage())).toBe(
      "unsupported",
    );
  });

  it("resolves \"unsupported\" when the async clipboard is missing (insecure origins)", async () => {
    vi.stubGlobal("navigator", {});
    expect(await writeImageObjectToSystemClipboard(makeImage())).toBe(
      "unsupported",
    );
  });

  it("resolves \"failed\" when the PNG render degrades (DOM-less runtime)", async () => {
    stubChromiumClipboard();
    // The node runtime has no document → imageObjectToPngBlob → null.
    expect(await writeImageObjectToSystemClipboard(makeImage())).toBe("failed");
  });
});

describe("canWriteImagesToSystemClipboard (the fallback probe)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is false without ClipboardItem (Firefox) even when the write API exists", () => {
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn() } });
    expect(canWriteImagesToSystemClipboard()).toBe(false);
  });

  it("is true on the Chromium shape", () => {
    stubChromiumClipboard();
    expect(canWriteImagesToSystemClipboard()).toBe(true);
  });

  it("is false without any clipboard API", () => {
    vi.stubGlobal("navigator", {});
    expect(canWriteImagesToSystemClipboard()).toBe(false);
  });
});


describe("writeRichTextToSystemClipboard — the فاز ۳۵ tri-state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ships text/html + text/plain on ONE ClipboardItem (atomic write)", async () => {
    const write = stubChromiumClipboard();

    const outcome = await writeRichTextToSystemClipboard(
      "<h2>سرتیتر</h2><p>متن</p>",
      "سرتیتر\nمتن",
    );

    expect(outcome).toBe("written");
    expect(write).toHaveBeenCalledTimes(1);
    const items = write.mock.calls[0]?.[0] as Array<{
      payload: Record<string, unknown>;
    }>;
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]?.payload ?? {}).sort()).toEqual([
      "text/html",
      "text/plain",
    ]);
  });

  it("resolves \"unsupported\" when ClipboardItem is absent (Firefox)", async () => {
    const write = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { write } });

    const outcome = await writeRichTextToSystemClipboard("<p>x</p>", "x");

    expect(outcome).toBe("unsupported");
    expect(write).not.toHaveBeenCalled();
  });

  it("resolves \"failed\" when the platform write throws (caller falls back to plain text)", async () => {
    const write = vi.fn(async () => {
      throw new Error("clipboard locked");
    });
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal(
      "ClipboardItem",
      class ClipboardItem {
        public readonly payload: Record<string, unknown>;
        constructor(payload: Record<string, unknown>) {
          this.payload = payload;
        }
      },
    );

    const outcome = await writeRichTextToSystemClipboard("<p>x</p>", "x");

    expect(outcome).toBe("failed");
  });
});

describe("downloadBlob — the Firefox fallback delivery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resolves false on a DOM-less runtime (never throws)", () => {
    expect(downloadBlob(new Blob(["png"]), IMAGE_DOWNLOAD_FILENAME)).toBe(
      false,
    );
  });

  it("triggers one anchor download with the suggested name and revokes the object URL", async () => {
    vi.useFakeTimers();
    const clicks: string[] = [];
    const created: string[] = [];
    const revoked: string[] = [];
    const anchor = {
      href: "",
      download: "",
      rel: "",
      click: () => {
        clicks.push(anchor.download);
      },
    };
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        created.push(`blob:${(blob as { size?: number }).size ?? 0}`);
        return "blob:download-url";
      },
      revokeObjectURL: (url: string) => {
        revoked.push(url);
      },
    });
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        expect(tag).toBe("a");
        return anchor;
      },
    });

    const blob = new Blob(["png-bytes"], { type: "image/png" });
    expect(downloadBlob(blob, SELECTION_SNAPSHOT_FILENAME)).toBe(true);
    expect(clicks).toEqual([SELECTION_SNAPSHOT_FILENAME]);
    expect(anchor.href).toBe("blob:download-url");
    expect(created).toHaveLength(1);
    // The object URL is revoked on the next macrotask tick.
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(revoked).toEqual(["blob:download-url"]);
  });
});
