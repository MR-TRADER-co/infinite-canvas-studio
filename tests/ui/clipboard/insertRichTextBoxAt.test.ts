// @vitest-environment jsdom
/**
 * Unit tests for the فاز-۲۴ rich paste-in COMMIT pipeline: a parsed rich
 * document lands as a text box whose `doc` is the source of truth (the
 * plain `text` projection kept for legacy consumers), the width behaviour
 * is FIXED (Word-like wrapping), the size heuristic widens for tables,
 * ONE undo step removes it, and the burst cascade snaps to the grid.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { insertRichTextBoxAt } from "@/ui/clipboard/canvasImport";
import {
  resetPasteCascade,
  PASTE_CASCADE_STEP,
} from "@/ui/clipboard/canvasImport";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { Selection } from "@/core/selection/Selection";
import { Scene } from "@/core/model/Scene";
import { EventBus } from "@/core/events/EventBus";
import { useUiStore } from "@/ui/store/uiStore";
import { vec2 } from "@/core/geometry/Vec2";
import { createTableDocument, type RichTextDocument } from "@/text/editor/richtext";
import { isTextBoxObject } from "@/core/model/TextBoxObject";

/** A formatted document: heading + bold paragraph. */
function formattedDoc(): RichTextDocument {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "سرتیتر جلسه" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "نکتهٔ " },
          { type: "text", text: "مهم", marks: [{ type: "bold" }] },
        ],
      },
    ],
  } as RichTextDocument;
}

/** Builds a fresh service bundle per test. */
function makeServices(): Parameters<typeof insertRichTextBoxAt>[0] & {
  readonly scene: Scene;
  readonly history: HistoryManager;
  readonly selection: Selection;
} {
  const scene = new Scene();
  const history = new HistoryManager();
  const selection = new Selection();
  const bus = new EventBus();
  return {
    scene,
    history,
    selection,
    bus,
    ids: new IdGenerator(),
  };
}

beforeEach(() => {
  resetPasteCascade();
  const state = useUiStore.getState();
  state.setSnapEnabled(false);
});

describe("insertRichTextBoxAt", () => {
  it("commits a rich text box whose doc is the source of truth", () => {
    const services = makeServices();
    const doc = formattedDoc();
    const ok = insertRichTextBoxAt(services, doc, "سرتیتر جلسه\nنکتهٔ مهم", vec2(400, 300));
    expect(ok).toBe(true);
    expect(services.scene.objectCount).toBe(1);
    const object = services.scene.objects[0] ?? null;
    expect(object).not.toBeNull();
    if (object === null) {
      return;
    }
    expect(isTextBoxObject(object)).toBe(true);
    if (isTextBoxObject(object)) {
      expect(object.doc).toEqual(doc);
      expect(object.text).toBe("سرتیتر جلسه\nنکتهٔ مهم");
      expect(object.sizeMode).toBe("fixed");
      // Centred placement: the box straddles the target point.
      expect(object.position.x).toBeLessThan(400);
      expect(object.position.x + object.width).toBeGreaterThan(400);
    }
    expect(services.selection.ids.has(object.id)).toBe(true);
  });

  it("widens the box for table documents (cols × TABLE_COL_WIDTH)", () => {
    const services = makeServices();
    const doc = createTableDocument(4, 5);
    insertRichTextBoxAt(services, doc, "", vec2(0, 0));
    const object = services.scene.objects[0] ?? null;
    expect(object).not.toBeNull();
    if (object !== null) {
      expect(isTextBoxObject(object)).toBe(true);
      if (isTextBoxObject(object)) {
        // 5 columns × 110 world units (+ padding) — far beyond the plain
        // default width of 260.
        expect(object.width).toBeGreaterThanOrEqual(5 * 110);
      }
    }
  });

  it("records ONE undo step that removes the rich box", () => {
    const services = makeServices();
    insertRichTextBoxAt(services, formattedDoc(), "متن", vec2(0, 0));
    expect(services.scene.objectCount).toBe(1);
    services.history.undo();
    expect(services.scene.objectCount).toBe(0);
    expect(services.history.canUndo()).toBe(false);
  });

  it("cascades burst pastes by the shared step", () => {
    const services = makeServices();
    insertRichTextBoxAt(services, formattedDoc(), "a", vec2(0, 0));
    insertRichTextBoxAt(services, formattedDoc(), "b", vec2(0, 0));
    const [first, second] = services.scene.objects;
    expect(
      (second?.position.y ?? 0) - (first?.position.y ?? 0),
    ).toBe(PASTE_CASCADE_STEP);
  });
});
