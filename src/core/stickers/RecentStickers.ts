/**
 * Recently-used stickers (R12.1 — «کتابخانه استیکر»): the recents row of
 * the Sticker Picker + Inspector, persisted in APP data (localStorage on
 * the web shell, never inside `.icb` project files — the settings-
 * persistence convention).
 *
 * Pure logic with an INJECTED storage (Web Storage–shaped) so node tests
 * cover validation, dedupe and cap without a DOM. The browser binding
 * lives in `ui/stickers/recentStickersStore`.
 */

/** The storage facade the recents logic needs (localStorage-shaped). */
export interface StickerRecentsStorage {
  /** Reads one slot. */
  getItem(key: string): string | null;
  /** Writes one slot. */
  setItem(key: string, value: string): void;
}

/** How many recents are kept (the picker renders one row). */
export const RECENT_STICKERS_LIMIT = 12;

/** localStorage slot of the recents list. */
export const RECENT_STICKERS_STORAGE_KEY = "infinite-canvas-studio/sticker-recents/v1";

/** Maximum UTF-16 code points accepted for one emoji glyph. */
const MAX_EMOJI_LENGTH = 12;

/**
 * Parses + validates a raw recents payload: a JSON array of non-empty
 * strings, de-duplicated (first wins), capped at the limit. Corrupt or
 * non-conforming input degrades to an empty list (recents are a
 * convenience, never a blocker).
 *
 * @param raw - the raw slot payload (null when absent).
 * @returns the validated emoji list (most-recent first).
 */
export function parseRecentStickers(raw: string | null): readonly string[] {
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const emojis: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string" || !isValidEmoji(item)) {
      continue;
    }
    if (!emojis.includes(item)) {
      emojis.push(item);
    }
    if (emojis.length === RECENT_STICKERS_LIMIT) {
      break;
    }
  }
  return emojis;
}

/**
 * Reads the recents list from storage (validated; failures → empty).
 *
 * @param storage - the storage facade.
 * @returns the emoji list (most-recent first).
 */
export function readRecentStickers(
  storage: StickerRecentsStorage,
): readonly string[] {
  try {
    return parseRecentStickers(
      storage.getItem(RECENT_STICKERS_STORAGE_KEY),
    );
  } catch {
    return [];
  }
}

/**
 * Records one sticker use: the emoji moves to the FRONT of the list,
 * duplicates collapse, the list caps at {@link RECENT_STICKERS_LIMIT},
 * and the result persists (best-effort — storage failures return the
 * in-memory list so the session keeps working).
 *
 * @param emoji - the emoji just used.
 * @param storage - the storage facade.
 * @returns the updated emoji list (most-recent first).
 */
export function noteStickerUse(
  emoji: string,
  storage: StickerRecentsStorage,
): readonly string[] {
  if (!isValidEmoji(emoji)) {
    return readRecentStickers(storage);
  }
  const next = [
    emoji,
    ...readRecentStickers(storage).filter((entry) => entry !== emoji),
  ].slice(0, RECENT_STICKERS_LIMIT);
  try {
    storage.setItem(RECENT_STICKERS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota/disabled storage: the in-session list still updates.
  }
  return next;
}

/**
 * @param emoji - the value to test.
 * @returns whether the value is a plausible single emoji glyph
 *          (non-empty, bounded length, no control characters).
 */
function isValidEmoji(emoji: string): boolean {
  return (
    emoji.length > 0 &&
    emoji.length <= MAX_EMOJI_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(emoji)
  );
}
