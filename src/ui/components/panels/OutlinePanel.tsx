"use client";

/**
 * Outline panel body (R7.7): the document outline built from every H1/H2/H3
 * of every text object (z-order = document order), registered as the
 * `core.panels.outline` dock panel.
 *
 * Entries nest by heading level; a click flies the camera to the owning
 * text object (300 ms eased flight) with a pulsing highlight ring.
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type { Scene } from "@/core/model/Scene";
import type { EventBus, AppEventMap } from "@/core/events/EventBus";
import { buildOutline, type OutlineEntry } from "@/core/search/SceneSearch";
import { useTranslation } from "@/ui/i18n";
import { cn } from "@/lib/utils";

/** Indent classes per heading level (logical start insets). */
const LEVEL_INDENT: Readonly<Record<1 | 2 | 3, string>> = {
  1: "ps-1 font-semibold",
  2: "ps-4 font-medium",
  3: "ps-7 font-normal",
};

/**
 * @returns the outline panel body.
 */
export default function OutlinePanelBody(): ReactElement {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<readonly OutlineEntry[]>([]);
  const [bus, setBus] = useState<EventBus<AppEventMap> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    void Application.boot().then((context: AppContext) => {
      if (cancelled) {
        return;
      }
      const scene: Scene = context.get(Services.scene);
      const liveBus = context.get(Services.eventBus);
      setBus(liveBus);
      const refresh = (): void => {
        setEntries(buildOutline(scene.objects));
      };
      refresh();
      unsubscribers.push(liveBus.on("scene:changed", refresh));
    });
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  const tree = useMemo(() => nestByLevel(entries), [entries]);

  return (
    <div className="p-2">
      {entries.length === 0 ? (
        <p className="px-3 py-6 text-center text-[11px] leading-5 text-muted-foreground/70">
          {t("outline.empty")}
        </p>
      ) : (
        <ul className="space-y-0.5" aria-label={t("outline.title")} role="tree">
          {tree.map((node) => (
            <OutlineNode
              key={`${node.entry.objectId}-${node.index}`}
              node={node}
              bus={bus}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One outline tree node (entry + children). */
interface OutlineNode {
  readonly entry: OutlineEntry;
  readonly index: number;
  readonly children: OutlineNode[];
}

/**
 * Nests flat entries by level (an H2 nests under the preceding H1, …).
 *
 * @param entries - the flat outline entries.
 * @returns the tree roots.
 */
function nestByLevel(entries: readonly OutlineEntry[]): readonly OutlineNode[] {
  const roots: OutlineNode[] = [];
  // Stack of (level, node-append function) for the current ancestry.
  const stack: Array<{ level: 1 | 2 | 3; push: (node: OutlineNode) => void }> =
    [{ level: 1, push: (node) => roots.push(node) }];
  let counter = 0;
  for (const entry of entries) {
    const index = counter++;
    const node: OutlineNode = { entry, index, children: [] };
    // Pop the ancestry until the stack top can own this entry.
    while (
      stack.length > 1 &&
      (stack[stack.length - 1]?.level ?? 1) >= entry.level
    ) {
      stack.pop();
    }
    stack[stack.length - 1]?.push(node);
    stack.push({
      level: entry.level,
      push: (child) => node.children.push(child),
    });
  }
  return roots;
}

/**
 * One outline row (button) + its nested children.
 *
 * @param props - the node + the event bus (flight emission).
 * @returns the node element.
 */
function OutlineNode(props: {
  readonly node: OutlineNode;
  readonly bus: EventBus<AppEventMap> | null;
}): ReactElement {
  const { node, bus } = props;
  return (
    <li role="treeitem" aria-selected={false}>
      <button
        type="button"
        dir="auto"
        onClick={() =>
          bus?.emit("ui:fly-to-object", { objectId: node.entry.objectId })
        }
        className={cn(
          "block w-full truncate rounded-md px-2 py-1 text-start text-[11px] leading-5",
          "text-foreground/90 transition-colors hover:bg-accent/60 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          LEVEL_INDENT[node.entry.level],
        )}
        title={node.entry.text}
      >
        {node.entry.text}
      </button>
      {node.children.length > 0 ? (
        <ul role="group" className="space-y-0.5">
          {node.children.map((child) => (
            <OutlineNode
              key={`${child.entry.objectId}-${child.index}`}
              node={child}
              bus={bus}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
