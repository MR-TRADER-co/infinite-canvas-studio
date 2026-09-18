/**
 * Unit tests for the Phase-23 selection clipboard: copy snapshots deep
 * clones with a bbox anchor, cut removes in ONE undo step, paste
 * re-materialises with fresh ids at the viewport centre (cascade for
 * bursts), groups re-map their members, and the outward plain-text
 * projection joins text-bearing kinds only.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  appSelectionClipboard,
  SelectionClipboard,
  copySelectionPayload,
  objectsBBox,
  pasteTranslation,
  plainTextOfObjects,
  type SelectionClipboardPayload,
} from "@/core/clipboard/SelectionClipboard";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { Selection } from "@/core/selection/Selection";
import { Scene } from "@/core/model/Scene";
import { makeGroup, type GroupObjectData } from "@/core/model/GroupObject";
import {
  DEFAULT_STICKY_FONT_SIZE,
  DEFAULT_STICKY_INK,
  DEFAULT_STICKY_NOTE_COLOR,
} from "@/core/model/StickyNoteObject";
import { textBoxFromRect } from "@/core/model/TextBoxObject";
import { makeStickerObject } from "@/core/model/StickerObject";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { StickyNoteObjectData } from "@/core/model/StickyNoteObject";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";

/** Builds a sticky note fixture. */
function makeStickyNote(
  id: string,
  x: number,
  y: number,
  text = "note text",
  width = 200,
  height = 100,
): StickyNoteObjectData {
  return {
    id,
    kind: "stickyNote",
    position: vec2(x, y),
    rotation: 0,
    zIndex: 3,
    visible: true,
    locked: false,
    width,
    height,
    text,
    fontSize: DEFAULT_STICKY_FONT_SIZE,
    noteColor: DEFAULT_STICKY_NOTE_COLOR,
    color: DEFAULT_STICKY_INK,
  };
}

/** Builds a text box fixture through the real factory. */
function makeTextBox(
  id: string,
  x: number,
  y: number,
  text: string,
): TextBoxObjectData {
  return textBoxFromRect(
    { minX: x, minY: y, maxX: x + 260, maxY: y + 64 },
    text,
    16,
    id,
    4,
  );
}

/** Builds a fresh service bundle per test. */
function makeServices(): {
  scene: Scene;
  history: HistoryManager;
  selection: Selection;
  ids: IdGenerator;
} {
  return {
    scene: new Scene(),
    history: new HistoryManager(),
    selection: new Selection(),
    ids: new IdGenerator(),
  };
}

// The paste cascade counters are module-global (one paste stream per
// app): reset them so position assertions stay test-isolated.
beforeEach(() => {
  appSelectionClipboard.clear();
});

describe("copySelectionPayload", () => {
  it("snapshots deep clones with a bbox anchor", () => {
    const { scene, selection } = makeServices();
    scene.add(makeStickyNote("note-1", 10, 20, "سلام", 200, 100));
    selection.replaceAll(["note-1"]);
    const payload = copySelectionPayload(scene, selection);
    expect(payload).not.toBeNull();
    const objects = (payload as SelectionClipboardPayload).objects;
    expect(objects.length).toBe(1);
    expect(objects[0]?.id).toBe("note-1");
    // Deep clone: mutating the live scene does not touch the payload.
    scene.add(makeStickerObject("st-1", "⭐", vec2(1, 1), 48, 5));
    expect(objects.length).toBe(1);
    // Anchor covers the placed extent.
    expect((payload as SelectionClipboardPayload).anchor).toEqual({
      minX: 10,
      minY: 20,
      maxX: 210,
      maxY: 120,
    });
  });

  it("returns null for an empty selection", () => {
    const { scene, selection } = makeServices();
    expect(copySelectionPayload(scene, selection)).toBeNull();
  });

  it("expands groups with their members (parents first)", () => {
    const { scene, selection } = makeServices();
    const a = makeStickyNote("member-a", 0, 0, "A");
    const b = makeStickyNote("member-b", 50, 50, "B");
    scene.add(a);
    scene.add(b);
    const group: GroupObjectData = makeGroup("group-1", [a, b], 9);
    scene.add(group);
    selection.replaceAll(["group-1"]);
    const payload = copySelectionPayload(scene, selection);
    expect(payload).not.toBeNull();
    const objects = (payload as SelectionClipboardPayload).objects;
    expect(objects.map((object) => object.id)).toEqual([
      "group-1",
      "member-a",
      "member-b",
    ]);
  });
});

describe("plainTextOfObjects", () => {
  it("joins text boxes and sticky notes with a blank line", () => {
    const objects: SceneObjectData[] = [
      makeStickyNote("n", 0, 0, "یادداشت"),
      makeTextBox("t", 0, 0, "متن جعبه"),
      makeStickerObject("s", "⭐", vec2(0, 0), 48, 1),
    ];
    expect(plainTextOfObjects(objects)).toBe("یادداشت\n\nمتن جعبه");
  });

  it("skips empty texts and returns null for nothing textual", () => {
    expect(plainTextOfObjects([makeStickyNote("n", 0, 0, "  ")])).toBeNull();
    expect(
      plainTextOfObjects([makeStickerObject("s", "⭐", vec2(0, 0), 48, 1)]),
    ).toBeNull();
  });
});

