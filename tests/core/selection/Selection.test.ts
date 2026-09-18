/** Unit tests for the selection id-set model. */
import { describe, expect, it, vi } from "vitest";
import { Selection } from "@/core/selection/Selection";

describe("Selection", () => {
  it("starts empty", () => {
    const selection = new Selection();
    expect(selection.isEmpty()).toBe(true);
    expect(selection.size).toBe(0);
    expect(selection.ids.size).toBe(0);
    expect(selection.has("a")).toBe(false);
  });

  it("add selects an object and notifies once", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.add("a");
    expect(selection.has("a")).toBe(true);
    expect(selection.size).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("add of an already-selected id is a no-op", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.add("a");
    onChange.mockClear();
    selection.add("a");
    expect(selection.size).toBe(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("addMany selects several ids with a single notification", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.addMany(["a", "b", "c"]);
    expect([...selection.ids]).toEqual(["a", "b", "c"]);
    expect(selection.size).toBe(3);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("addMany collapses duplicate ids inside the input", () => {
    const selection = new Selection();
    selection.addMany(["a", "a", "b"]);
    expect([...selection.ids]).toEqual(["a", "b"]);
    expect(selection.size).toBe(2);
  });

  it("addMany merges with the existing selection", () => {
    const selection = new Selection();
    selection.add("a");
    selection.addMany(["a", "b"]);
    expect([...selection.ids]).toEqual(["a", "b"]);
  });

  it("addMany with nothing new is a no-op", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.add("a");
    onChange.mockClear();
    selection.addMany(["a", "a"]);
    expect(selection.size).toBe(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("addMany with an empty list is a no-op", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.addMany([]);
    expect(selection.isEmpty()).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("replaceAll swaps the whole selection in one change", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.replaceAll(["a", "b"]);
    onChange.mockClear();
    selection.replaceAll(["c", "d"]);
    expect([...selection.ids]).toEqual(["c", "d"]);
    expect(selection.has("a")).toBe(false);
    expect(selection.size).toBe(2);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("replaceAll with the same set in a different order is a no-op", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.replaceAll(["a", "b"]);
    onChange.mockClear();
    selection.replaceAll(["b", "a"]);
    expect(selection.size).toBe(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("replaceAll with the identical list is a no-op", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.replaceAll(["a", "b"]);
    onChange.mockClear();
    selection.replaceAll(["a", "b"]);
    expect(selection.size).toBe(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("replaceAll with the same length but a foreign id applies", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.replaceAll(["a", "b"]);
    onChange.mockClear();
    selection.replaceAll(["a", "c"]);
    expect([...selection.ids]).toEqual(["a", "c"]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("replaceAll with an empty list clears the selection", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.add("a");
    onChange.mockClear();
    selection.replaceAll([]);
    expect(selection.isEmpty()).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("replaceAll with an empty list on an empty selection is a no-op", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.replaceAll([]);
    expect(selection.isEmpty()).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("replaceAll de-duplicates the input list", () => {
    const selection = new Selection();
    selection.replaceAll(["a", "b", "a"]);
    expect([...selection.ids]).toEqual(["a", "b"]);
    expect(selection.size).toBe(2);
  });

  it("replaceAll treats a duplicated input as a change even when the set matches", () => {
    // The equality pre-check compares raw lengths, so ["a", "b", "a"] counts as
    // different from {a, b} and one extra (harmless) notification is applied.
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.replaceAll(["a", "b"]);
    onChange.mockClear();
    selection.replaceAll(["a", "b", "a"]);
    expect([...selection.ids]).toEqual(["a", "b"]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("remove deselects an object and notifies once", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.add("a");
    onChange.mockClear();
    selection.remove("a");
    expect(selection.has("a")).toBe(false);
    expect(selection.isEmpty()).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("remove of an unselected id is a no-op", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.remove("a");
    expect(selection.isEmpty()).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("toggle selects an unselected id", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.toggle("a");
    expect(selection.has("a")).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("toggle deselects a selected id", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.add("a");
    onChange.mockClear();
    selection.toggle("a");
    expect(selection.has("a")).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("clear empties the selection and notifies once", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.addMany(["a", "b"]);
    onChange.mockClear();
    selection.clear();
    expect(selection.isEmpty()).toBe(true);
    expect(selection.size).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("clear on an empty selection is a no-op", () => {
    const onChange = vi.fn();
    const selection = new Selection(onChange);
    selection.clear();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ids exposes a live read-only view of the selected ids", () => {
    const selection = new Selection();
    const ids = selection.ids;
    selection.add("a");
    expect(ids.has("a")).toBe(true);
    selection.remove("a");
    expect(ids.size).toBe(0);
  });

  it("mutates safely without an onChange notifier", () => {
    const selection = new Selection();
    expect(() => {
      selection.add("a");
      selection.addMany(["b", "c"]);
      selection.toggle("b");
      selection.replaceAll(["d"]);
      selection.remove("d");
      selection.clear();
    }).not.toThrow();
    expect(selection.isEmpty()).toBe(true);
  });
});
