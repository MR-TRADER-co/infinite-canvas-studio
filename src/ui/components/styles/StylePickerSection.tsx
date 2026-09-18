"use client";

/**
 * The inspector's named-style section (R13.3): applies a registered style
 * to the current selection (ONE composite undo step — styleId + the
 * stamped fields), detaches the reference (values stay), and opens the
 * style editor dialog for create/edit/delete.
 */
import { useEffect, useState, type ReactElement } from "react";
import { Palette, Pencil, X } from "lucide-react";
import { Application, Services } from "@/App";
import { AppContext } from "@/AppContext";
import {
  StyleRegistry,
  planStyleApplication,
  type NamedStyle,
} from "@/core/knowledge/StyleRegistry";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import { CompositeCommand } from "@/core/commands/CompositeCommand";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";
import type { InspectorSectionProps } from "@/ui/registry/InspectorSectionRegistry";
import { cn } from "@/lib/utils";

/**
 * The inspector section body (registered as `core.inspector.styles`).
 *
 * @param props - the inspector section props (the live selection).
 * @returns the section, or null when nothing is selected.
 */
export default function StylePickerSection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { objects } = props;
  const { t } = useTranslation();
  const [styles, setStyles] = useState<StyleRegistry | undefined>(undefined);
  const [, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Application.boot().then((context: AppContext) => {
      if (!cancelled) {
        setStyles(context.get(Services.styles));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (styles === undefined) {
      return;
    }
    return styles.subscribe(() => setVersion((v) => v + 1));
  }, [styles]);

  if (styles === undefined || objects.length === 0) {
    return null;
  }

  // Text styles target text boxes/notes; colour styles target shapes.
  const hasText = objects.some(
    (object) => object.kind === "textBox" || object.kind === "stickyNote",
  );
  const hasColorTarget = objects.some(
    (object) => object.kind === "shape" || object.kind === "frame",
  );
  if (!hasText && !hasColorTarget) {
    return null;
  }

  const applicable = styles
    .list()
    .filter(
      (style) =>
        (style.kind === "text" && hasText) ||
        (style.kind === "color" && hasColorTarget),
    );

  const applyStyle = (style: NamedStyle): void => {
    const context = AppContext.getDefault();
    const scene = context.tryGet(Services.scene);
    const history = context.tryGet(Services.history);
    if (scene === undefined || history === undefined) {
      return;
    }
    const patches = planStyleApplication(style, objects);
    const commands = objects.map((object) => {
      const patch: Record<string, unknown> = {};
      for (const entry of patches) {
        if (entry.objectId === object.id) {
          patch[entry.field] = entry.value;
        }
      }
      const command = new UpdateObjectCommand(scene, object.id, patch, object);
      command.do();
      return command;
    });
    history.push(new CompositeCommand("command.applyStyle", commands));
  };

  const detachStyle = (): void => {
    const context = AppContext.getDefault();
    const scene = context.tryGet(Services.scene);
    const history = context.tryGet(Services.history);
    if (scene === undefined || history === undefined) {
      return;
    }
    const commands = objects
      .filter(
        (object) => (object as { styleId?: unknown }).styleId !== undefined,
      )
      .map((object) => {
        const command = new UpdateObjectCommand(
          scene,
          object.id,
          { styleId: undefined },
          object,
        );
        command.do();
        return command;
      });
    if (commands.length > 0) {
      history.push(new CompositeCommand("command.detachStyle", commands));
    }
  };

  const currentStyleId = (objects[0] as { styleId?: unknown }).styleId;

  return (
    <section aria-label={t("styles.title")} className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          <Palette className="size-3" aria-hidden="true" />
          {t("styles.title")}
        </h4>
        <button
          type="button"
          onClick={() => useUiStore.getState().setStyleEditorOpen(true)}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Pencil className="size-3" aria-hidden="true" />
          {t("styles.openEditor")}
        </button>
      </div>
      <ul
        className="max-h-40 space-y-1 overflow-y-auto panel-scroll"
        aria-label={t("styles.listLabel")}
      >
        {applicable.map((style) => {
          const active = style.id === currentStyleId;
          return (
            <li key={style.id}>
              <div
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors",
                  active
                    ? "border-primary/50 bg-primary/10"
                    : "border-border/60 hover:border-primary/30 hover:bg-accent/40",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    applyStyle(style);
                  }}
                  className="flex-1 truncate text-right text-[11px] font-medium text-foreground"
                  aria-pressed={active}
                >
                  {style.name}
                </button>
                {style.builtin ? (
                  <span className="rounded bg-accent px-1.5 py-0.5 text-[9px] text-muted-foreground">
                    {t("styles.builtinTag")}
                  </span>
                ) : (
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] text-primary">
                    {t("styles.userTag")}
                  </span>
                )}
              </div>
            </li>
          );
        })}
        {applicable.length === 0 && (
          <li className="px-2 py-1.5 text-[11px] text-muted-foreground">
            {t("styles.noMatch")}
          </li>
        )}
      </ul>
      {currentStyleId !== undefined && (
        <button
          type="button"
          onClick={() => {
            detachStyle();
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border/60 px-2 py-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <X className="size-3" aria-hidden="true" />
          {t("styles.clearSelection")}
        </button>
      )}
    </section>
  );
}
