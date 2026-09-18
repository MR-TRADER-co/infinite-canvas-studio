/**
 * Selection: the set of currently selected object ids.
 *
 * Pure state holder — hit-testing decides membership, this class only stores
 * it and answers membership queries. Mutations fire the optional `onChange`
 * notifier exactly once per applied change (never for no-ops), so the render
 * loop and status readouts can react without polling. Duplicate ids are
 * collapsed; the id set is always de-duplicated.
 */

/** Ordered set of the currently selected object ids. */
export class Selection {
  private readonly selectedIds = new Set<string>();

  /** Notifier invoked after every applied mutation (never for no-ops). */
  private readonly notifyChange: (() => void) | undefined;

  /**
   * @param onChange - optional notifier invoked after each applied change.
   */
  public constructor(onChange?: () => void) {
    this.notifyChange = onChange;
  }

  /**
   * Adds an object to the selection.
   *
   * @param id - object id to select.
   */
  public add(id: string): void {
    if (this.selectedIds.has(id)) {
      return;
    }
    this.selectedIds.add(id);
    this.changed();
  }

  /**
   * Adds many objects in one change (de-duplicated).
   *
   * @param ids - object ids to select.
   */
  public addMany(ids: readonly string[]): void {
    let changed = false;
    for (const id of ids) {
      if (!this.selectedIds.has(id)) {
        this.selectedIds.add(id);
        changed = true;
      }
    }
    if (changed) {
      this.changed();
    }
  }

  /**
   * Replaces the whole selection with `ids` in one change.
   *
   * @param ids - the new selected ids (empty clears the selection).
   */
  public replaceAll(ids: readonly string[]): void {
    if (sameIdSet(ids, this.selectedIds)) {
      return;
    }
    this.selectedIds.clear();
    for (const id of ids) {
      this.selectedIds.add(id);
    }
    this.changed();
  }

  /**
   * Removes an object from the selection.
   *
   * @param id - object id to deselect.
   */
  public remove(id: string): void {
    if (!this.selectedIds.delete(id)) {
      return;
    }
    this.changed();
  }

  /**
   * Toggles an object's membership in the selection.
   *
   * @param id - object id to select or deselect.
   */
  public toggle(id: string): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.changed();
  }

  /** Empties the selection. */
  public clear(): void {
    if (this.selectedIds.size === 0) {
      return;
    }
    this.selectedIds.clear();
    this.changed();
  }

  /**
   * @param id - object id to test.
   * @returns whether `id` is currently selected.
   */
  public has(id: string): boolean {
    return this.selectedIds.has(id);
  }

  /** @returns the selected ids as a read-only set. */
  public get ids(): ReadonlySet<string> {
    return this.selectedIds;
  }

  /** @returns the number of selected objects. */
  public get size(): number {
    return this.selectedIds.size;
  }

  /** @returns whether nothing is selected. */
  public isEmpty(): boolean {
    return this.selectedIds.size === 0;
  }

  /** Fires the change notifier. */
  private changed(): void {
    this.notifyChange?.();
  }
}

/**
 * @param ids - candidate id list.
 * @param set - reference id set.
 * @returns whether every id of `ids` is in `set` with no extras (order-free).
 */
function sameIdSet(ids: readonly string[], set: ReadonlySet<string>): boolean {
  if (ids.length !== set.size) {
    return false;
  }
  for (const id of ids) {
    if (!set.has(id)) {
      return false;
    }
  }
  return true;
}
