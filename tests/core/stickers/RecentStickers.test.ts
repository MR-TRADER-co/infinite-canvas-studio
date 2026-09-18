/** Sticker-recents persistence logic (R12.1). */
import { describe, expect, it, beforeEach } from "vitest";
import {
  noteStickerUse,
  parseRecentStickers,
  readRecentStickers,
  RECENT_STICKERS_LIMIT,
  RECENT_STICKERS_STORAGE_KEY,
  type StickerRecentsStorage,
} from "@/core/stickers/RecentStickers";

/** An in-memory localStorage stand-in. */
class MemoryStorage implements StickerRecentsStorage {
  public readonly slots = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.slots.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.slots.set(key, value);
  }
}

describe("parseRecentStickers (R12.1)", () => {
  it("parses a valid list", () => {
    expect(parseRecentStickers('["⭐","🔥"]')).toEqual(["⭐", "🔥"]);
  });

  it("degrades to empty on corrupt payloads", () => {
    expect(parseRecentStickers(null)).toEqual([]);
    expect(parseRecentStickers("not json")).toEqual([]);
    expect(parseRecentStickers('{"a":1}')).toEqual([]);
  });

  it("drops invalid items and dedupes (first wins)", () => {
    const raw = JSON.stringify(["⭐", 42, null, "", "⭐", "🔥"]);
    expect(parseRecentStickers(raw)).toEqual(["⭐", "🔥"]);
  });

  it("caps at the limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => `e${i}`);
    expect(parseRecentStickers(JSON.stringify(many)).length).toBe(
      RECENT_STICKERS_LIMIT,
    );
  });
});

describe("noteStickerUse (R12.1)", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("records and persists the first use", () => {
    const next = noteStickerUse("🚀", storage);
    expect(next).toEqual(["🚀"]);
    expect(readRecentStickers(storage)).toEqual(["🚀"]);
    expect(
      storage.slots.get(RECENT_STICKERS_STORAGE_KEY),
    ).toContain("🚀");
  });

  it("moves a repeated emoji to the front (no duplicates)", () => {
    noteStickerUse("⭐", storage);
    noteStickerUse("🔥", storage);
    noteStickerUse("💡", storage);
    const next = noteStickerUse("⭐", storage);
    expect(next).toEqual(["⭐", "💡", "🔥"]);
  });

  it("caps the list at the limit, evicting the oldest", () => {
    for (let index = 0; index < RECENT_STICKERS_LIMIT + 5; index += 1) {
      noteStickerUse(`e${index}`, storage);
    }
    const recents = readRecentStickers(storage);
    expect(recents.length).toBe(RECENT_STICKERS_LIMIT);
    expect(recents[0]).toBe(`e${RECENT_STICKERS_LIMIT + 4}`);
    expect(recents).not.toContain("e0");
  });

  it("ignores unusable emoji values (empty / control chars)", () => {
    noteStickerUse("⭐", storage);
    expect(noteStickerUse("", storage)).toEqual(["⭐"]);
    expect(noteStickerUse("\u0000x", storage)).toEqual(["⭐"]);
  });
});

describe("readRecentStickers failure paths (R12.1)", () => {
  it("returns empty when storage throws", () => {
    const broken: StickerRecentsStorage = {
      getItem: (): string | null => {
        throw new Error("quota");
      },
      setItem: (): void => {
        throw new Error("quota");
      },
    };
    expect(readRecentStickers(broken)).toEqual([]);
    // The note path also survives a throwing write.
    expect(noteStickerUse("⭐", broken)).toEqual(["⭐"]);
  });
});