describe("SelectionClipboard.cut", () => {
  it("copies then removes in one history step and clears the selection", () => {
    const { scene, history, selection } = makeServices();
    scene.add(makeStickyNote("note-1", 0, 0, "متن"));
    scene.add(makeStickyNote("note-2", 100, 0, "دوم"));
    selection.replaceAll(["note-1", "note-2"]);
    const clipboard = new SelectionClipboard();
    const count = clipboard.cut(scene, history, selection);
    expect(count).toBe(2);
    expect(scene.findById("note-1")).toBeUndefined();
    expect(scene.findById("note-2")).toBeUndefined();
    expect(selection.isEmpty()).toBe(true);
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(scene.findById("note-1")).toBeDefined();
    expect(scene.findById("note-2")).toBeDefined();
    // Paste still works after undo (the buffer survives independently).
    const pasted = clipboard.paste(
      scene,
      history,
      selection,
      new IdGenerator(),
      vec2(0, 0),
    );
    expect(pasted).not.toBeNull();
    expect(pasted?.length).toBe(2);
  });
});

describe("SelectionClipboard.paste", () => {
  it("materialises fresh ids at the viewport centre in one undo step", () => {
    const { scene, history, selection } = makeServices();
    scene.add(makeStickyNote("note-1", 0, 0, "متن", 200, 100));
    selection.replaceAll(["note-1"]);
    const clipboard = new SelectionClipboard();
    clipboard.copy(scene, selection);
    selection.clear();
    const pasted = clipboard.paste(
      scene,
      history,
      selection,
      new IdGenerator(),
      vec2(500, 400),
    );
    expect(pasted).not.toBeNull();
    const pastedId = pasted?.[0] ?? "";
    expect(pastedId).not.toBe("note-1");
    const copy = scene.findById(pastedId);
    expect(copy).toBeDefined();
    // Viewport-centre placement: the 200×100 object centres on (500, 400).
    expect(copy?.position.x).toBeCloseTo(400);
    expect(copy?.position.y).toBeCloseTo(350);
    expect(selection.ids).toEqual(new Set([pastedId]));
    // ONE undo step restores the pre-paste scene exactly.
    history.undo();
    expect(scene.findById(pastedId)).toBeUndefined();
    expect(scene.findById("note-1")).toBeDefined();
  });

  it("remaps group membership through fresh ids", () => {
    const { scene, history, selection } = makeServices();
    const a: StickyNoteObjectData = {
      ...makeStickyNote("member-a", 0, 0, "A"),
      parentId: "group-1",
    };
    const b: StickyNoteObjectData = {
      ...makeStickyNote("member-b", 50, 50, "B"),
      parentId: "group-1",
    };
    scene.add(a);
    scene.add(b);
    const group = makeGroup("group-1", [a, b], 9);
    scene.add(group);
    selection.replaceAll(["group-1"]);
    const clipboard = new SelectionClipboard();
    clipboard.copy(scene, selection);
    const pasted = clipboard.paste(
      scene,
      history,
      selection,
      new IdGenerator(),
      vec2(0, 0),
    );
    expect(pasted).not.toBeNull();
    expect(pasted?.[0]).not.toBe("group-1");
    const pastedGroup = scene.findById(pasted?.[0] ?? "");
    expect(pastedGroup).toBeDefined();
    expect(pastedGroup?.kind).toBe("group");
    const childIds = (pastedGroup as GroupObjectData | undefined)?.childIds;
    expect(childIds?.length).toBe(2);
    expect(childIds).not.toContain("member-a");
    expect(childIds).not.toContain("member-b");
    for (const childId of childIds ?? []) {
      const child = scene.findById(childId);
      expect(child).toBeDefined();
      expect(child?.parentId).toBe(pasted?.[0]);
    }
  });

  it("cascades successive pastes within the window", () => {
    const { scene, history, selection } = makeServices();
    scene.add(makeStickyNote("note-1", 0, 0, "متن", 100, 50));
    selection.replaceAll(["note-1"]);
    const clipboard = new SelectionClipboard();
    clipboard.copy(scene, selection);
    const payload = {
      objects: [makeStickyNote("note-1", 0, 0, "متن", 100, 50)],
      topLevelIds: ["note-1"],
      anchor: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      copiedAt: Date.now(),
    } satisfies SelectionClipboardPayload;
    const centre: Vec2 = vec2(0, 0);
    const first = pasteTranslation(payload, centre);
    const second = pasteTranslation(payload, centre);
    expect(second.x - first.x).toBeGreaterThan(0);
    expect(second.y - first.y).toBeGreaterThan(0);
    // And the real paste lands offset between two consecutive calls
    // (ONE shared id generator, as the app graph provides).
    const ids = new IdGenerator();
    const pasted1 = clipboard.paste(
      scene,
      history,
      selection,
      ids,
      vec2(0, 0),
    );
    const pasted2 = clipboard.paste(
      scene,
      history,
      selection,
      ids,
      vec2(0, 0),
    );
    const o1 = scene.findById(pasted1?.[0] ?? "");
    const o2 = scene.findById(pasted2?.[0] ?? "");
    expect(o1).toBeDefined();
    expect(o2).toBeDefined();
    expect(o2?.position.x ?? 0).toBeGreaterThan(o1?.position.x ?? 0);
    expect(o2?.position.y ?? 0).toBeGreaterThan(o1?.position.y ?? 0);
  });
});

describe("objectsBBox", () => {
  it("unions the placed extents", () => {
    expect(
      objectsBBox([
        makeStickyNote("a", 0, 0, "x", 100, 50),
        makeStickyNote("b", 200, 100, "y", 60, 60),
      ]),
    ).toEqual({ minX: 0, minY: 0, maxX: 260, maxY: 160 });
  });
});
