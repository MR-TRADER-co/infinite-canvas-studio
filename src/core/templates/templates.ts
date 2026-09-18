/**
 * Project templates (R8.4): the five starters the "New" gallery offers —
 * Blank, Meeting Notes (Persian agenda + action items), Kanban (RTL
 * columns), Mind Map and Weekly Planner.
 *
 * Each template is a PURE builder returning {@link ProjectData}; the
 * same builders generate the `.icb` files shipped in the app resources
 * (`public/templates/*.icb`, produced by the checked-in generation
 * script) AND serve as the offline fallback when a resource fetch
 * fails — one source of truth, byte-identical payloads.
 *
 * RTL convention: template content is authored for Persian reading
 * order — the FIRST column of the Kanban board sits at the HIGHEST
 * world x (the right side of the default view), «در انتظار» → «در حال
 * انجام» → «انجام‌شده» reading right-to-left (AC8.6).
 */
import type { ProjectData } from "@/persistence/ProjectFile";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import { TEXT_COLOR_TOKEN } from "@/core/model/TextBoxObject";
import type { StickyNoteObjectData } from "@/core/model/StickyNoteObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import type { ConnectorObjectData } from "@/core/model/ConnectorObject";
import { makeFrameObject } from "@/core/model/FrameObject";
import type { RichTextDocument } from "@/text/editor/richtext";

/** One gallery entry: metadata + the builder. */
export interface TemplateDefinition {
  /** Stable file id (`blank`, `kanban`, …). */
  readonly id: string;
  /** Persian gallery title (shown verbatim — template data, not i18n). */
  readonly title: string;
  /** Persian gallery description. */
  readonly description: string;
  /** Builds the project the template creates. */
  readonly build: () => ProjectData;
}

/** Neutral camera a template opens with (content centred at origin). */
const DEFAULT_CAMERA = { x: -480, y: -340, zoom: 1, rotation: 0 };

/** Id counter scoped per build (fresh objects every call). */
let templateCounter = 0;

/**
 * @param prefix - the id prefix (per template).
 * @returns a unique template object id.
 */
function nextId(prefix: string): string {
  templateCounter += 1;
  return `tpl-${prefix}-${templateCounter}`;
}

/**
 * A text box carrying a rich document (headings, task lists, ...).
 *
 * @param prefix - id prefix.
 * @param x - world x (top-left).
 * @param y - world y.
 * @param width - box width.
 * @param doc - the rich document.
 * @param fontSize - font size.
 * @param extra - optional overrides.
 * @returns the text object data.
 */
function richTextBox(
  prefix: string,
  x: number,
  y: number,
  width: number,
  doc: RichTextDocument,
  fontSize: number,
  extra: Partial<Pick<TextBoxObjectData, "height" | "name">> = {},
): TextBoxObjectData {
  return {
    kind: "textBox",
    id: nextId(prefix),
    name: extra.name,
    position: { x, y },
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    width,
    height: extra.height ?? 200,
    text: "",
    doc,
    sizeMode: "auto",
    fontSize,
    color: TEXT_COLOR_TOKEN,
  };
}

/**
 * A plain-text object (single paragraph).
 *
 * @param prefix - id prefix.
 * @param x - world x.
 * @param y - world y.
 * @param width - box width.
 * @param text - the plain text.
 * @param fontSize - font size.
 * @param extra - optional overrides.
 * @returns the text object data.
 */
function plainTextBox(
  prefix: string,
  x: number,
  y: number,
  width: number,
  text: string,
  fontSize: number,
  extra: Partial<Pick<TextBoxObjectData, "height" | "name">> = {},
): TextBoxObjectData {
  return {
    kind: "textBox",
    id: nextId(prefix),
    name: extra.name,
    position: { x, y },
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    width,
    height: extra.height ?? 64,
    text,
    doc: null,
    sizeMode: "auto",
    fontSize,
    color: TEXT_COLOR_TOKEN,
  };
}

/**
 * A sticky note card.
 *
 * @param prefix - id prefix.
 * @param x - world x.
 * @param y - world y.
 * @param text - the note text.
 * @param noteColor - the pastel card colour (oklch literal).
 * @returns the sticky note data.
 */
function sticky(
  prefix: string,
  x: number,
  y: number,
  text: string,
  noteColor: string,
): StickyNoteObjectData {
  return {
    kind: "stickyNote",
    id: nextId(prefix),
    position: { x, y },
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    width: 200,
    height: 200,
    text,
    fontSize: 18,
    noteColor,
    color: "oklch(0.30 0.03 55)",
  };
}

