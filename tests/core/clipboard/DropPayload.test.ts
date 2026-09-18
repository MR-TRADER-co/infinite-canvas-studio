/**
 * Unit tests for the external drop/paste payload extraction (Phase 23):
 * dragged-from-web images resolve through `<img src>` → uri-list → plain
 * text priority, data URLs decode as images, uri-lists skip comments,
 * and the pasted text-box sizing heuristics clamp sanely.
 */
import { describe, expect, it } from "vitest";
import {
  extractDropPayload,
  firstImgSrcOf,
  firstUriOf,
  isImportablePasteText,
  looksLikeImageUrl,
  pastedTextBoxSize,
  PASTED_TEXT_FONT_SIZE,
} from "@/core/clipboard/DropPayload";

describe("looksLikeImageUrl", () => {
  it("recognises image extensions with queries and fragments", () => {
    expect(looksLikeImageUrl("https://example.com/a.png")).toBe(true);
    expect(looksLikeImageUrl("https://example.com/a.PNG?w=2#frag")).toBe(true);
    expect(looksLikeImageUrl("https://example.com/a.jpeg")).toBe(true);
    expect(looksLikeImageUrl("https://example.com/a.webp")).toBe(true);
  });

  it("rejects pages and extensionless urls", () => {
    expect(looksLikeImageUrl("https://example.com/page")).toBe(false);
    expect(looksLikeImageUrl("https://example.com/a.html")).toBe(false);
  });
});

describe("firstUriOf", () => {
  it("skips comments and blanks, first url wins", () => {
    expect(firstUriOf("#comment\r\nhttps://a/1.png\n\nhttps://b/2.png")).toBe(
      "https://a/1.png",
    );
    expect(firstUriOf("")).toBeNull();
    expect(firstUriOf("# only comments")).toBeNull();
  });
});

describe("firstImgSrcOf", () => {
  it("extracts the first img src with either quote style", () => {
    expect(firstImgSrcOf('<p><img src="https://x/1.png" alt="a"></p>')).toBe(
      "https://x/1.png",
    );
    expect(firstImgSrcOf("<img src='https://y/2.jpg'>")).toBe(
      "https://y/2.jpg",
    );
    expect(firstImgSrcOf("<p>no images</p>")).toBeNull();
    expect(firstImgSrcOf("")).toBeNull();
  });
});

describe("extractDropPayload", () => {
  const getData = (map: Record<string, string>) => (type: string): string =>
    map[type] ?? "";

  it("prefers the html img src over uri-list and text", () => {
    const payload = extractDropPayload(
      ["text/html", "text/uri-list", "text/plain"],
      getData({
        "text/html": '<img src="https://site/pic.png">',
        "text/uri-list": "https://other/page",
        "text/plain": "some text",
      }),
    );
    expect(payload).toEqual({ kind: "image-url", url: "https://site/pic.png" });
  });

  it("falls back to an image-looking uri-list", () => {
    const payload = extractDropPayload(
      ["text/uri-list", "text/plain"],
      getData({
        "text/uri-list": "https://cdn.example/photo.jpg",
        "text/plain": "https://cdn.example/photo.jpg",
      }),
    );
    expect(payload).toEqual({
      kind: "image-url",
      url: "https://cdn.example/photo.jpg",
    });
  });

  it("treats data:image urls as image payloads", () => {
    const payload = extractDropPayload(
      ["text/html"],
      getData({
        "text/html": '<img src="data:image/png;base64,AAAA">',
      }),
    );
    expect(payload).toEqual({
      kind: "image-url",
      url: "data:image/png;base64,AAAA",
    });
  });

  it("resolves plain text when no image url rides along", () => {
    const payload = extractDropPayload(
      ["text/plain", "text/uri-list"],
      getData({
        "text/plain": "متنِ کشیده‌شده از وب",
        "text/uri-list": "https://example.com/page",
      }),
    );
    expect(payload).toEqual({ kind: "text", text: "متنِ کشیده‌شده از وب" });
  });

  it("returns null for empty or unimportable payloads", () => {
    expect(extractDropPayload(["text/plain"], getData({ "text/plain": "  " }))).toBeNull();
    expect(extractDropPayload([], getData({}))).toBeNull();
    expect(extractDropPayload(["text/html"], getData({ "text/html": "<p>x</p>" }))).toBeNull();
  });
});

describe("isImportablePasteText", () => {
  it("accepts sane text and rejects empty or oversized payloads", () => {
    expect(isImportablePasteText("hello")).toBe(true);
    expect(isImportablePasteText("   ")).toBe(false);
    expect(isImportablePasteText("x".repeat(8001))).toBe(false);
    expect(isImportablePasteText("x".repeat(8000))).toBe(true);
  });
});

describe("pastedTextBoxSize", () => {
  it("tracks the longest line and clamps the width", () => {
    const short = pastedTextBoxSize("hello");
    expect(short.width).toBeGreaterThanOrEqual(200);
    const long = pastedTextBoxSize("x".repeat(200));
    expect(long.width).toBeLessThanOrEqual(640);
    expect(long.width).toBeGreaterThan(short.width);
  });

  it("tracks the line count for the height", () => {
    const one = pastedTextBoxSize("one line");
    const five = pastedTextBoxSize("a\nb\nc\nd\ne");
    expect(five.height).toBeGreaterThan(one.height);
  });

  it("normalises crlf and honours the default font size", () => {
    const size = pastedTextBoxSize("a\r\nb");
    expect(size.height).toBe(pastedTextBoxSize("a\nb").height);
    expect(PASTED_TEXT_FONT_SIZE).toBeGreaterThan(0);
  });
});
