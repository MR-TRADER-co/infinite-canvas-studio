"use client";

/**
 * The browser binding of the sticker recents (R12.1): a tiny Zustand
 * store hydrated from localStorage once on the client, kept in sync by
 * {@link noteStickerUse} writes. Every recents consumer (the Sticker
 * Picker dialog, the Inspector's sticker section) subscribes here —
 * one source of truth, zero prop drilling.
 */
import { create } from "zustand";
import {
  noteStickerUse,
  readRecentStickers,
  RECENT_STICKERS_LIMIT,
  type StickerRecentsStorage,
} from "@/core/stickers/RecentStickers";

/** The client store's public shape. */
interface RecentStickersState {
  /** The current recents (most-recent first). */
  recents: readonly string[];
  /** Records one emoji use (persists + reorders + caps). */
  note: (emoji: string) => void;
}

/**
 * Resolves the browser localStorage (null on the server / when the
 * storage API is unavailable — the store then stays session-only).
 *
 * @returns the storage facade, or null.
 */
function browserStorage(): StickerRecentsStorage | null {
  if (typeof window === "undefined" || window.localStorage === undefined) {
    return null;
  }
  return window.localStorage;
}

/** Whether the initial hydration already ran (StrictMode-safe). */
let hydrated = false;

/** Hydrates the store from localStorage exactly once. */
function hydrateOnce(): void {
  if (hydrated) {
    return;
  }
  hydrated = true;
  const storage = browserStorage();
  if (storage !== null) {
    useRecentStickers.setState({ recents: readRecentStickers(storage) });
  }
}

/** The recents store (empty until the client hydrates). */
export const useRecentStickers = create<RecentStickersState>((set) => ({
  recents: [],
  note: (emoji: string): void => {
    const storage = browserStorage();
    if (storage === null) {
      // Storage-less sessions still track in memory (SSR/tests).
      set((state) => ({
        recents: [
          emoji,
          ...state.recents.filter((entry) => entry !== emoji),
        ].slice(0, RECENT_STICKERS_LIMIT),
      }));
      return;
    }
    set({ recents: noteStickerUse(emoji, storage) });
  },
}));

// Hydrate immediately on module load (client only — the guard is inside).
hydrateOnce();