/**
 * A shape backdrop.
 *
 * @param prefix - id prefix.
 * @param x - world x.
 * @param y - world y.
 * @param width - shape width.
 * @param height - shape height.
 * @param shapeKind - the primitive.
 * @returns the shape object data.
 */
function shape(
  prefix: string,
  x: number,
  y: number,
  width: number,
  height: number,
  shapeKind: ShapeObjectData["shapeKind"],
): ShapeObjectData {
  return {
    kind: "shape",
    id: nextId(prefix),
    position: { x, y },
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    shapeKind,
    width,
    height,
    fill: "accent",
    stroke: "primary",
    strokeWidth: 2,
  };
}

/**
 * A floating connector between two world points (no glue — the mind-map
 * starter's branches stay put).
 *
 * @param prefix - id prefix.
 * @param from - start point.
 * @param to - end point.
 * @returns the connector data.
 */
function connector(
  prefix: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): ConnectorObjectData {
  return {
    kind: "connector",
    id: nextId(prefix),
    position: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    start: { objectId: null, anchorIndex: 0, position: { ...from } },
    end: { objectId: null, anchorIndex: 0, position: { ...to } },
    routingKind: "straight",
    strokeColor: "primary",
    strokeWidth: 2,
    strokeStyle: "solid",
    startArrow: "none",
    endArrow: "arrow",
  };
}

/**
 * Stamps paint order over the built objects (z = array index) so layers
 * and rendering behave deterministically.
 *
 * @param objects - the template's objects.
 * @returns the objects with sequential z indices.
 */
function withZOrder(objects: SceneObjectData[]): SceneObjectData[] {
  return objects.map((object, index) => ({ ...object, zIndex: index }));
}

/** A text node helper for documents. */
function text$(value: string): { type: "text"; text: string } {
  return { type: "text", text: value };
}

/** A paragraph node helper. */
function paragraph(value: string): {
  type: "paragraph";
  content: ReturnType<typeof text$>[];
} {
  return { type: "paragraph", content: [text$(value)] };
}

/** A heading node helper. */
function heading(
  level: 1 | 2 | 3,
  value: string,
): {
  type: "heading";
  attrs: { level: number };
  content: ReturnType<typeof text$>[];
} {
  return { type: "heading", attrs: { level }, content: [text$(value)] };
}

/** A task list node helper (action items, R8.4). */
function taskList(items: readonly string[]): {
  type: "taskList";
  content: Array<{
    type: "taskItem";
    attrs: { checked: boolean };
    content: Array<ReturnType<typeof paragraph>>;
  }>;
} {
  return {
    type: "taskList",
    content: items.map((item) => ({
      type: "taskItem",
      attrs: { checked: false },
      content: [paragraph(item)],
    })),
  };
}

/* ── Blank ─────────────────────────────────────────────────────────── */

/** The empty board — the plain new-project path. */
export const blankTemplate: TemplateDefinition = {
  id: "blank",
  title: "بوم خالی",
  description: "شروعی پاک و بدون هیچ شیئی.",
  build: (): ProjectData => ({
    camera: { ...DEFAULT_CAMERA },
    objects: [],
    plugins: {},
  }),
};

/* ── Meeting Notes ─────────────────────────────────────────────────── */

/** Persian meeting-notes starter: agenda + action items with task lists. */
export const meetingNotesTemplate: TemplateDefinition = {
  id: "meeting-notes",
  title: "یادداشت جلسه",
  description: "دستور جلسه، شرکت‌کنندگان و فهرست اقدام‌ها با چک‌لیست.",
  build: (): ProjectData => {
    const objects: SceneObjectData[] = [
      richTextBox(
        "meeting",
        -400,
        -300,
        560,
        {
          type: "doc",
          content: [
            heading(1, "جلسهٔ محصول — هفتگی"),
            paragraph("تاریخ: — — —"),
            paragraph("شرکت‌کنندگان: —"),
            heading(2, "دستور جلسه"),
            taskList([
              "مرور کارهای پیشین",
              "وضعیت مسیر محصول",
              "موانع و ریسک‌ها",
              "تصمیم‌های لازم",
            ]),
            heading(2, "اقدام‌ها"),
            taskList([
              "مسئول: — · مهلت: —",
              "مسئول: — · مهلت: —",
              "مسئول: — · مهلت: —",
            ]),
          ],
        },
        20,
        { height: 560, name: "یادداشت جلسه" },
      ),
      sticky(
        "meeting",
        220,
        -300,
        "ایده‌های مطرح‌شده را اینجا یادداشت کنید…",
        "oklch(0.87 0.14 85)",
      ),
      sticky("meeting", 220, -60, "سؤال‌های باز…", "oklch(0.75 0.14 235)"),
    ];
    return {
      camera: { ...DEFAULT_CAMERA },
      objects: withZOrder(objects),
      plugins: {},
    };
  },
};

