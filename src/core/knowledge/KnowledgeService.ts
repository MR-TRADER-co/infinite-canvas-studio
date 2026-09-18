/**
 * The live knowledge service (Knowledge Pack, pack-Phase-11 rebuild):
 * owns the current {@link KnowledgeIndex} snapshot and rebuilds it from
 * the scene on demand (the composition root schedules rebuilds — see
 * the debounced `scene:changed` wiring in App.ts).
 *
 * Pure by injection: the objects arrive through the `getObjects`
 * seam, so node tests never need a real Scene.
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { ObjectLinkEntry } from "@/core/knowledge/LinkRegistry";
import {
  buildKnowledgeIndex,
  EMPTY_KNOWLEDGE_INDEX,
  type KnowledgeBacklink,
  type KnowledgeIndex,
  type KnowledgeTag,
  type KnowledgeTitle,
  type OutgoingWikiLink,
} from "@/core/knowledge/KnowledgeIndex";

/** Constructor seams (all injected — node-testable). */
export interface KnowledgeServiceDeps {
  /** Reads the CURRENT scene objects (paint order). */
  readonly getObjects: () => readonly SceneObjectData[];
  /** Reads the CURRENT LinkRegistry entries (pack R11.2 — optional). */
  readonly getLinks?: () => readonly ObjectLinkEntry[];
}

/** Change listener invoked after every rebuild. */
export type KnowledgeChangeListener = () => void;

/** Aggregate stats of one index (event payloads + tests). */
export interface KnowledgeStats {
  /** Total resolved titles. */
  readonly titles: number;
  /** Total outgoing links (resolved + broken). */
  readonly links: number;
  /** Total backlink rows. */
  readonly backlinks: number;
  /** Total broken (unresolved) titles. */
  readonly broken: number;
  /** Total distinct tags. */
  readonly tags: number;
}

/**
 * The knowledge service: rebuild scheduling lives outside; this class
 * is the index holder + the query surface.
 */
export class KnowledgeService {
  private readonly deps: KnowledgeServiceDeps;
  private readonly listeners = new Set<KnowledgeChangeListener>();
  private index: KnowledgeIndex = EMPTY_KNOWLEDGE_INDEX;
  private version = 0;

  /**
   * Creates the service (the index starts EMPTY — call
   * {@link KnowledgeService.rebuild} once after boot).
   *
   * @param deps - the injection seams.
   */
  public constructor(deps: KnowledgeServiceDeps) {
    this.deps = deps;
  }

  /**
   * Rebuilds the index from the live objects + registry links and
   * notifies listeners.
   *
   * @returns the fresh index.
   */
  public rebuild(): KnowledgeIndex {
    const links = this.deps.getLinks?.() ?? [];
    this.index =
      links.length > 0
        ? buildKnowledgeIndex(this.deps.getObjects(), links)
        : buildKnowledgeIndex(this.deps.getObjects());
    this.version += 1;
    for (const listener of [...this.listeners]) {
      listener();
    }
    return this.index;
  }

  /**
   * @returns the current index (the last built snapshot).
   */
  public current(): KnowledgeIndex {
    return this.index;
  }

  /**
   * @returns the rebuild counter (monotonic; listeners can dedupe).
   */
  public currentVersion(): number {
    return this.version;
  }

  /**
   * Subscribes to rebuilds.
   *
   * @param listener - invoked after every rebuild.
   * @returns an unsubscribe function.
   */
  public subscribe(listener: KnowledgeChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * @param objectId - the object id.
   * @returns the object's resolved title, or null.
   */
  public titleOf(objectId: string): KnowledgeTitle | null {
    return this.index.objectTitle.get(objectId) ?? null;
  }

  /**
   * @param objectId - the object id.
   * @returns the object's outgoing wiki links ([] when none).
   */
  public outgoingOf(objectId: string): readonly OutgoingWikiLink[] {
    return this.index.outgoing.get(objectId) ?? [];
  }

  /**
   * @param objectId - the object id.
   * @returns the backlinks pointing at the object ([] when none).
   */
  public backlinksOf(objectId: string): readonly KnowledgeBacklink[] {
    return this.index.backlinks.get(objectId) ?? [];
  }

  /**
   * @param objectId - the object id.
   * @returns the object's tag keys in document order ([] when none).
   */
  public tagsOf(objectId: string): readonly string[] {
    return this.index.objectTags.get(objectId) ?? [];
  }

  /**
   * @returns every tag, ordered by first appearance.
   */
  public allTags(): readonly KnowledgeTag[] {
    return [...this.index.tags.values()];
  }

  /**
   * Resolves a title key to object ids.
   *
   * @param key - the NORMALISED key (see normaliseKnowledgeKey).
   * @returns the owning object ids ([] when unresolved).
   */
  public resolveTitle(key: string): readonly string[] {
    return this.index.titles.get(key)?.objectIds ?? [];
  }

  /**
   * @param linkId - the registry entry id.
   * @returns the entry's resolved target object id, or null while
   *          dangling/unknown (pack R11.2 resolution surface).
   */
  public resolvedTargetOfLink(linkId: string): string | null {
    return this.index.linkResolution.get(linkId) ?? null;
  }

  /**
   * @param key - the NORMALISED tag key.
   * @returns the tag summary, or null when unknown.
   */
  public tag(key: string): KnowledgeTag | null {
    return this.index.tags.get(key) ?? null;
  }

  /**
   * @returns aggregate stats of the current index.
   */
  public stats(): KnowledgeStats {
    let links = 0;
    for (const list of this.index.outgoing.values()) {
      links += list.length;
    }
    let backlinks = 0;
    for (const list of this.index.backlinks.values()) {
      backlinks += list.length;
    }
    return {
      titles: this.index.titles.size,
      links,
      backlinks,
      broken: this.index.brokenTitles.size,
      tags: this.index.tags.size,
    };
  }
}
