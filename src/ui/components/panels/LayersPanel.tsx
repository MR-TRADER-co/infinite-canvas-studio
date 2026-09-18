"use client";

/**
 * Layers panel body (R7.1): the scene tree in z-order, registered as the
 * `core.panels.layers` dock panel.
 *
 * Rows list objects top-most first (reverse paint order). Groups are
 * expandable (chevron; children indent under the group row); per-row
 * affordances: type icon, name (double-click rename), visibility eye,
 * lock, and POINTER-drag reordering of top-level rows (a drop indicator
 * tracks the insertion slot; release commits ONE `ReorderCommand`).
 * Multi-select syncs two-way with the canvas selection (row clicks
 * select; canvas selections highlight rows). Every mutation flows
 * through commands onto history (CLAUDE.md §1.5).
 */
import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  ChevronDown,
  ChevronLeft,
  Circle,
  Diamond,
  Eye,
  EyeOff,
  Film,
  Frame,
  HelpCircle,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Music,
  Pen,
  Puzzle,
  Search,
  Shapes,
  Smile,
  Spline,
  Square,
  Squircle,
  Star,
  StickyNote,
  Triangle,
  Type,
  FileText,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  SHAPE_KINDS,
  type ShapeKind,
  isShapeObject,
} from "@/core/model/ShapeObject";
import { isGroupObject, type GroupObjectData } from "@/core/model/GroupObject";
import type {
  SceneObjectData,
  SceneObjectKind,
} from "@/core/model/SceneObject";
import { useLayersModel, type LayersModel } from "@/ui/hooks/useLayersModel";
import { useTranslation } from "@/ui/i18n";
import type { TranslationKey } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import { cn } from "@/lib/utils";

/** Icon of every shape primitive (mirrors the toolbar picker). */
const SHAPE_ICONS: { [K in ShapeKind]: LucideIcon } = {
  rectangle: Square,
  roundedRectangle: Squircle,
  ellipse: Circle,
  triangle: Triangle,
  diamond: Diamond,
  star: Star,
};

/** Icon of every non-shape object kind. */
const KIND_ICONS: { [K in SceneObjectKind]: LucideIcon } = {
  shape: Shapes,
  freehand: Pen,
  textBox: Type,
  stickyNote: StickyNote,
  image: ImageIcon,
  video: Film,
  audio: Music,
  pdf: FileText,
  connector: Spline,
  group: Boxes,
  opaque: HelpCircle,
  frame: Frame,
  plugin: Puzzle,
  sticker: Smile,
  query: Search,
};

/** i18n key of every non-shape kind label (shape kinds reuse shape.kind.*). */
const KIND_LABEL_KEYS: { [K in SceneObjectKind]: TranslationKey } = {
  shape: "tool.shape",
  freehand: "object.freehand",
  textBox: "object.textBox",
  stickyNote: "object.stickyNote",
  image: "object.image",
  video: "object.video",
  audio: "object.audio",
  pdf: "object.pdf",
  connector: "object.connector",
  group: "object.group",
  opaque: "object.opaque",
  frame: "object.frame",
  plugin: "object.plugin",
  sticker: "object.sticker",
  query: "object.query",
};

/** Shared classes of the compact row icon buttons (≥28px touch targets). */
const ROW_BUTTON =
  "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors " +
  "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring";

/** Screen-pixel movement before a row press becomes a drag reorder. */
const ROW_DRAG_THRESHOLD_PX = 4;

/**
 * @returns the layers panel body (row list) mounted inside the dock.
 */
