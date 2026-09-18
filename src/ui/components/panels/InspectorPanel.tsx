"use client";

/**
 * Inspector panel body (R7.2): the property editor for the current
 * selection, COMPOSED of registered sections (`InspectorSectionRegistry`).
 *
 * The shell renders the selection summary line, the locked hint and the
 * sections resolved for the selection's kinds — a new section registered
 * (core now, plugins in Phase 9) appears with ZERO shell edits (AC7.11).
 * Every mutation flows through the inspector model onto history as ONE
 * undo entry (CLAUDE.md §1.5). The panel opens from the dock rail
 * (strictly manual, the Phase-5 UX decision).
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Lock } from "lucide-react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type {
  InspectorSectionEntry,
  InspectorSectionRegistry,
  InspectorSectionProps,
} from "@/ui/registry/InspectorSectionRegistry";
import { ensurePanelsRegistered } from "@/ui/panels/registerPanels";
import { useInspectorModel } from "@/ui/hooks/useInspectorModel";
import { useTranslation, type TranslationKey } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import { cn } from "@/lib/utils";

/**
 * @returns the inspector panel body (composed of registered sections).
 */
export default function InspectorPanelBody(): ReactElement {
  const { t, language } = useTranslation();
  const model = useInspectorModel();
  const [sections, setSections] = useState<readonly InspectorSectionEntry[]>(
    [],
  );

  // The section list only depends on the KINDS of the selection. Join
  // them into a primitive key so the resolve effect below re-runs ONLY
  // when the kinds actually change — a deps-less effect that setStates
  // a fresh array from `sectionsForSelection` on every render is an
  // INFINITE render loop (each pass allocates a new array reference,
  // so React never bails out; the heavy Phase-13 sections turned the
  // loop into a full-page freeze on the «بازرس» tab).
  const kinds = model.objects.map((object) => object.kind);
  const kindsKey = kinds.join(",");
  const kindsRef = useRef<string[]>([]);
  // Keep the ref live for the registry subscription WITHOUT feeding it
  // into the resolve effect's deps. (Writing the ref during render is
  // forbidden by the React compiler; this deps-less effect performs NO
  // state update, so it cannot loop.)
  useEffect(() => {
    kindsRef.current = kinds;
  });

  // Resolve the section list from the registry. Late registrations
  // re-resolve through the subscription; the kinds are read live from
  // the ref so a SAME-kind selection swap never re-subscribes.
  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    void Application.boot().then((context: AppContext) => {
      if (cancelled) {
        return;
      }
      ensurePanelsRegistered(context);
      const registry: InspectorSectionRegistry = context.get(
        Services.inspectorSections,
      );
      const read = (): void => {
        setSections(registry.sectionsForSelection(kindsRef.current));
      };
      read();
      unsubscribers.push(registry.onRegistered(read));
    });
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
    // The section list itself only depends on the KINDS; the section
    // components receive the live objects through props each render.
  }, [kindsKey]);

  const single = model.single;
  const count = model.objects.length;
  const locked = count > 0 && model.objects.every((object) => object.locked);
  const props: InspectorSectionProps = {
    objects: model.objects,
    model,
  };

  return (
    <div className="px-3 py-3">
      {count === 0 ? (
        <div className="px-1 py-6 text-center">
          <p className="text-xs font-medium text-muted-foreground">
            {t("inspector.empty")}
          </p>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground/70">
            {t("inspector.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Selection line: kind label (single) or count (multi). */}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {single !== null ? (
              <span className="font-medium text-foreground">
                {single.name ?? t("inspector.title")}
              </span>
            ) : (
              <>
                <span className="font-medium text-foreground">
                  {formatInteger(count, language)}
                </span>
                {t("inspector.multiple")}
              </>
            )}
          </p>
          {locked && (
            <p
              className={cn(
                "flex items-center gap-1.5 rounded-lg border border-border/60 bg-accent/40",
                "px-2.5 py-2 text-[11px] leading-5 text-muted-foreground",
              )}
            >
              <Lock
                className="size-3.5 flex-none text-primary"
                aria-hidden="true"
              />
              {t("inspector.lockedHint")}
            </p>
          )}
          {sections.map((entry) => {
            const Section = entry.component;
            return (
              <div key={entry.id} className="space-y-0">
                {entry.titleKey !== undefined && (
                  <h3 className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                    {t(entry.titleKey as TranslationKey)}
                  </h3>
                )}
                <Section {...props} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
