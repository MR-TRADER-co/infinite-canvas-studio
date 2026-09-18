"use client";

/**
 * The knowledge-graph panel (R15.1 — «گراف دانش»): the whole wiki-link
 * graph at a glance — titled objects as nodes (sized by degree), their
 * directed links as edges, broken targets as dashed ghost nodes on an
 * outer ring — laid out by the PURE deterministic radial layout
 * (`core/knowledge/GraphLayout.ts`).
 *
 * Clicking a node selects and flies to its first object. The header
 * carries the live stats + tag chips; everything re-renders on
 * `knowledge:changed` (the debounced knowledge rebuild pipeline).
 *
 * Pack R12.3/R12.4: the action row — «چینش روی بوم» runs the
 * force-directed arrange command (one undo step + a fit flight), and
 * the edge toggle flips the on-canvas knowledge-edge overlay.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Hash, Network, Spline } from "lucide-react";
import { Application, Services } from "@/App";
import { AppContext } from "@/AppContext";
import type { KnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";
import { layoutKnowledgeGraph } from "@/core/knowledge/GraphLayout";
import { useTranslation } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import { useUiStore } from "@/ui/store/uiStore";
import { dispatchCommand } from "@/ui/hooks/useCommands";
import { cn } from "@/lib/utils";

/** Graph canvas draw size (CSS pixels; scaled by devicePixelRatio). */
const GRAPH_WIDTH = 224;

/** Graph canvas height (CSS pixels). */
const GRAPH_HEIGHT = 168;

/** Outer inset of the radial layout inside the canvas. */
const GRAPH_PADDING = 30;

/** Node label font (CSS pixels). */
const LABEL_FONT = 9;

/** Max label characters before ellipsis. */
const LABEL_MAX_CHARS = 12;

/** Destructive red (both themes — the broken-link convention). */
const BROKEN_COLOR = "#dc2626";

/**
 * @returns the knowledge-graph panel body.
 */