/* ── Kanban (RTL) ──────────────────────────────────────────────────── */

/** Kanban column descriptor. */
interface KanbanColumn {
  readonly label: string;
  readonly noteColor: string;
  readonly sample: readonly string[];
}

/** The three RTL columns: first = rightmost on the board (AC8.6). */
const KANBAN_COLUMNS: readonly KanbanColumn[] = [
  {
    label: "در انتظار",
    noteColor: "oklch(0.80 0.12 250)",
    sample: ["وظیفهٔ نمونه ۱", "وظیفهٔ نمونه ۲"],
  },
  {
    label: "در حال انجام",
    noteColor: "oklch(0.83 0.14 85)",
    sample: ["وظیفهٔ در جریان"],
  },
  {
    label: "انجام‌شده",
    noteColor: "oklch(0.82 0.13 150)",
    sample: ["وظیفهٔ تمام‌شده ✓"],
  },
];

/** Column geometry (world units). */
const KANBAN_COLUMN_WIDTH = 300;
const KANBAN_COLUMN_HEIGHT = 620;
const KANBAN_GAP = 24;

/** RTL Kanban board: columns ordered right → left. */
export const kanbanTemplate: TemplateDefinition = {
  id: "kanban",
  title: "برد کانبان",
  description: "سه ستون راست‌به‌چپ: در انتظار، در حال انجام، انجام‌شده.",
  build: (): ProjectData => {
    const objects: SceneObjectData[] = [];
    const boardWidth =
      KANBAN_COLUMNS.length * KANBAN_COLUMN_WIDTH +
      (KANBAN_COLUMNS.length - 1) * KANBAN_GAP;
    // Author for RTL: index 0 = در انتظار paints at the RIGHT edge.
    KANBAN_COLUMNS.forEach((column, index) => {
      const xRight = 300 + boardWidth / 2;
      const x =
        xRight -
        KANBAN_COLUMN_WIDTH -
        index * (KANBAN_COLUMN_WIDTH + KANBAN_GAP);
      objects.push(
        shape(
          "kanban",
          x,
          -280,
          KANBAN_COLUMN_WIDTH,
          KANBAN_COLUMN_HEIGHT,
          "roundedRectangle",
        ),
      );
      objects.push(
        plainTextBox(
          "kanban",
          x + 16,
          -260,
          KANBAN_COLUMN_WIDTH - 32,
          column.label,
          22,
          {
            height: 40,
            name: column.label,
          },
        ),
      );
      column.sample.forEach((sample, noteIndex) => {
        objects.push(
          sticky(
            "kanban",
            x + 40,
            -200 + noteIndex * 220,
            sample,
            column.noteColor,
          ),
        );
      });
    });
    return {
      camera: { ...DEFAULT_CAMERA },
      objects: withZOrder(objects),
      plugins: {},
    };
  },
};

/* ── Mind Map ──────────────────────────────────────────────────────── */

/** Mind-map starter: central topic + four branches with connectors. */
export const mindMapTemplate: TemplateDefinition = {
  id: "mind-map",
  title: "نقشهٔ ذهنی",
  description: "موضوع مرکزی با چهار شاخه و خطوط اتصال.",
  build: (): ProjectData => {
    const center = { x: -120, y: -60 };
    const branches = [
      { label: "شاخهٔ ۱", x: -560, y: -260 },
      { label: "شاخهٔ ۲", x: 320, y: -260 },
      { label: "شاخهٔ ۳", x: -560, y: 120 },
      { label: "شاخهٔ ۴", x: 320, y: 120 },
    ];
    const objects: SceneObjectData[] = [
      shape("mindmap", center.x, center.y, 240, 120, "roundedRectangle"),
      richTextBox(
        "mindmap",
        center.x + 20,
        center.y + 34,
        200,
        { type: "doc", content: [heading(2, "موضوع مرکزی")] },
        20,
        { height: 60 },
      ),
    ];
    for (const branch of branches) {
      objects.push(
        shape("mindmap", branch.x, branch.y, 200, 90, "roundedRectangle"),
      );
      objects.push(
        plainTextBox(
          "mindmap",
          branch.x + 20,
          branch.y + 26,
          160,
          branch.label,
          18,
          {
            height: 40,
          },
        ),
      );
      // Connector from the centre's edge to the branch's edge.
      const from = {
        x: branch.x < center.x ? center.x : center.x + 240,
        y: center.y + 60,
      };
      const to = {
        x: branch.x < center.x ? branch.x + 200 : branch.x,
        y: branch.y + 45,
      };
      objects.push(connector("mindmap", from, to));
    }
    return {
      camera: { ...DEFAULT_CAMERA },
      objects: withZOrder(objects),
      plugins: {},
    };
  },
};