export default function LayersPanelBody(): ReactElement {
  const { t, language } = useTranslation();
  const model = useLayersModel();

  const counters = new Map<string, number>();
  const numbered = model.objects.map((object) => {
    const key = isShapeObject(object)
      ? `shape:${object.shapeKind}`
      : object.kind;
    const number = (counters.get(key) ?? 0) + 1;
    counters.set(key, number);
    return { object, number };
  });
  // Top-most first (reverse paint order).
  const rows = numbered.reverse();

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [drag, setDrag] = useState<{
    id: string;
    fromIndex: number;
    pointerId: number;
  } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Rows including expanded group children (children directly under their
  // group's row; child rows never drag-reorder — their z follows the group).
  const visible: Array<{
    object: SceneObjectData;
    number: number;
    depth: 0 | 1;
  }> = [];
  for (const row of rows) {
    visible.push({ ...row, depth: 0 });
    if (
      isGroupObject(row.object) &&
      expanded.has(row.object.id) &&
      drag === null
    ) {
      for (const childId of row.object.childIds) {
        const child = model.objects.find(
          (candidate) => candidate.id === childId,
        );
        if (child !== undefined) {
          visible.push({ object: child, number: 0, depth: 1 });
        }
      }
    }
  }

  /**
   * Commits the row drag as ONE reorder command: panel index → array
   * index (reversed), then `from` → `to` through the ReorderCommand.
   *
   * @param toPanelIndex - the drop slot (panel order).
   */
  const commitReorder = (toPanelIndex: number): void => {
    if (drag === null) {
      return;
    }
    const count = rows.length;
    const fromArray = count - 1 - drag.fromIndex;
    // Dropping "after row i" in panel order maps to the array slot ABOVE
    // that row: arrayTo = count - 1 - toPanelIndex, clamped.
    const toArray = Math.min(Math.max(count - 1 - toPanelIndex, 0), count - 1);
    if (fromArray !== toArray) {
      model.reorderArray(drag.id, fromArray, toArray);
    }
  };

  return (
    <div
      className="px-1.5 py-1.5"
      onPointerUp={() => {
        if (drag !== null && dropIndex !== null) {
          commitReorder(dropIndex);
        }
        setDrag(null);
        setDropIndex(null);
      }}
      onPointerCancel={() => {
        setDrag(null);
        setDropIndex(null);
      }}
    >
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs leading-6 text-muted-foreground/80">
          {t("layers.empty")}
        </p>
      ) : (
        <ol ref={listRef} className="space-y-0.5">
          {rows.map(({ object, number }, index) => {
            const group = isGroupObject(object) ? object : null;
            const isExpanded = group !== null && expanded.has(group.id);
            return (
              <li key={object.id} className="relative">
                <LayersRow
                  object={object}
                  number={number}
                  selected={model.selectedIds.has(object.id)}
                  topMost={index === 0}
                  bottomMost={index === rows.length - 1}
                  model={model}
                  leading={
                    group !== null ? (
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-label={t("layers.toggleGroup")}
                        onClick={() => {
                          const next = new Set(expanded);
                          if (next.has(group.id)) {
                            next.delete(group.id);
                          } else {
                            next.add(group.id);
                          }
                          setExpanded(next);
                        }}
                        className={cn(ROW_BUTTON, "size-6")}
                      >
                        {isExpanded ? (
                          <ChevronDown
                            className="size-3.5"
                            aria-hidden="true"
                          />
                        ) : (
                          <ChevronLeft
                            className="size-3.5 rtl:rotate-180"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    ) : null
                  }
                  onDragStart={(pointerId) => {
                    setDrag({ id: object.id, fromIndex: index, pointerId });
                    setDropIndex(index);
                  }}
                  dragging={drag?.id === object.id}
                />
                {group !== null && isExpanded && drag === null
                  ? group.childIds.map((childId) => {
                      const child = model.objects.find(
                        (candidate) => candidate.id === childId,
                      );
                      if (child === undefined) {
                        return null;
                      }
                      return (
                        <LayersRow
                          key={child.id}
                          object={child}
                          number={0}
                          selected={model.selectedIds.has(child.id)}
                          topMost={false}
                          bottomMost={false}
                          model={model}
                          depth={1}
                        />
                      );
                    })
                  : null}
                {dropIndex === index &&
                  drag !== null &&
                  drag.id !== object.id && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-inline-start-0 -top-0.5 h-0.5 w-full rounded bg-primary"
                    />
                  )}
              </li>
            );
          })}
        </ol>
      )}
      <span className="sr-only">
        {formatInteger(model.objects.length, language)}
      </span>
    </div>
  );
}

/**
 * One layers row: icon, name (inline rename), selection highlight and the
 * visibility/lock/z-order controls.
 *
 * @param props - row props (object, per-kind number, selection/bounds
 *   flags, model, depth, optional leading slot + drag-start callback).
 * @returns the row element.
 */
