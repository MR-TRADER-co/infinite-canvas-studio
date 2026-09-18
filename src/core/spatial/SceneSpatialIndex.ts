/**
 * Scene↔spatial-index synchroniser (R7.10 "enable it"): keeps a
 * {@link SpatialIndex} backend in sync with a live {@link Scene} and offers
 * broad-phase candidate queries for hit-testing and marquee selection.
 *
 * Sync is incremental and object-identity keyed: scene objects are
 * immutable data (commands produce new references on mutation), so an
 * unchanged reference means unchanged bounds — a per-sync pass costs one
 * Map lookup per object plus reinserts ONLY for moved/new objects. The
 * sync runs lazily inside every query and is guarded by the scene
 * revision, so stale queries are impossible.
 *
 * `objectsIntersecting` returns candidates top-most first (reverse paint
 * order), the exact ordering the linear hit-tester walks — consumers keep
 * their precise per-object tests and pick the first passing candidate.
 */
import type { BBox } from "@/core/geometry/BBox";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { objectBBox } from "@/core/model/SceneObject";
import { isPinnedObject } from "@/core/model/Pinned";
import type { SpatialIndex } from "@/core/spatial/SpatialIndex";

/** One cached sync entry: the object reference + its indexed bounds. */
interface CacheSlot {
  /** The object reference at index time (identity = unchanged). */
  readonly object: SceneObjectData;
}

/**
 * Revision-guarded scene index over an arbitrary spatial backend.
 */
export class SceneSpatialIndex {
  /** The scene being indexed. */
  private readonly scene: Scene;

  /** The backend index (R-tree in production, linear in tests). */
  private readonly backend: SpatialIndex;

  /** Object-id → cached slot (identity-keyed incremental sync). */
  private readonly cache = new Map<string, CacheSlot>();

  /** Scene revision at the last sync. */
  private lastRevision = -1;

  /**
   * @param scene - the scene whose objects are indexed.
   * @param backend - the spatial index backend.
   */
  public constructor(scene: Scene, backend: SpatialIndex) {
    this.scene = scene;
    this.backend = backend;
  }

  /**
   * Brings the backend in sync with the scene (no-op when the revision
   * is unchanged since the last sync). Costs one identity Map lookup per
   * object; only new/moved objects reinsert.
   */
  public sync(): void {
    if (this.scene.revision === this.lastRevision) {
      return;
    }
    this.lastRevision = this.scene.revision;
    // Reindex new/moved objects. Pinned objects stay OUT of the world
    // index (فاز ۲۵): their footprint is screen space, so a world bbox
    // would be camera-stale garbage for every broad-phase consumer.
    for (const object of this.scene.objects) {
      const slot = this.cache.get(object.id);
      if (slot !== undefined && slot.object === object) {
        continue;
      }
      if (isPinnedObject(object)) {
        this.cache.delete(object.id);
        this.backend.remove(object.id);
        continue;
      }
      this.backend.insert({ id: object.id, bounds: objectBBox(object) });
      this.cache.set(object.id, { object });
    }
    // Drop vanished ids.
    const alive = new Set(this.scene.objects.map((object) => object.id));
    for (const id of this.cache.keys()) {
      if (!alive.has(id)) {
        this.cache.delete(id);
        this.backend.remove(id);
      }
    }
  }

  /**
   * Broad-phase rectangle query (syncs first).
   *
   * @param rect - the query rectangle in world space.
   * @returns the objects whose bounds intersect `rect`, top-most first.
   */
  public objectsIntersecting(rect: BBox): readonly SceneObjectData[] {
    this.sync();
    const hits = this.backend.query(rect);
    const byId = new Map(
      this.scene.objects.map((object) => [object.id, object] as const),
    );
    const objects: SceneObjectData[] = [];
    for (const hit of hits) {
      const object = byId.get(hit.id);
      if (object !== undefined) {
        objects.push(object);
      }
    }
    // Top-most first: reverse paint order.
    objects.sort(
      (a, b) => this.scene.objects.indexOf(b) - this.scene.objects.indexOf(a),
    );
    return objects;
  }

  /**
   * Broad-phase point query (syncs first): every object whose bounds
   * contain the point (padded by the tolerance).
   *
   * @param point - the world-space point.
   * @param tolerance - the world-space padding.
   * @returns the candidate objects, top-most first.
   */
  public objectsAt(
    point: { readonly x: number; readonly y: number },
    tolerance: number,
  ): readonly SceneObjectData[] {
    return this.objectsIntersecting({
      minX: point.x - tolerance,
      minY: point.y - tolerance,
      maxX: point.x + tolerance,
      maxY: point.y + tolerance,
    });
  }
}
