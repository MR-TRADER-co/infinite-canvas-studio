/**
 * RichTextCommand tests (AC3A.9): one command = one whole-session undo
 * step. `do()` applies the post-edit document + projection + box geometry,
 * `undo()` restores the EXACT pre-edit state, `redo()` re-applies, and
 * objects removed in the meantime are skipped (the MoveCommand
 * convention).
 */
import { describe, expect, it } from "vitest";
import { Scene } from "@/core/model/Scene";
import { vec2 } from "@/core/geometry/Vec2";
import {
  isTextBoxObject,
  textBoxFromRect,
  type TextBoxObjectData,
} from "@/core/model/TextBoxObject";
import {
  RichTextCommand,
  type RichTextSnapshot,
} from "@/text/commands/RichTextCommand";
import { richTextFromPlainText } from "@/text/editor/richtext";

/** A text box fixture placed into a fresh scene. */
function makeScene(): { scene: Scene; id: string } {
  const scene = new Scene();
  const object = textBoxFromRect(
    { minX: 10, minY: 20, maxX: 270, maxY: 90 },
    "قبل",
    20,
    "obj-1",
    1,
  );
  scene.add(object);
  return { scene, id: "obj-1" };
}

/** Looks the text box up, failing the test when absent/wrong kind. */
function textBoxOf(scene: Scene, id: string): TextBoxObjectData {
  const object = scene.findById(id);
  if (object === undefined || !isTextBoxObject(object)) {
    throw new Error(`expected text box ${id}`);
  }
  return object;
}

/** A snapshot with substituted fields. */
function snapshot(overrides: Partial<RichTextSnapshot>): RichTextSnapshot {
  return {
    doc: richTextFromPlainText("قبل"),
    text: "قبل",
    position: vec2(10, 20),
    width: 260,
    height: 70,
    ...overrides,
  };
}

describe("RichTextCommand", () => {
  it("applies the after state (document, projection, geometry)", () => {
    const { scene, id } = makeScene();
    const after = snapshot({
      doc: richTextFromPlainText("بعد از ویرایش طولانی‌تر"),
      text: "بعد از ویرایش طولانی‌تر",
      width: 300,
      height: 104,
    });
    const command = new RichTextCommand(scene, id, snapshot({}), after);
    command.do();
    const object = textBoxOf(scene, id);
    expect(object.text).toBe("بعد از ویرایش طولانی‌تر");
    expect(object.doc).toEqual(after.doc);
    expect(object.width).toBe(300);
    expect(object.height).toBe(104);
  });

  it("undo restores the EXACT pre-edit document and geometry (AC3A.7)", () => {
    const { scene, id } = makeScene();
    const before = snapshot({});
    const after = snapshot({
      doc: richTextFromPlainText("متن بسیار متفاوت"),
      text: "متن بسیار متفاوت",
      position: vec2(-40, 20),
      width: 420,
      height: 96,
    });
    const command = new RichTextCommand(scene, id, before, after);
    command.do();
    command.undo();
    const object = textBoxOf(scene, id);
    expect(object.doc).toEqual(before.doc);
    expect(object.text).toBe("قبل");
    expect(object.position).toEqual(vec2(10, 20));
    expect(object.width).toBe(260);
    expect(object.height).toBe(70);
  });

  it("redo re-applies the after state; undo/redo cycles never drift", () => {
    const { scene, id } = makeScene();
    const after = snapshot({
      doc: richTextFromPlainText("x"),
      text: "x",
      width: 12,
      height: 34,
    });
    const command = new RichTextCommand(scene, id, snapshot({}), after);
    command.do();
    for (let cycle = 0; cycle < 3; cycle += 1) {
      command.undo();
      command.redo();
    }
    const object = textBoxOf(scene, id);
    expect(object.doc).toEqual(after.doc);
    expect(object.width).toBe(12);
    expect(object.height).toBe(34);
  });

  it("skips objects removed in the meantime (no re-add on undo)", () => {
    const { scene, id } = makeScene();
    const command = new RichTextCommand(
      scene,
      id,
      snapshot({}),
      snapshot({ text: "بعد", doc: richTextFromPlainText("بعد") }),
    );
    scene.remove(id);
    command.undo();
    expect(scene.findById(id)).toBeUndefined();
    expect(scene.objectCount).toBe(0);
  });

  it("preserves paint order and untouched fields through swaps", () => {
    const { scene, id } = makeScene();
    const later = textBoxFromRect(
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      "other",
      20,
      "obj-2",
      2,
    );
    scene.add(later);
    const command = new RichTextCommand(
      scene,
      id,
      snapshot({}),
      snapshot({ doc: richTextFromPlainText("بعد"), text: "بعد" }),
    );
    command.do();
    command.undo();
    command.redo();
    expect(scene.objects.map((object) => object.id)).toEqual([
      "obj-1",
      "obj-2",
    ]);
    const other = textBoxOf(scene, "obj-2");
    expect(other.text).toBe("other");
  });
});