function LayersRow(props: {
  readonly object: SceneObjectData;
  readonly number: number;
  readonly selected: boolean;
  readonly topMost: boolean;
  readonly bottomMost: boolean;
  readonly model: LayersModel;
  readonly depth?: 0 | 1;
  readonly leading?: ReactElement | null;
  readonly onDragStart?: (pointerId: number) => void;
  readonly dragging?: boolean;
}): ReactElement {
  const {
    object,
    number,
    selected,
    topMost,
    bottomMost,
    model,
    depth = 0,
    leading,
    onDragStart,
    dragging,
  } = props;
  const { t, language } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(object.name ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const pressRef = useRef<{ y: number; pointerId: number } | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const Icon = isShapeObject(object)
    ? SHAPE_ICONS[object.shapeKind]
    : KIND_ICONS[object.kind];
  const displayName =
    object.name ??
    `${t(rowLabelKey(object))} ${formatInteger(number, language)}`;
  const isChild = depth === 1;

  const commitRename = (): void => {
    setEditing(false);
    if (draft.trim() !== (object.name ?? "")) {
      model.rename(object.id, draft);
    }
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-lg px-1.5 py-1 outline-none transition-colors",
        selected
          ? "bg-primary/10 ring-1 ring-primary/30"
          : "hover:bg-accent/50 focus-visible:bg-accent/50",
        dragging && "opacity-40",
        isChild && "ms-4",
      )}
      onPointerDown={(event) => {
        if (
          editing ||
          isChild ||
          onDragStart === undefined ||
          event.button !== 0
        ) {
          return;
        }
        pressRef.current = { y: event.clientY, pointerId: event.pointerId };
      }}
      onPointerMove={(event) => {
        const press = pressRef.current;
        if (
          press === null ||
          onDragStart === undefined ||
          Math.abs(event.clientY - press.y) < ROW_DRAG_THRESHOLD_PX
        ) {
          return;
        }
        if (event.currentTarget.hasPointerCapture(press.pointerId)) {
          event.currentTarget.releasePointerCapture(press.pointerId);
        }
        pressRef.current = null;
        onDragStart(press.pointerId);
      }}
      onPointerUp={() => {
        pressRef.current = null;
      }}
    >
      {leading}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) =>
          model.selectRow(object.id, event.shiftKey || event.metaKey)
        }
        onDoubleClick={() => {
          setDraft(object.name ?? "");
          setEditing(true);
        }}
        aria-current={selected}
        title={displayName}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            "size-4 flex-none transition-colors",
            object.visible
              ? "text-muted-foreground"
              : "text-muted-foreground/40",
          )}
        />
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitRename();
              } else if (event.key === "Escape") {
                setEditing(false);
              }
            }}
            dir="auto"
            className="w-full min-w-0 rounded border border-primary/50 bg-background px-1.5 py-0.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("layers.rename")}
          />
        ) : (
          <span
            className={cn(
              "truncate text-xs leading-5",
              object.visible
                ? "text-foreground"
                : "text-muted-foreground/50 line-through",
            )}
          >
            {displayName}
          </span>
        )}
      </button>

      {/* Row actions: visible on hover/focus (selected rows keep them). */}
      <div
        className={cn(
          "flex flex-none items-center gap-0.5 transition-opacity duration-150",
          selected
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        {!isChild && (
          <button
            type="button"
            className={ROW_BUTTON}
            aria-label={t("layers.bringForward")}
            disabled={topMost}
            onClick={() => model.reorder(object.id, "forward")}
          >
            <span aria-hidden="true" className="text-xs leading-none">
              ↑
            </span>
          </button>
        )}
        {!isChild && (
          <button
            type="button"
            className={ROW_BUTTON}
            aria-label={t("layers.sendBackward")}
            disabled={bottomMost}
            onClick={() => model.reorder(object.id, "backward")}
          >
            <span aria-hidden="true" className="text-xs leading-none">
              ↓
            </span>
          </button>
        )}
        <button
          type="button"
          className={ROW_BUTTON}
          aria-label={t("layers.visibility")}
          onClick={() => model.setVisibility(object.id, !object.visible)}
        >
          {object.visible ? (
            <Eye className="size-3.5" aria-hidden="true" />
          ) : (
            <EyeOff
              className="size-3.5 text-muted-foreground/60"
              aria-hidden="true"
            />
          )}
        </button>
        <button
          type="button"
          className={ROW_BUTTON}
          aria-label={t("layers.lock")}
          onClick={() => model.setLocked(object.id, !object.locked)}
        >
          {object.locked ? (
            <Lock className="size-3.5 text-primary" aria-hidden="true" />
          ) : (
            <LockOpen className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * @param object - the row object.
 * @returns the i18n key labelling the row's kind.
 */
function rowLabelKey(object: SceneObjectData): TranslationKey {
  if (
    isShapeObject(object) &&
    (SHAPE_KINDS as readonly string[]).includes(object.shapeKind)
  ) {
    return `shape.kind.${object.shapeKind}` as TranslationKey;
  }
  return KIND_LABEL_KEYS[object.kind];
}

/** Type-only re-export for the group row typing above. */
export type { GroupObjectData };
