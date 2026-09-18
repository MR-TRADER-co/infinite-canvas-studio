/** Unit tests for the pure text-commit planner. */
import { describe, expect, it } from "vitest";
import { planTextCommit } from "@/text/commands/TextCommit";
import { TEXT_COLOR_TOKEN } from "@/core/model/TextBoxObject";
import {
  DEFAULT_STICKY_FONT_SIZE,
  DEFAULT_STICKY_INK,
  DEFAULT_STICKY_NOTE_COLOR,
} from "@/core/model/StickyNoteObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import type { StickyNoteObjectData } from "@/core/model/StickyNoteObject";
import type {
  TextBearingObject,
  TextCommitPlan,
} from "@/text/commands/TextCommit";
import {
  serializeRichText,
  richTextFromPlainText,
} from "@/text/editor/richtext";

/** Builds a fully populated text box fixture (all base + kind-specific fields). */
function makeTextBox(text: string): TextBoxObjectData {
  return {
    id: "text-1",
    kind: "textBox",
    name: "Box",
    parentId: "group-1",
    position: vec2(10, 20),
    rotation: 0,
    zIndex: 3,
    visible: true,
    locked: false,
    width: 100,
    height: 50,
    text,
    doc: null,
    sizeMode: "auto",
    fontSize: 20,
    color: TEXT_COLOR_TOKEN,
  };
}

/** Runs the planner for a fixture object carrying the given session facts. */
function plan(
  object: TextBearingObject,
  newlyCreated: boolean,
  newText: string,
): TextCommitPlan {
  return planTextCommit({ object, newlyCreated, newText });
}

describe("planTextCommit", () => {
  it("removes a newly created box left empty without recording history", () => {
    expect(plan(makeTextBox(""), true, "")).toEqual({
      action: "remove",
      recordHistory: false,
    });
  });

  it("removes a newly created box left with whitespace-only text without recording history", () => {
    expect(plan(makeTextBox(""), true, "   \n  ")).toEqual({
      action: "remove",
      recordHistory: false,
    });
  });

  it("adds a newly created box that received real text as an undoable add", () => {
    expect(plan(makeTextBox(""), true, "سلام")).toEqual({
      action: "add",
      recordHistory: true,
    });
  });

  it("removes a pre-existing box that was emptied, recording history (undoable removal)", () => {
    expect(plan(makeTextBox("متن"), false, "")).toEqual({
      action: "remove",
      recordHistory: true,
    });
  });

  it("removes a pre-existing box left with whitespace-only text, recording history", () => {
    expect(plan(makeTextBox("متن"), false, "   ")).toEqual({
      action: "remove",
      recordHistory: true,
    });
  });

  it("does nothing when a pre-existing box's text is unchanged", () => {
    expect(plan(makeTextBox("متن"), false, "متن")).toEqual({
      action: "none",
      recordHistory: false,
    });
  });

  it("updates a pre-existing box with changed text as an undoable update", () => {
    expect(plan(makeTextBox("متن"), false, "متن جدید")).toEqual({
      action: "update",
      recordHistory: true,
    });
  });

  it("still updates when only the surrounding whitespace changed", () => {
    // Trimmed content is equal, but the raw text differs → a real update.
    expect(plan(makeTextBox("سلام"), false, " سلام ")).toEqual({
      action: "update",
      recordHistory: true,
    });
  });

  it("treats text identical to a pre-filled newly created box as an add", () => {
    // For pending creations the old text is "" by contract, so any non-empty
    // final text is the (first) recorded add.
    expect(plan(makeTextBox("متن"), true, "متن")).toEqual({
      action: "add",
      recordHistory: true,
    });
  });
});