/* ── Weekly Planner ────────────────────────────────────────────────── */

/** Persian week (Saturday first). */
const WEEK_DAYS: readonly string[] = [
  "شنبه",
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
];

/** Weekly planner: 7 day columns (RTL) + a notes strip. */
export const weeklyPlannerTemplate: TemplateDefinition = {
  id: "weekly-planner",
  title: "برنامهٔ هفتگی",
  description: "هفت ستون روزهای هفته (شنبه تا جمعه) و ناحیهٔ یادداشت.",
  build: (): ProjectData => {
    const objects: SceneObjectData[] = [];
    const columnWidth = 170;
    const columnHeight = 480;
    const gap = 16;
    const boardWidth =
      WEEK_DAYS.length * columnWidth + (WEEK_DAYS.length - 1) * gap;
    const xRight = boardWidth / 2;
    objects.push(
      richTextBox(
        "week",
        -260,
        -380,
        520,
        {
          type: "doc",
          content: [heading(1, "برنامهٔ هفته"), paragraph("هفتهٔ: —")],
        },
        24,
        { height: 90 },
      ),
    );
    WEEK_DAYS.forEach((day, index) => {
      // RTL authoring: شنبه (index 0) is the RIGHTMOST column.
      const x = xRight - columnWidth - index * (columnWidth + gap);
      objects.push(
        shape("week", x, -260, columnWidth, columnHeight, "roundedRectangle"),
      );
      objects.push(
        plainTextBox("week", x + 12, -244, columnWidth - 24, day, 20, {
          height: 36,
          name: day,
        }),
      );
    });
    objects.push(
      sticky("week", -220, 260, "یادداشت‌های هفته…", "oklch(0.87 0.14 85)"),
    );
    return {
      camera: { ...DEFAULT_CAMERA },
      objects: withZOrder(objects),
      plugins: {},
    };
  },
};

/* ── Frame storyboard (bonus gallery entry, R8.3 showcase) ─────────── */

/** Frame-based storyboard: two presentation slides ready for F5. */
export const frameStoryboardTemplate: TemplateDefinition = {
  id: "frame-storyboard",
  title: "استوری‌برد ارائه",
  description:
    "دو قاب آماده برای حالت ارائه (F5) — قاب اول: عنوان، قاب دوم: محتوا.",
  build: (): ProjectData => {
    const frameA = makeFrameObject(nextId("story"), 1, { x: -660, y: -360 });
    const frameB = makeFrameObject(nextId("story"), 2, { x: 60, y: -360 });
    const objects: SceneObjectData[] = [
      { ...frameA, title: "اسلاید عنوان" } as typeof frameA,
      { ...frameB, title: "اسلاید محتوا" } as typeof frameB,
      richTextBox(
        "story",
        frameA.position.x + 120,
        frameA.position.y + 140,
        400,
        {
          type: "doc",
          content: [
            heading(1, "عنوان ارائه"),
            paragraph("زیرعنوان یا معرفی کوتاه"),
          ],
        },
        28,
        { height: 120 },
      ),
      richTextBox(
        "story",
        frameB.position.x + 60,
        frameB.position.y + 120,
        520,
        {
          type: "doc",
          content: [
            heading(2, "نکات کلیدی"),
            taskList(["نکتهٔ اول", "نکتهٔ دوم", "نکتهٔ سوم"]),
          ],
        },
        22,
        { height: 200 },
      ),
    ];
    return {
      camera: { x: -480, y: -300, zoom: 0.85, rotation: 0 },
      objects: withZOrder(objects),
      plugins: {},
    };
  },
};

/** Every gallery template, in display order. */
export const TEMPLATES: readonly TemplateDefinition[] = [
  blankTemplate,
  meetingNotesTemplate,
  kanbanTemplate,
  mindMapTemplate,
  weeklyPlannerTemplate,
  frameStoryboardTemplate,
];

/**
 * Looks a template up by id.
 *
 * @param id - the template file id.
 * @returns the definition, or null for unknown ids.
 */
export function findTemplate(id: string): TemplateDefinition | null {
  return TEMPLATES.find((template) => template.id === id) ?? null;
}

/**
 * Resets the id counter (test isolation — each build gets fresh ids).
 */
export function __resetTemplateIds(): void {
  templateCounter = 0;
}
