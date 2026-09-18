/**
 * The LinkRegistry (pack R11.2, law §1.7.8): the single source of truth
 * for every NON-TEXT object-to-object link — manual links created from
 * the context menu (R11.6) and future plugin-contributed links.
 *
 * Wiki links stay intrinsic to the text (they ARE text content — the
 * knowledge index parses `[[عنوان]]` projections straight from the
 * object documents); every OTHER link kind lives ONLY here, and the
 * knowledge index folds registry entries in as projections (backlink
 * rows, graph edges, broken-title rows). No link state outside this
 * registry + the text itself (the AC11.7 law audit surface).
 *
 * Resolution model (Obsidian-style): an entry carries BOTH the target
 * object id (when the link was made against a live object) AND a title
 * snapshot. When the target object is gone the entry turns DANGLING and
 * auto-resolves the day an object with that title appears — deleted
 * targets resurrect their links through their titles, and undo of an
 * object deletion re-activates the id-based link without any extra
 * bookkeeping (entries are never eagerly pruned in memory).
 *
 * Persistence: the optional `links` project-file section (schema v3,
 * absent field = no links — pre-Phase-18 files read as link-less). The
 * section builder filters DEAD entries (source object gone) at save
 * time so files never accumulate orphans.
 */
/** Kinds of registry-held links (wiki links are text, never stored here). */
export type ObjectLinkKind = "manual" | "plugin";

/** One stored object-to-object link (§1.7.8 — the ONLY link state). */
export interface ObjectLinkEntry {
  /** Unique link id (IdGenerator-issued). */
  readonly id: string;
  /** The linking (source) object id. */
  readonly sourceId: string;
  /** The linked (target) object id — null when created dangling. */
  readonly targetId: string | null;
  /** The target's title SNAPSHOT — the dangling/auto-resolve key. */
  readonly targetTitle: string;
  /** How the link was created. */
  readonly kind: ObjectLinkKind;
  /** Optional human label (rendered in rows instead of a snippet). */
  readonly label?: string;
  /** Owning plugin id (plugin links only). */
  readonly ownerId?: string;
  /** Creation time (epoch ms). */
  readonly createdAt: number;
}

/** The persisted `links` project-file section (version 1). */
export interface LinksSection {
  readonly version: 1;
  readonly links: readonly ObjectLinkEntry[];
}

/** Change listener invoked after every registry mutation. */
export type LinkRegistryListener = () => void;

/** Mutation diff counters drained by the composition root (events). */
export interface LinkRegistryDiff {
  /** Entries added since the last drain. */
  readonly added: number;
  /** Entries removed since the last drain. */
  readonly removed: number;
}

/**
 * The link registry: a plain store of {@link ObjectLinkEntry} rows with
 * change notifications and a serialisable section. Scene knowledge
 * (titles, resolution) lives in the knowledge index — this class never
 * reads the scene.
 */
export class LinkRegistry {
  private readonly entries = new Map<string, ObjectLinkEntry>();
  private readonly listeners = new Set<LinkRegistryListener>();
  private addedSinceDrain = 0;
  private removedSinceDrain = 0;

