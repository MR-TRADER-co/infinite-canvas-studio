/**
 * The HOST-provided `project.digest` v1 contract (R10.2): an aggregated
 * summary of the CURRENT project for consumers like the AI plugin.
 *
 * Aggregation (documented in docs/CONTRACTS.md):
 * - `meta`: project name, saved path, dirty flag, generated-at;
 * - `counts`: total objects + per-kind counts + frames + bookmarks;
 * - `texts`: the first N text-bearing objects (sticky notes, text
 *   boxes) as {kind, name, excerpt} — the journal-like material the
 *   AI Analyst analyses; excerpts are capped at 120 chars and HTML is
 *   stripped to plain text;
 * - `activity`: undo-stack size + last save timestamp.
 *
 * The digest computes ON DEMAND (a `get()` query) — never on scene
 * churn; `scene:changed` / `persistence:saved` only emit change events
 * so consumers know to re-query.
 *
 * Layering: plain TypeScript over the core scene/document services.
 */
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** The digest payload shape (contract `project.digest` v1). */
export interface ProjectDigest {
  readonly generatedAt: string;
  readonly meta: {
    readonly projectName: string;
    readonly savedPath: string | null;
    readonly dirty: boolean;
    readonly lastSavedAt: string | null;
  };
  readonly counts: {
    readonly objects: number;
    readonly frames: number;
    readonly bookmarks: number;
    readonly byKind: Readonly<Record<string, number>>;
  };
  readonly texts: readonly {
    readonly kind: string;
    readonly name: string | null;
    readonly excerpt: string;
  }[];
  readonly activity: {
    readonly historyDepth: number;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
  };
}

/** How many text-bearing objects land in `texts`. */
const TEXT_SNIPPET_LIMIT = 16;

/** Excerpt cap (characters, plain text). */
const EXCERPT_CAP = 120;

/** Kinds whose content is journal-like material for the digest. */
const TEXT_KINDS: ReadonlySet<string> = new Set(["sticky", "textbox", "table"]);

/** The document surface the digest reads (App.ts injects it). */
export interface DigestDocumentSource {
  readonly projectName: () => string;
  readonly savedPath: () => string | null;
  readonly isDirty: () => boolean;
  readonly lastSavedAt: () => number | null;
}

/** The history surface the digest reads. */
export interface DigestHistorySource {
  readonly depth: () => number;
  readonly canUndo: () => boolean;
  readonly canRedo: () => boolean;
}

/** The bookmark surface the digest reads. */
export interface DigestBookmarkSource {
  readonly count: () => number;
}

/**
 * Extracts plain text from a rich-text HTML fragment (best-effort).
 *
 * @param html - the rich text markup.
 * @returns the visible text with collapsed whitespace.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads an object's excerpt (best-effort across kinds).
 *
 * @param object - the scene object.
 * @returns the plain-text excerpt, or empty.
 */
function excerptOf(object: SceneObjectData): string {
  const record = object as unknown as Record<string, unknown>;
  const html = record.html;
  if (typeof html === "string") {
    return htmlToPlainText(html);
  }
  const text = record.text;
  if (typeof text === "string") {
    return text.trim();
  }
  const rows = record.rows;
  if (Array.isArray(rows)) {
    const cells: string[] = [];
    for (const row of rows) {
      if (Array.isArray(row)) {
        for (const cell of row) {
          const cellText = (cell as Record<string, unknown>)?.text;
          if (typeof cellText === "string" && cellText.trim() !== "") {
            cells.push(cellText.trim());
          }
        }
      }
    }
    return cells.join(" · ");
  }
  return "";
}

/**
 * Builds the digest for one scene + document state.
 *
 * @param scene - the live scene.
 * @param document - the document lifecycle source.
 * @param history - the history source.
 * @param bookmarks - the bookmark source.
 * @returns the digest payload.
 */
export function buildProjectDigest(
  scene: Scene,
  document: DigestDocumentSource,
  history: DigestHistorySource,
  bookmarks: DigestBookmarkSource,
): ProjectDigest {
  const byKind: Record<string, number> = {};
  let frames = 0;
  const texts: {
    readonly kind: string;
    readonly name: string | null;
    readonly excerpt: string;
  }[] = [];
  for (const object of scene.objects) {
    byKind[object.kind] = (byKind[object.kind] ?? 0) + 1;
    if (object.kind === "frame") {
      frames += 1;
    }
    if (texts.length < TEXT_SNIPPET_LIMIT && TEXT_KINDS.has(object.kind)) {
      const excerpt = excerptOf(object).slice(0, EXCERPT_CAP);
      if (excerpt !== "") {
        texts.push({
          kind: object.kind,
          name: object.name ?? null,
          excerpt,
        });
      }
    }
  }
  const lastSavedAt = document.lastSavedAt();
  return {
    generatedAt: new Date().toISOString(),
    meta: {
      projectName: document.projectName(),
      savedPath: document.savedPath(),
      dirty: document.isDirty(),
      lastSavedAt:
        lastSavedAt === null ? null : new Date(lastSavedAt).toISOString(),
    },
    counts: {
      objects: scene.objectCount,
      frames,
      bookmarks: bookmarks.count(),
      byKind,
    },
    texts,
    activity: {
      historyDepth: history.depth(),
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
    },
  };
}