export default function KnowledgeGraphPanelBody(): ReactElement {
  const { t, language } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [index, setIndex] = useState<KnowledgeIndex | null>(null);
  const edgesVisible = useUiStore((state) => state.knowledgeEdgesVisible);
  const stateRef = useRef<{
    index: KnowledgeIndex | null;
    selectedIds: ReadonlySet<string>;
  }>({ index: null, selectedIds: new Set() });

  // Boot → subscribe to knowledge/selection changes → repaint.
  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    void Application.boot().then((context: AppContext) => {
      if (cancelled) {
        return;
      }
      const knowledge = context.get(Services.knowledge);
      const selection = context.get(Services.selection);
      const bus = context.get(Services.eventBus);
      const repaint = (): void => {
        const snapshot = knowledge.current();
        const selected: ReadonlySet<string> = selection.ids;
        stateRef.current = { index: snapshot, selectedIds: selected };
        setIndex(snapshot);
        drawGraph(canvasRef.current, snapshot, selected);
      };
      repaint();
      unsubscribers.push(
        bus.on("knowledge:changed", repaint),
        bus.on("selection:changed", repaint),
      );
    });
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  // Repaint on index-state updates (the tick above re-renders the DOM).
  useEffect(() => {
    drawGraph(canvasRef.current, index, stateRef.current.selectedIds);
  }, [index]);

  /**
   * Handles a click on the graph canvas: hit-test the nearest node and
   * fly to its first object (ghosts are display-only).
   *
   * @param event - the pointer event over the graph canvas.
   */
  const pick = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    const snapshot = stateRef.current.index;
    if (canvas === null || snapshot === null) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const layout = layoutKnowledgeGraph(
      snapshot,
      rect.width,
      rect.height,
      GRAPH_PADDING,
    );
    let best: { distance: number; node: (typeof layout.nodes)[number] } | null =
      null;
    for (const node of layout.nodes) {
      const distance = Math.hypot(node.x - x, node.y - y);
      if (distance <= node.r + 7 && (best === null || distance < best.distance)) {
        best = { distance, node };
      }
    }
    if (best === null || best.node.ghost) {
      return;
    }
    const first = best.node.objectIds[0];
    if (first === undefined) {
      return;
    }
    const context = AppContext.getDefault();
    const selection = context.tryGet(Services.selection);
    const bus = context.tryGet(Services.eventBus);
    selection?.replaceAll([first]);
    bus?.emit("ui:fly-to-object", { objectId: first });
  };

  const stats = index
    ? {
        titles: index.titles.size,
        links: [...index.outgoing.values()].reduce(
          (sum, links) => sum + links.length,
          0,
        ),
        broken: [...index.brokenTitles.values()].reduce(
          (sum, refs) => sum + refs.length,
          0,
        ),
        tags: index.tags.size,
      }
    : null;
  const tags = index
    ? [...index.tags.values()].sort((a, b) =>
        a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
      )
    : [];

  return (
    <div className="space-y-2 p-2">
      {/* Pack R12.3/R12.4: the action row — arrange + the edge toggle. */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            dispatchCommand("core.graph.arrange");
          }}
          title={t("graph.arrangeHint")}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5",
            "text-[11px] font-medium transition-all focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring/50",
            "border-primary/30 bg-primary/10 text-foreground hover:border-primary/60",
            "hover:bg-primary/20 active:scale-[0.98]",
          )}
        >
          <Network className="size-3.5 text-primary/80" aria-hidden="true" />
          {t("graph.arrangeButton")}
        </button>
        <button
          type="button"
          aria-pressed={edgesVisible}
          onClick={() => {
            dispatchCommand("core.graph.toggleEdges");
          }}
          title={
            edgesVisible ? t("graph.edgesHide") : t("graph.edgesShow")
          }
          className={cn(
            "inline-flex size-7.5 flex-none items-center justify-center rounded-lg border",
            "transition-all focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-ring/50 active:scale-[0.96]",
            edgesVisible
              ? "border-primary/60 bg-primary/20 text-foreground"
              : "border-border/60 bg-accent/30 text-muted-foreground hover:border-primary/40 hover:text-foreground",
          )}
        >
          <Spline
            className={cn(
              "size-3.5 transition-colors",
              edgesVisible ? "text-primary" : undefined,
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      {stats !== null && (
        <div
          className="flex flex-wrap items-center gap-1"
          role="status"
          aria-label={t("graph.stats")}
        >
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] tabular-nums text-foreground/90">
            {t("graph.statTitles")}
            {formatInteger(stats.titles, language)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-accent/40 px-1.5 py-0.5 text-[10px] tabular-nums text-foreground/90">
            {t("graph.statLinks")}
            {formatInteger(stats.links, language)}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5",
              "text-[10px] tabular-nums",
              stats.broken > 0
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border/60 bg-accent/40 text-foreground/90",
            )}
          >
            {t("graph.statBroken")}
            {formatInteger(stats.broken, language)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-accent/40 px-1.5 py-0.5 text-[10px] tabular-nums text-foreground/90">
            <Hash className="size-2.5 text-primary/70" aria-hidden="true" />
            {formatInteger(stats.tags, language)}
          </span>
        </div>
      )}
      {index !== null && index.titles.size === 0 && index.tags.size === 0 ? (
        <p className="rounded border border-dashed border-border/70 bg-background/50 px-2 py-3 text-center text-[10px] leading-4 text-muted-foreground">
          {t("graph.empty")}
        </p>
      ) : (
        <canvas
          ref={canvasRef}
          width={GRAPH_WIDTH}
          height={GRAPH_HEIGHT}
          aria-label={t("graph.title")}
          className="w-full rounded-lg border border-border/60 bg-background/60 shadow-[inset_0_1px_4px_oklch(0_0_0/6%)] transition-colors dark:shadow-[inset_0_1px_4px_oklch(0_0_0/35%)]"
          style={{ aspectRatio: `${GRAPH_WIDTH} / ${GRAPH_HEIGHT}` }}
          onPointerDown={(event) => {
            pick(event);
          }}
        />
      )}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 12).map((tag) => (
            <button
              key={tag.key}
              type="button"
              title={t("graph.goTo")}
              onClick={() => {
                const first = tag.objectIds[0];
                if (first === undefined) {
                  return;
                }
                const context = AppContext.getDefault();
                context.tryGet(Services.selection)?.replaceAll([first]);
                context
                  .tryGet(Services.eventBus)
                  ?.emit("ui:fly-to-object", { objectId: first });
              }}
              className="inline-flex items-center gap-0.5 rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] text-foreground transition-colors hover:border-primary/60 hover:bg-primary/20 focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <Hash className="size-2.5 flex-none text-primary/70" aria-hidden="true" />
              <span className="truncate">{tag.display}</span>
              <span className="flex-none text-[9px] text-muted-foreground">
                · {formatInteger(tag.objectIds.length, language)}
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="text-[9px] leading-3.5 text-muted-foreground/70">
        {t("graph.legend")}
      </p>
    </div>
  );
}

