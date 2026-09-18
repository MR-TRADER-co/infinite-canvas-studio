/**
 * Monotonic id generator for scene objects and documents.
 *
 * Ids are stable strings of the form `<prefix>-<n>` where `n` never repeats
 * within one generator instance; persistence reseeds the counter on load so
 * restored objects never collide with freshly allocated ids.
 */

/** Allocates unique, monotonically increasing string ids. */
export class IdGenerator {
  private counter = 0;

  /**
   * @param prefix - prefix prepended to every generated id.
   */
  public constructor(private readonly prefix = "obj") {}

  /**
   * @returns the next id in the sequence, e.g. `obj-1`, `obj-2`, ...
   */
  public next(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }

  /**
   * Moves the counter past every numeric suffix found in `usedIds`, so ids
   * allocated after a project load never collide with restored objects. Only
   * ids of this generator's own prefix are considered; foreign ids and
   * non-numeric suffixes are ignored. The counter never moves backwards.
   *
   * @param usedIds - ids present in the loaded project (foreign prefixes
   *        and non-numeric suffixes are ignored).
   */
  public reseed(usedIds: readonly string[]): void {
    let max = this.counter;
    for (const id of usedIds) {
      if (!id.startsWith(`${this.prefix}-`)) {
        continue;
      }
      const suffix = id.slice(this.prefix.length + 1);
      const value = Number(suffix);
      if (suffix !== "" && Number.isFinite(value)) {
        max = Math.max(max, Math.trunc(value));
      }
    }
    this.counter = max;
  }
}