describe("planTextCommit (rich documents)", () => {
  /** Plans a rich session against a box carrying the stored document. */
  function planRich(
    storedText: string,
    newDocJson: string,
    newText: string,
  ): TextCommitPlan {
    const object = makeTextBox(storedText);
    const stored = { ...object, doc: richTextFromPlainText(storedText) };
    return planTextCommit({
      object: stored,
      newlyCreated: false,
      newText,
      newDocJSON: newDocJson,
    });
  }

  it("does nothing when the serialized document is unchanged", () => {
    const doc = serializeRichText(richTextFromPlainText("سلام"));
    expect(planRich("سلام", doc, "سلام")).toEqual({
      action: "none",
      recordHistory: false,
    });
  });

  it("updates when the document changed but the plain projection is equal", () => {
    // Formatting-only change: same words, different marks.
    const stored = richTextFromPlainText("سلام");
    const changed = JSON.parse(JSON.stringify(stored));
    changed.content[0].content[0].marks = [{ type: "bold" }];
    expect(planRich("سلام", serializeRichText(changed), "سلام")).toEqual({
      action: "update",
      recordHistory: true,
    });
  });

  it("updates when text was added", () => {
    expect(
      planRich(
        "سلام",
        serializeRichText(richTextFromPlainText("سلام دنیا")),
        "سلام دنیا",
      ),
    ).toEqual({ action: "update", recordHistory: true });
  });

  it("removes a pre-existing box whose document was emptied, recording history", () => {
    expect(
      planRich("سلام", serializeRichText(richTextFromPlainText("")), ""),
    ).toEqual({
      action: "remove",
      recordHistory: true,
    });
  });

  it("treats a document equal to the pre-session BASELINE as unchanged (live-synced object)", () => {
    // Live typing synced the new doc into the object already; the commit
    // must still recognize "nothing changed since the session began".
    const before = richTextFromPlainText("سلام");
    const after = richTextFromPlainText("سلام");
    const object = { ...makeTextBox("سلام"), doc: after };
    expect(
      planTextCommit({
        object,
        newlyCreated: false,
        newText: "سلام",
        newDocJSON: serializeRichText(after),
        baselineDocJSON: serializeRichText(before),
      }),
    ).toEqual({ action: "none", recordHistory: false });
  });

  it("updates when the live-synced doc differs from the pre-session baseline", () => {
    const before = richTextFromPlainText("سلام");
    const after = richTextFromPlainText("سلام دنیا");
    const object = { ...makeTextBox("سلام دنیا"), doc: after };
    expect(
      planTextCommit({
        object,
        newlyCreated: false,
        newText: "سلام دنیا",
        newDocJSON: serializeRichText(after),
        baselineDocJSON: serializeRichText(before),
      }),
    ).toEqual({ action: "update", recordHistory: true });
  });

  it("an unchanged doc with a null stored document is a real update (legacy upgrade)", () => {
    // The stored doc is null (legacy box): the planner only compares docs
    // when the object carries one; the plain equality path decides.
    const object = makeTextBox("سلام");
    expect(
      planTextCommit({
        object,
        newlyCreated: false,
        newText: "سلام",
        newDocJSON: serializeRichText(richTextFromPlainText("سلام")),
      }),
    ).toEqual({ action: "update", recordHistory: true });
  });
});

describe("planTextCommit (sticky notes)", () => {
  /** Builds a fully populated sticky note fixture. */
  function makeStickyNote(text: string): StickyNoteObjectData {
    return {
      id: "note-1",
      kind: "stickyNote",
      name: "Note",
      parentId: "group-1",
      position: vec2(10, 20),
      rotation: 0,
      zIndex: 3,
      visible: true,
      locked: false,
      width: 220,
      height: 220,
      text,
      fontSize: DEFAULT_STICKY_FONT_SIZE,
      noteColor: DEFAULT_STICKY_NOTE_COLOR,
      color: DEFAULT_STICKY_INK,
    };
  }

  it("removes a newly created note left empty without recording history", () => {
    expect(plan(makeStickyNote(""), true, "")).toEqual({
      action: "remove",
      recordHistory: false,
    });
  });

  it("adds a newly created note that received real text as an undoable add", () => {
    expect(plan(makeStickyNote(""), true, "یادداشت")).toEqual({
      action: "add",
      recordHistory: true,
    });
  });

  it("removes a pre-existing note that was emptied, recording history", () => {
    expect(plan(makeStickyNote("یادداشت"), false, "")).toEqual({
      action: "remove",
      recordHistory: true,
    });
  });

  it("does nothing when a pre-existing note's text is unchanged", () => {
    expect(plan(makeStickyNote("یادداشت"), false, "یادداشت")).toEqual({
      action: "none",
      recordHistory: false,
    });
  });

  it("updates a pre-existing note with changed text as an undoable update", () => {
    expect(plan(makeStickyNote("یادداشت"), false, "یادداشت جدید")).toEqual({
      action: "update",
      recordHistory: true,
    });
  });
});
