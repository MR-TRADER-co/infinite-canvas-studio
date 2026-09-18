import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blankTemplate,
  findTemplate,
  kanbanTemplate,
  meetingNotesTemplate,
  mindMapTemplate,
  TEMPLATES,
  weeklyPlannerTemplate,
  frameStoryboardTemplate,
  __resetTemplateIds,
} from "@/core/templates/templates";
import { VersionedSerializer } from "@/persistence/VersionedSerializer";
import { registerCoreObjectTypes } from "@/persistence/objectTypes";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import { isFrameObject } from "@/core/model/FrameObject";
import { isStickyNoteObject } from "@/core/model/StickyNoteObject";
import { isTextBoxObject } from "@/core/model/TextBoxObject";

describe("Templates (R8.4 / AC8.6)", () => {
  const serializer = new VersionedSerializer(
    registerCoreObjectTypes(new ObjectRegistry()),
  );

  it("offers the spec's gallery: blank, meeting notes, kanban, mind map, weekly planner", () => {
    const ids = TEMPLATES.map((template) => template.id);
    expect(ids).toContain("blank");
    expect(ids).toContain("meeting-notes");
    expect(ids).toContain("kanban");
    expect(ids).toContain("mind-map");
    expect(ids).toContain("weekly-planner");
    expect(findTemplate("kanban")).toBe(kanbanTemplate);
    expect(findTemplate("nope")).toBeNull();
  });

  it("every template builds a serialisable, re-loadable ProjectData", () => {
    for (const template of TEMPLATES) {
      __resetTemplateIds();
      const data = template.build();
      const raw = serializer.serialize(data);
      const outcome = serializer.deserialize(raw);
      expect(outcome.status).toBe("ok");
      if (outcome.status === "ok") {
        expect(outcome.data.objects.length).toBe(data.objects.length);
      }
    }
  });

  it("blank is truly empty", () => {
    expect(blankTemplate.build().objects).toEqual([]);
  });

  it("meeting notes carries agenda + action items (task lists)", () => {
    __resetTemplateIds();
    const data = meetingNotesTemplate.build();
    const boxes = data.objects.filter(isTextBoxObject);
    expect(boxes.length).toBeGreaterThan(0);
    const doc = JSON.stringify(boxes[0]?.doc);
    expect(doc).toContain("taskList");
    expect(doc).toContain("دستور جلسه");
    expect(doc).toContain("اقدام‌ها");
  });

  it("kanban is RTL: «در انتظار» is the RIGHTMOST column (AC8.6)", () => {
    __resetTemplateIds();
    const data = kanbanTemplate.build();
    const columns = data.objects.filter(
      (object) =>
        object.kind === "shape" &&
        (object as unknown as { width: number }).width === 300,
    ) as Array<{ position: { x: number } }>;
    expect(columns.length).toBe(3);
    const xs = columns.map((column) => column.position.x);
    // The FIRST column (در انتظار) paints at the HIGHEST x (right side).
    expect(xs[0] ?? -1).toBeGreaterThan(xs[1] ?? -1);
    expect(xs[1] ?? -1).toBeGreaterThan(xs[2] ?? -1);
    const labels = data.objects.filter(isTextBoxObject).map((box) => box.text);
    expect(labels).toContain("در انتظار");
    expect(labels).toContain("در حال انجام");
    expect(labels).toContain("انجام‌شده");
    // Sample notes exist in the columns.
    const notes = data.objects.filter(isStickyNoteObject);
    expect(notes.length).toBeGreaterThanOrEqual(4);
  });

  it("mind map has a centre + branches + connectors", () => {
    __resetTemplateIds();
    const data = mindMapTemplate.build();
    const connectors = data.objects.filter(
      (object) => object.kind === "connector",
    );
    expect(connectors.length).toBe(4);
    const shapes = data.objects.filter((object) => object.kind === "shape");
    expect(shapes.length).toBe(5); // centre + 4 branches
  });

  it("weekly planner lays out seven RTL day columns", () => {
    __resetTemplateIds();
    const data = weeklyPlannerTemplate.build();
    const labels = data.objects.filter(isTextBoxObject).map((box) => box.text);
    for (const day of ["شنبه", "یکشنبه", "دوشنبه", "جمعه"]) {
      expect(labels).toContain(day);
    }
    const columns = data.objects.filter(
      (object) =>
        object.kind === "shape" &&
        (object as unknown as { width: number }).width === 170,
    );
    expect(columns.length).toBe(7);
  });

  it("frame storyboard ships two presentation-ready frames", () => {
    __resetTemplateIds();
    const data = frameStoryboardTemplate.build();
    const frames = data.objects.filter(isFrameObject);
    expect(frames.length).toBe(2);
    expect((frames[0] as { title: string }).title).toBe("اسلاید عنوان");
  });

  it("the shipped .icb resources parse back into the builders' payloads", () => {
    const dir = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "public",
      "templates",
    );
    for (const template of TEMPLATES) {
      const raw = readFileSync(join(dir, `${template.id}.icb`), "utf-8");
      const outcome = serializer.deserialize(raw);
      expect(outcome.status).toBe("ok");
      if (outcome.status === "ok") {
        expect(outcome.data.objects.length).toBe(
          template.build().objects.length,
        );
      }
    }
  });
});