/**
 * Paints one knowledge-graph layout onto the panel canvas.
 *
 * @param canvas - the panel canvas (null-safe).
 * @param index - the live knowledge snapshot.
 * @param selectedIds - the current selection (node highlight).
 */
function drawGraph(
  canvas: HTMLCanvasElement | null,
  index: KnowledgeIndex | null,
  selectedIds: ReadonlySet<string>,
): void {
  if (canvas === null || index === null) {
    return;
  }
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const width = canvas.clientWidth || GRAPH_WIDTH;
  const height = canvas.clientHeight || GRAPH_HEIGHT;
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
  }
  if (canvas.height !== Math.round(height * dpr)) {
    canvas.height = Math.round(height * dpr);
  }
  const context = canvas.getContext("2d");
  if (context === null) {
    return;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const layout = layoutKnowledgeGraph(index, width, height, GRAPH_PADDING);
  if (layout.empty) {
    return;
  }
  const nodesByKey = new Map(layout.nodes.map((node) => [node.key, node]));
  const styles = typeof window === "undefined"
    ? null
    : getComputedStyle(canvas);
  const accent = styles?.getPropertyValue("--color-accent-foreground").trim() ||
    "#0f766e";
  const foreground = styles?.getPropertyValue("--color-foreground").trim() ||
    "#171717";

  /** Ellipsizes a node label. */
  const label = (text: string): string =>
    text.length > LABEL_MAX_CHARS
      ? `${text.slice(0, LABEL_MAX_CHARS - 1)}…`
      : text;

  // Edges first (under the nodes).
  for (const edge of layout.edges) {
    const from = nodesByKey.get(edge.fromKey);
    const to = nodesByKey.get(edge.toKey);
    if (from === undefined || to === undefined) {
      continue;
    }
    context.strokeStyle = edge.broken ? BROKEN_COLOR : accent;
    context.globalAlpha = edge.broken ? 0.75 : 0.5;
    context.lineWidth = 1;
    if (edge.broken) {
      context.setLineDash([4, 3]);
    }
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.setLineDash([]);
    // Arrowhead at ~80% toward the target (outside the node radius).
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len > from.r + to.r + 8) {
      const ux = dx / len;
      const uy = dy / len;
      const tipX = to.x - ux * (to.r + 3);
      const tipY = to.y - uy * (to.r + 3);
      context.beginPath();
      context.moveTo(tipX, tipY);
      context.lineTo(tipX - ux * 5 - uy * 3, tipY - uy * 5 + ux * 3);
      context.lineTo(tipX - ux * 5 + uy * 3, tipY - uy * 5 - ux * 3);
      context.closePath();
      context.fillStyle = edge.broken ? BROKEN_COLOR : accent;
      context.fill();
    }
  }
  context.globalAlpha = 1;

  // Nodes + labels.
  for (const node of layout.nodes) {
    const isSelected =
      !node.ghost &&
      node.objectIds.some((id) => selectedIds.has(id));
    if (node.ghost) {
      context.setLineDash([3, 3]);
      context.strokeStyle = BROKEN_COLOR;
      context.globalAlpha = 0.8;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 1;
    } else {
      context.fillStyle = accent;
      context.globalAlpha = 0.9;
      context.beginPath();
      context.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
      if (isSelected) {
        context.strokeStyle = accent;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(node.x, node.y, node.r + 3, 0, Math.PI * 2);
        context.stroke();
      }
    }
    context.font = `${LABEL_FONT}px Vazirmatn, Tahoma, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillStyle = node.ghost ? BROKEN_COLOR : foreground;
    context.globalAlpha = node.ghost ? 0.85 : 0.9;
    context.direction = "rtl";
    context.fillText(label(node.display), node.x, node.y + node.r + 2);
    context.globalAlpha = 1;
  }
}
