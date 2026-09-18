/**
 * Camera bookmarks (R7.9): named viewport snapshots persisted inside the
 * project file.
 *
 * The service owns the in-memory list (add/remove/rename/replaceAll) and
 * captures the CURRENT scene camera on demand; the composition root
 * includes the list in every project save (`ProjectData.bookmarks`) and
 * restores it on load, so bookmarks survive save/load round-trips
 * (AC7.9). Pure model + injected notifier — node-testable.
 */
import type { Camera } from "@/core/camera/Camera";

/** One saved viewport bookmark. */
export interface Bookmark {
  /** Unique bookmark id. */
  readonly id: string;
  /** User-given display name. */
  readonly name: string;
  /** The camera state the bookmark flies to. */
  readonly camera: {
    readonly x: number;
    readonly y: number;
    readonly zoom: number;
    readonly rotation: number;
  };
}

/** Id allocator for bookmarks (injected, keeps tests deterministic). */
export type BookmarkIdAllocator = () => string;

/** Sequential default allocator (stable per service instance). */
function defaultIdAllocator(): () => string {
  let next = 1;
  return () => `bm-${next++}`;
}

/**
 * The bookmark store: ordered list + camera capture.
 */
export class BookmarkService {
  /** The bookmarks, newest last. */
  private bookmarks: Bookmark[] = [];

  /** Notifier invoked after every mutation. */
  private readonly notify: (() => void) | undefined;

  /** Id allocator. */
  private readonly allocateId: BookmarkIdAllocator;

  /**
   * @param options - the optional camera provider (for capture), change
   *        notifier and id allocator.
   */
  public constructor(
    options: {
      readonly getCamera?: () => Camera;
      readonly onChange?: () => void;
      readonly allocateId?: BookmarkIdAllocator;
    } = {},
  ) {
    this.getCamera = options.getCamera;
    this.notify = options.onChange;
    this.allocateId = options.allocateId ?? defaultIdAllocator();
  }

  private readonly getCamera: (() => Camera) | undefined;

  /** @returns the bookmark list (newest last, insertion order). */
  public list(): readonly Bookmark[] {
    return this.bookmarks;
  }

  /**
   * Captures the current camera as a new bookmark.
   *
   * @param name - the display name (trimmed; empty names rejected).
   * @returns the created bookmark, or null when the name is empty or no
   *          camera provider was injected.
   */
  public add(name: string): Bookmark | null {
    const trimmed = name.trim();
    if (trimmed === "" || this.getCamera === undefined) {
      return null;
    }
    const camera = this.getCamera();
    const bookmark: Bookmark = {
      id: this.allocateId(),
      name: trimmed,
      camera: {
        x: camera.x,
        y: camera.y,
        zoom: camera.zoom,
        rotation: camera.rotation,
      },
    };
    this.bookmarks.push(bookmark);
    this.notify?.();
    return bookmark;
  }

  /**
   * Removes a bookmark.
   *
   * @param id - the bookmark id.
   * @returns whether a bookmark was removed.
   */
  public remove(id: string): boolean {
    const before = this.bookmarks.length;
    this.bookmarks = this.bookmarks.filter((bookmark) => bookmark.id !== id);
    const removed = this.bookmarks.length !== before;
    if (removed) {
      this.notify?.();
    }
    return removed;
  }

  /**
   * Renames a bookmark.
   *
   * @param id - the bookmark id.
   * @param name - the new name (trimmed; empty names rejected).
   * @returns whether a bookmark was renamed.
   */
  public rename(id: string, name: string): boolean {
    const trimmed = name.trim();
    if (trimmed === "") {
      return false;
    }
    let renamed = false;
    this.bookmarks = this.bookmarks.map((bookmark) => {
      if (bookmark.id !== id) {
        return bookmark;
      }
      renamed = true;
      return { ...bookmark, name: trimmed };
    });
    if (renamed) {
      this.notify?.();
    }
    return renamed;
  }

  /**
   * Replaces the whole list (document restore path).
   *
   * @param bookmarks - the restored bookmarks (order preserved).
   */
  public replaceAll(bookmarks: readonly Bookmark[]): void {
    this.bookmarks = bookmarks.map((bookmark) => ({ ...bookmark }));
    this.notify?.();
  }
}

/**
 * Validates + narrows an unknown payload as a bookmark list (the load
 * path — a corrupt field never crashes the document).
 *
 * @param value - the raw `bookmarks` field of a project file.
 * @returns the validated bookmarks, or an empty list.
 */
export function readBookmarks(value: unknown): readonly Bookmark[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const bookmarks: Bookmark[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const id = record.id;
    const name = record.name;
    const camera = record.camera;
    if (typeof id !== "string" || typeof name !== "string") {
      continue;
    }
    if (typeof camera !== "object" || camera === null) {
      continue;
    }
    const cam = camera as Record<string, unknown>;
    if (
      !isFiniteNumber(cam.x) ||
      !isFiniteNumber(cam.y) ||
      !isFiniteNumber(cam.zoom) ||
      !isFiniteNumber(cam.rotation) ||
      (cam.zoom as number) <= 0
    ) {
      continue;
    }
    bookmarks.push({
      id,
      name,
      camera: {
        x: cam.x as number,
        y: cam.y as number,
        zoom: cam.zoom as number,
        rotation: cam.rotation as number,
      },
    });
  }
  return bookmarks;
}

/**
 * @param value - the value to test.
 * @returns whether the value is a finite number.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
