"use client";

/**
 * Tiny i18n module: `t()` translates a key using the UI store's current
 * language. Works both inside React (via {@link useTranslation}, which
 * re-renders on language change) and outside React (plain `t()` call).
 *
 * R8.6: {@link mergeNamespace} lets external dictionaries (future
 * plugins, Phase 9) merge at runtime under their owner namespace
 * (`owner:key`). Cross-owner conflicts are detected and logged; merging
 * the same owner again REPLACES its namespace. Core dictionary keys are
 * never shadowed — a merged full key that collides with a core key (or a
 * key another owner already claimed) is skipped with a logged warning
 * and reported in the returned conflict list.
 */
import { fa, type TranslationKey } from "./fa";
import { en } from "./en";
import { useUiStore } from "@/ui/store/uiStore";
import type { Language } from "@/ui/store/uiStore";

const dictionaries: Record<Language, Record<TranslationKey, string>> = {
  fa,
  en,
};

export type { TranslationKey, Language };

/** A dictionary contributed per UI language by one owner. */
export interface OwnerDictionary {
  /** Persian strings of the owner namespace. */
  readonly fa?: Readonly<Record<string, string>>;
  /** English strings of the owner namespace. */
  readonly en?: Readonly<Record<string, string>>;
}

/** Merged full key → the owner that defined it. */
const keyOwners = new Map<string, string>();

/** Merged strings per language (the overlay above the core dictionaries). */
const merged: Record<Language, Record<string, string>> = { fa: {}, en: {} };

/** Subscribers notified after every merge (hosts re-render from this). */
const mergeListeners = new Set<() => void>();

/**
 * Namespace separator between the owner id and the contributed key.
 * The colon keeps owner namespaces visually distinct from the core
 * files' dot-separated key families (`settings.title` vs `acme:export`).
 */
const NAMESPACE_SEPARATOR = ":";

/**
 * Merges one owner's dictionaries under its namespace at runtime.
 *
 * Semantics (R8.6 / AC8.4):
 * - every key `k` becomes the full key `owner:k`;
 * - a full key that equals a CORE dictionary key, or one another owner
 *   already claimed, is a CONFLICT: logged (console.warn) and skipped —
 *   the first definition wins, core always wins over merges;
 * - merging the same owner again removes its previous keys first
 *   (REPLACE, not append);
 * - the empty string owner and keys containing the separator are
 *   rejected as conflicts (they would forge another namespace).
 *
 * @param owner - the owning namespace id (e.g. a plugin id; the reserved
 *        `core.` prefix is refused — core keys come from the shipped
 *        dictionaries only).
 * @param dict - the per-language strings.
 * @returns the full keys that conflicted and were skipped (may be empty).
 */
export function mergeNamespace(owner: string, dict: OwnerDictionary): string[] {
  const conflicts: string[] = [];
  if (
    typeof owner !== "string" ||
    owner.length === 0 ||
    owner.startsWith("core.") ||
    owner.includes(NAMESPACE_SEPARATOR)
  ) {
    return [`${String(owner)}${NAMESPACE_SEPARATOR}*`];
  }
  // REPLACE-on-remerge: drop this owner's previous namespace first.
  removeOwnerNamespace(owner);
  const claim = (
    language: Language,
    source: Readonly<Record<string, string>>,
  ): void => {
    for (const [key, value] of Object.entries(source)) {
      const fullKey = `${owner}${NAMESPACE_SEPARATOR}${key}`;
      if (key.includes(NAMESPACE_SEPARATOR)) {
        // A key carrying the separator would forge another owner's
        // namespace — refused as a conflict (logged + reported).
        conflicts.push(fullKey);
        console.warn(
          `[i18n] key conflict skipped: "${fullKey}" (${owner}) — keys must not contain "${NAMESPACE_SEPARATOR}"`,
        );
        continue;
      }
      if (typeof value !== "string") {
        continue;
      }
      const existingOwner = keyOwners.get(fullKey);
      const isCoreKey =
        fullKey in dictionaries.fa || fullKey in dictionaries.en;
      if (
        isCoreKey ||
        (existingOwner !== undefined && existingOwner !== owner)
      ) {
        conflicts.push(fullKey);
        console.warn(
          `[i18n] key conflict skipped: "${fullKey}" (${owner}) — already defined by ${
            existingOwner ?? "core"
          }`,
        );
        continue;
      }
      keyOwners.set(fullKey, owner);
      merged[language][fullKey] = value;
    }
  };
  if (dict.fa !== undefined) {
    claim("fa", dict.fa);
  }
  if (dict.en !== undefined) {
    claim("en", dict.en);
  }
  for (const listener of mergeListeners) {
    listener();
  }
  return conflicts;
}