  /**
   * Registers a change listener (invoked after every mutation).
   *
   * @param listener - the callback.
   * @returns an unsubscribe function.
   */
  public subscribe(listener: LinkRegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Adds (or replaces by id) one entry.
   *
   * @param entry - the link entry.
   */
  public add(entry: ObjectLinkEntry): void {
    const replaced = this.entries.has(entry.id);
    this.entries.set(entry.id, entry);
    if (replaced) {
      // A replacement is a same-count mutation — surface it as a change
      // without skewing the added/removed diff counters.
    } else {
      this.addedSinceDrain += 1;
    }
    this.notify();
  }

  /**
   * Removes one entry by id.
   *
   * @param id - the link entry id.
   * @returns the removed entry, or null when unknown.
   */
  public remove(id: string): ObjectLinkEntry | null {
    const entry = this.entries.get(id) ?? null;
    if (entry === null) {
      return null;
    }
    this.entries.delete(id);
    this.removedSinceDrain += 1;
    this.notify();
    return entry;
  }

  /**
   * @param id - the link entry id.
   * @returns the entry, or null when unknown.
   */
  public get(id: string): ObjectLinkEntry | null {
    return this.entries.get(id) ?? null;
  }

  /**
   * @returns every entry in insertion order.
   */
  public list(): readonly ObjectLinkEntry[] {
    return [...this.entries.values()];
  }

  /**
   * @param sourceId - the source object id.
   * @returns the entries whose source is the object.
   */
  public outgoingOf(sourceId: string): readonly ObjectLinkEntry[] {
    return this.list().filter((entry) => entry.sourceId === sourceId);
  }

  /**
   * @param targetId - the target object id.
   * @returns the entries whose (id-based) target is the object.
   */
  public incomingOf(targetId: string): readonly ObjectLinkEntry[] {
    return this.list().filter((entry) => entry.targetId === targetId);
  }

  /**
   * @param objectId - an object id.
   * @returns entries where the object is the source OR the id-target.
   */
  public entriesTouching(objectId: string): readonly ObjectLinkEntry[] {
    return this.list().filter(
      (entry) =>
        entry.sourceId === objectId || entry.targetId === objectId,
    );
  }

  /**
   * @returns the number of stored entries.
   */
  public count(): number {
    return this.entries.size;
  }

  /**
   * Drains (reads + resets) the mutation diff counters — the
   * composition root turns these into `object:linking-changed` events.
   *
   * @returns the added/removed counts since the last drain.
   */
  public drainDiff(): LinkRegistryDiff {
    const diff: LinkRegistryDiff = {
      added: this.addedSinceDrain,
      removed: this.removedSinceDrain,
    };
    this.addedSinceDrain = 0;
    this.removedSinceDrain = 0;
    return diff;
  }

  /**
   * Builds the persisted section — DEAD entries (source object gone)
   * are filtered so files never carry orphans; dangling-by-title
   * entries SURVIVE (the auto-resolve magic must persist).
   *
   * @param existingObjectIds - the ids of the objects being saved.
   * @returns the section (empty links list when nothing survives).
   */
  public toSection(
    existingObjectIds: ReadonlySet<string>,
  ): LinksSection {
    const links = this.list().filter(
      (entry) =>
        existingObjectIds.has(entry.sourceId) &&
        (entry.targetId === null || existingObjectIds.has(entry.targetId)),
    );
    return { version: 1, links };
  }

  /**
   * Resets the registry from a (validated) persisted section — the
   * boot/load path. Diff counters reset silently (a load is not a
   * user mutation).
   *
   * @param section - the section (defaults to empty).
   */
  public replaceFromSection(
    section: LinksSection | undefined,
  ): void {
    this.entries.clear();
    for (const entry of section?.links ?? []) {
      this.entries.set(entry.id, entry);
    }
    this.addedSinceDrain = 0;
    this.removedSinceDrain = 0;
    this.notify();
  }

  /**
   * Notifies every listener.
   */
  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

/**
 * Validates one wire link entry (the load path — a corrupt row is
 * skipped, never a crash, mirroring the styles/schema sections).
 *
 * @param raw - the parsed JSON row.
 * @returns the validated entry, or null when malformed.
 */
export function readLinkEntry(
  raw: unknown,
): ObjectLinkEntry | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const sourceId =
    typeof record.sourceId === "string" ? record.sourceId : null;
  const targetTitle =
    typeof record.targetTitle === "string" ? record.targetTitle : null;
  const kind =
    record.kind === "manual" || record.kind === "plugin"
      ? record.kind
      : null;
  if (
    id === null ||
    id === "" ||
    sourceId === null ||
    sourceId === "" ||
    targetTitle === null ||
    kind === null
  ) {
    return null;
  }
  const targetId =
    typeof record.targetId === "string" && record.targetId !== ""
      ? record.targetId
      : null;
  const label = typeof record.label === "string" ? record.label : undefined;
  const ownerId =
    typeof record.ownerId === "string" ? record.ownerId : undefined;
  const createdAtValue =
    typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
      ? record.createdAt
      : 0;
  return {
    id,
    sourceId,
    targetId,
    targetTitle,
    kind,
    ...(label !== undefined ? { label } : {}),
    ...(ownerId !== undefined ? { ownerId } : {}),
    createdAt: createdAtValue,
  };
}

/**
 * Validates a persisted `links` section (defensive: corrupt reads as
 * "no links").
 *
 * @param raw - the parsed section value.
 * @returns the validated section, or undefined when absent/corrupt.
 */
export function readLinksSection(raw: unknown): LinksSection | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.links)) {
    return undefined;
  }
  const links: ObjectLinkEntry[] = [];
  for (const row of record.links) {
    const entry = readLinkEntry(row);
    if (entry !== null) {
      links.push(entry);
    }
  }
  return { version: 1, links };
}

/**
 * Resolves one entry's CURRENT target id: the stored target object
 * when it still exists, else the first object owning the folded title
 * key, else null (dangling).
 *
 * @param entry - the link entry.
 * @param hasObject - existence probe against the live scene.
 * @param resolveTitle - the TitleIndex lookup (normalised key → ids).
 * @returns the resolved target object id, or null while dangling.
 */
export function resolveLinkTarget(
  entry: ObjectLinkEntry,
  hasObject: (id: string) => boolean,
  resolveTitle: (key: string) => readonly string[],
): string | null {
  if (entry.targetId !== null && hasObject(entry.targetId)) {
    return entry.targetId;
  }
  const key = entry.targetTitle.trim();
  if (key === "") {
    return null;
  }
  const resolved = resolveTitle(key);
  return resolved.length > 0 ? (resolved[0] ?? null) : null;
}
