"use client";

/**
 * The inspector's frame auto-layout section (R13.4): enable/disable the
 * derived child positions, pick the direction, and tune gap/padding/
 * fill-width. Every change commits ONE undo step; the debounced reflow
 * applies the plan (a drag inside a laid-out frame reorders).
 */
import { useEffect, useState, type ReactElement } from "react";
import { Ruler } from "lucide-react";
import { Application, Services } from "@/App";
import { AppContext } from "@/AppContext";
import { isFrameObject, type FrameLayout } from "@/core/model/FrameObject";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import { useTranslation } from "@/ui/i18n";
import type { InspectorSectionProps } from "@/ui/registry/InspectorSectionRegistry";

/**
 * The inspector section body (registered as `core.inspector.frameLayout`).
 *
 * @param props - the inspector section props (the live selection).
 * @returns the section, or null unless exactly one frame is selected.
 */
export default function FrameLayoutSection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { objects } = props;
  const { t } = useTranslation();
  const [, setTick] = useState(0);

  useEffect(() => {
    // The scene mutates from the reflow; a light subscription keeps the
    // controls in sync without model plumbing.
    let stop: (() => void) | null = null;
    void Application.boot().then((context: AppContext) => {
      stop = context
        .get(Services.eventBus)
        .on("scene:changed", () => setTick((tick) => tick + 1));
    });
    return () => {
      stop?.();
    };
  }, []);

  const single = objects.length === 1 ? (objects[0] ?? null) : null;
  if (single === null || !isFrameObject(single)) {
    return null;
  }
  const locked = single.locked;
  const layout = single.layout;

  /**
   * Commits one layout definition change (one undo step).
   *
   * @param next - the new layout (undefined = free placement).
   */
  const commit = (next: FrameLayout | undefined): void => {
    const context = AppContext.getDefault();
    const scene = context.tryGet(Services.scene);
    const history = context.tryGet(Services.history);
    if (scene === undefined || history === undefined || locked) {
      return;
    }
    const command = new UpdateObjectCommand(
      scene,
      single.id,
      { layout: next },
      single,
    );
    command.do();
    history.push(command);
    setTick((tick) => tick + 1);
  };

  const numberInput = (
    key: "gap" | "padding",
    value: number,
  ): ReactElement => (
    <label className="flex items-center gap-1.5 text-[11px]">
      <span className="w-14 shrink-0 text-muted-foreground">
        {t(`frameLayout.${key}`)}
      </span>
      <input
        type="number"
        min={0}
        step={4}
        value={value}
        disabled={locked || layout === undefined}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (layout === undefined || !Number.isFinite(parsed) || parsed < 0) {
            return;
          }
          commit({ ...layout, [key]: parsed });
        }}
        className="h-7 w-16 rounded border border-border/60 bg-background/70 px-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
      />
    </label>
  );

  return (
    <section aria-label={t("frameLayout.title")} className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        <Ruler className="size-3" aria-hidden="true" />
        {t("frameLayout.title")}
      </h4>
      <label className="flex items-center gap-1.5 text-[11px]">
        <input
          type="checkbox"
          checked={layout !== undefined}
          disabled={locked}
          onChange={(event) => {
            commit(
              event.target.checked
                ? { dir: "column", gap: 12, padding: 12 }
                : undefined,
            );
          }}
          className="size-3.5 accent-(--color-primary)"
        />
        <span className="text-foreground/90">{t("frameLayout.enabled")}</span>
      </label>
      {layout !== undefined && (
        <>
          <label className="flex items-center gap-1.5 text-[11px]">
            <span className="w-14 shrink-0 text-muted-foreground">
              {t("frameLayout.dir")}
            </span>
            <select
              value={layout.dir}
              disabled={locked}
              onChange={(event) => {
                const dir =
                  event.target.value === "row" ? "row" : "column";
                commit({ ...layout, dir });
              }}
              className="h-7 flex-1 rounded border border-border/60 bg-background/70 px-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
            >
              <option value="column">{t("frameLayout.column")}</option>
              <option value="row">{t("frameLayout.row")}</option>
            </select>
          </label>
          {numberInput("gap", layout.gap)}
          {numberInput("padding", layout.padding)}
          <label className="flex items-center gap-1.5 text-[11px]">
            <input
              type="checkbox"
              checked={layout.itemWidth === "fill"}
              disabled={locked}
              onChange={(event) => {
                commit({
                  ...layout,
                  ...(event.target.checked ? { itemWidth: "fill" } : {}),
                });
              }}
              className="size-3.5 accent-(--color-primary)"
            />
            <span className="text-foreground/90">
              {t("frameLayout.fillWidth")}
            </span>
          </label>
        </>
      )}
      <p className="text-[10px] leading-4 text-muted-foreground/80">
        {t("frameLayout.hint")}
      </p>
    </section>
  );
}