/**
 * Removes one owner's entire namespace (uninstall path, Phase 9).
 *
 * @param owner - the namespace owner id.
 */
export function removeOwnerNamespace(owner: string): void {
  if (typeof owner !== "string" || owner.length === 0) {
    return;
  }
  const prefix = `${owner}${NAMESPACE_SEPARATOR}`;
  for (const [fullKey, ownerOf] of keyOwners) {
    if (ownerOf === owner || fullKey.startsWith(prefix)) {
      keyOwners.delete(fullKey);
      delete merged.fa[fullKey];
      delete merged.en[fullKey];
    }
  }
}

/**
 * The owner that defined a merged full key (namespace probe; core keys
 * report `"core"`).
 *
 * @param key - the full translation key.
 * @returns the owning namespace id, or null for unknown keys.
 */
export function ownerOfKey(key: string): string | null {
  if (key in dictionaries.fa || key in dictionaries.en) {
    return "core";
  }
  return keyOwners.get(key) ?? null;
}

/**
 * Subscribes to namespace merges/removals (dialog hosts re-render).
 *
 * @param listener - invoked after every merge.
 * @returns an unsubscriber.
 */
export function onNamespacesChanged(listener: () => void): () => void {
  mergeListeners.add(listener);
  return () => {
    mergeListeners.delete(listener);
  };
}

/**
 * Test seam: clears every merged namespace (never used by app code).
 */
export function __resetMergedNamespaces(): void {
  keyOwners.clear();
  merged.fa = {};
  merged.en = {};
}

/**
 * Translates a key in the currently selected UI language.
 *
 * Core keys stay type-safe; merged owner keys pass through the widened
 * string parameter (missing merged keys fall back to the key itself).
 *
 * @param key - a key of the Persian dictionary or a merged `owner:key`.
 * @returns the translated string (Persian when language is `fa`).
 */
export function t(key: TranslationKey | (string & {})): string {
  const language = useUiStore.getState().language;
  const core = dictionaries[language][key as TranslationKey];
  if (core !== undefined) {
    return core;
  }
  const overlay = merged[language][key];
  if (overlay !== undefined) {
    return overlay;
  }
  // Missing merged key: fall back to the other language, then the key.
  const other: Language = language === "fa" ? "en" : "fa";
  return merged[other][key] ?? key;
}

/**
 * @param language - the UI language.
 * @returns the text direction for the language (`fa` → rtl, `en` → ltr).
 */
export function directionOf(language: Language): "rtl" | "ltr" {
  return language === "fa" ? "rtl" : "ltr";
}

/** Return type of {@link useTranslation}. */
export interface UseTranslationResult {
  t: typeof t;
  language: Language;
  setLanguage: (language: Language) => void;
  dir: "rtl" | "ltr";
}

/**
 * React hook binding translations to the language slice of the UI store:
 * components re-render whenever the language changes.
 *
 * @returns the translator plus the current language, setter and direction.
 */
export function useTranslation(): UseTranslationResult {
  const language = useUiStore((state) => state.language);
  const setLanguage = useUiStore((state) => state.setLanguage);
  return { t, language, setLanguage, dir: directionOf(language) };
}
