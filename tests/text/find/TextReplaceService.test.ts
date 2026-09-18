/**
 * Unit tests for the Find & Replace execution service (R3B.8 / AC3B.8):
 * scene-wide search, single replace = one undoable command, Replace ALL =
 * exactly ONE undo step restoring everything (across text boxes AND sticky
 * notes), with an open edit session committed first.
 */
import { describe, expect, it, vi } from "vitest";
import { Scene } from "@/core/model/Scene";
import { HistoryManager } from "@/core/history/HistoryManager";
import { textBoxFromRect } from "@/core/model/TextBoxObject";
import { stickyNoteFromRect } from "@/core/model/StickyNoteObject";
import { richTextFromPlainText } from "@/text/editor/richtext";
import {
  isTextBoxObject,
  type TextBoxObjectData,
} from "@/core/model/TextBoxObject";
import { isStickyNoteObject } from "@/core/model/StickyNoteObject";
import {
  collectTargets,
  replaceAllMatches,
  replaceMatch,
} from "@/text/find/TextReplaceService";
import { findMatches } from "@/text/find/FindReplaceModel";

/** Builds a scene with one text box and one sticky note carrying text. */
function makeScene(): { scene: Scene; history: HistoryManager } {
  const scene = new Scene();
  const history = new HistoryManager(50, () => undefined);
  const base = textBoxFromRect(
    { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    "سلام دنیا و سلام دوباره",
    16,
    "box1",
    0,
    "fixed",
  );
  const box: TextBoxObjectData = {
    ...base,
    doc: richTextFromPlainText(base.text),
  };
  scene.add(box);
  scene.add(
    stickyNoteFromRect(
      { minX: 200, minY: 0, maxX: 280, maxY: 160 },
      "#fef08a",
      "سلام از یادداشت",
      16,
      "note1",
      1,
    ),
  );
  return { scene, history };
}

/** Reads an object's plain text through the type guard. */
function textOf(scene: Scene, id: string): string {
  const object = scene.findById(id);
  if (object === undefined) {
    return "";
  }
  return isTextBoxObject(object) || isStickyNoteObject(object)
    ? object.text
    : "";
}

/** The service deps bundle with a spy commit callback. */
function deps(scene: Scene, history: HistoryManager, commit?: () => void) {
  return { scene, history, commitEditing: commit };
}

describe("collectTargets", () => {
  it("lists text boxes and sticky notes in z-order with their text", () => {
    const { scene } = makeScene();
    const targets = collectTargets(scene);
    expect(targets.map((target) => target.id)).toEqual(["box1", "note1"]);
    expect(targets[0]?.kind).toBe("textBox");
    expect(targets[1]?.kind).toBe("stickyNote");
  });
});

describe("replaceMatch (single)", () => {
  it("replaces one occurrence and records exactly ONE undoable command", () => {
    const { scene, history } = makeScene();
    const [match] = findMatches(collectTargets(scene), "دنیا");
    expect(match).toBeDefined();
    const result = replaceMatch(deps(scene, history), match!, "بحر");
    expect(result.replaced).toBe(1);
    expect(result.recorded).toBe(true);
    expect(textOf(scene, "box1")).toBe("سلام بحر و سلام دوباره");
    // ONE undo step restores the whole pre-edit content (AC3B.8).
    history.undo();
    expect(textOf(scene, "box1")).toBe("سلام دنیا و سلام دوباره");
    history.redo();
    expect(textOf(scene, "box1")).toBe("سلام بحر و سلام دوباره");
  });

  it("commits an open edit session before replacing", () => {
    const { scene, history } = makeScene();
    const commit = vi.fn();
    const [match] = findMatches(collectTargets(scene), "دنیا");
    replaceMatch(deps(scene, history, commit), match!, "x");
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("replaces inside the rich document (doc + text stay in sync)", () => {
    const { scene, history } = makeScene();
    const [match] = findMatches(collectTargets(scene), "دنیا");
    replaceMatch(deps(scene, history), match!, "بحر");
    expect(textOf(scene, "box1")).toBe("سلام بحر و سلام دوباره");
    // The doc's JSON round-trips and its projection equals the new text.
    const object = scene.findById("box1");
    const doc =
      object !== undefined && isTextBoxObject(object) ? object.doc : null;
    expect(JSON.parse(JSON.stringify(doc))).toEqual(
      JSON.parse(
        JSON.stringify(richTextFromPlainText("سلام بحر و سلام دوباره")),
      ),
    );
  });
});

describe("replaceAllMatches (AC3B.8: ONE undo step)", () => {
  it("replaces EVERY match across text boxes AND sticky notes", () => {
    const { scene, history } = makeScene();
    const result = replaceAllMatches(deps(scene, history), "سلام", "درود");
    expect(result.replaced).toBe(3); // box ×2 + note ×1
    expect(textOf(scene, "box1")).toBe("درود دنیا و درود دوباره");
    expect(textOf(scene, "note1")).toBe("درود از یادداشت");
  });

  it("records exactly ONE undo step that restores EVERYTHING", () => {
    const { scene, history } = makeScene();
    replaceAllMatches(deps(scene, history), "سلام", "درود");
    // Deep-snapshot the state after replacement.
    const boxAfter = textOf(scene, "box1");
    const noteAfter = textOf(scene, "note1");
    expect(boxAfter).toBe("درود دنیا و درود دوباره");
    expect(noteAfter).toBe("درود از یادداشت");
    // ONE undo restores both objects completely.
    history.undo();
    expect(textOf(scene, "box1")).toBe("سلام دنیا و سلام دوباره");
    expect(textOf(scene, "note1")).toBe("سلام از یادداشت");
    history.redo();
    expect(textOf(scene, "box1")).toBe("درود دنیا و درود دوباره");
    expect(textOf(scene, "note1")).toBe("درود از یادداشت");
  });

  it("is a no-op (no history noise) when nothing matches", () => {
    const { scene, history } = makeScene();
    const result = replaceAllMatches(deps(scene, history), "غیرموجود", "x");
    expect(result.recorded).toBe(false);
    expect(history.canUndo()).toBe(false);
  });

  it("replaces multiple occurrences in ONE object with stable offsets", () => {
    const { scene, history } = makeScene();
    replaceAllMatches(deps(scene, history), "سلام", "x");
    // "x دنیا و x دوباره"
    expect(textOf(scene, "box1")).toBe("x دنیا و x دوباره");
  });
});
