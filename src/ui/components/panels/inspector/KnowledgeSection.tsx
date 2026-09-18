"use client";

/**
 * The inspector's knowledge section (pack-Phase-11 rebuild): the
 * wiki-link surface of the selection — outgoing `[[عنوان]]` chips
 * (resolved = fly-to on click; broken = red, dashed), incoming
 * backlink rows (fly-to + select the source) and `#tag` chips.
 *
 * The section renders ONLY when the selection has knowledge data
 * (links in, links out, or tags); the syntax hint shows otherwise
 * only on text-bearing objects, teaching the grammar in place.
 */
import { useEffect, useState, type ReactElement } from "react";
import { Hash, Link2, Link2Off, MousePointerClick, X } from "lucide-react";
import { Application, Services } from "@/App";
import { AppContext } from "@/AppContext";
import { removeManualLinkCommand } from "@/core/commands/LinkCommands";
import type {
  KnowledgeBacklink,
  OutgoingWikiLink,
} from "@/core/knowledge/KnowledgeIndex";
import { useTranslation } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import type { InspectorSectionProps } from "@/ui/registry/InspectorSectionRegistry";

/**
 * The inspector section body (registered as `core.inspector.knowledge`).
 *
 * @param props - the inspector section props (the live selection).
 * @returns the section, or null when nothing knowledge-related applies.
 */
export default function KnowledgeSection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { objects } = props;
  const { t, language } = useTranslation();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // Re-render on knowledge rebuilds (debounced scene changes).
    let stopKnowledge: (() => void) | null = null;
    void Application.boot().then((context: AppContext) => {
      stopKnowledge = context
        .get(Services.eventBus)
        .on("knowledge:changed", () => setTick((value) => value + 1));
    });
    return () => {
      stopKnowledge?.();
    };
  }, []);

  const single = objects.length === 1 ? (objects[0] ?? null) : null;
  if (single === null) {
    return null;
  }
  const context = AppContext.getDefault();
  const knowledge = context.tryGet(Services.knowledge);
  const scene = context.tryGet(Services.scene);
  const selection = context.tryGet(Services.selection);
  const bus = context.tryGet(Services.eventBus);
  const links = context.tryGet(Services.links);
  const history = context.tryGet(Services.history);
  if (
    knowledge === undefined ||
    scene === undefined ||
    selection === undefined ||
    bus === undefined
  ) {
    return null;
  }
  void tick; // (the knowledge:changed subscription drives re-renders)

  const isTextBearing =
    single.kind === "textBox" || single.kind === "stickyNote";
  const outgoing: readonly OutgoingWikiLink[] = knowledge.outgoingOf(
    single.id,
  );
  const backlinks: readonly KnowledgeBacklink[] =
    knowledge.backlinksOf(single.id);
  const tagKeys = knowledge.tagsOf(single.id);
  const tags = tagKeys
    .map((key) => knowledge.tag(key))
    .filter((tag): tag is NonNullable<typeof tag> => tag !== null);

  /**
   * Removes one manual link (ONE undo step) from this section's row.
   *
   * @param linkId - the registry entry id.
   */
  const removeLink = (linkId: string): void => {
    if (links === undefined || history === undefined) {
      return;
    }
    const entry = links.get(linkId);
    if (entry === null) {
      return;
    }
    const command = removeManualLinkCommand(links, entry);
    command.do();
    history.push(command);
  };

  /**
   * Flies to an object, selects it and pulses the highlight — the
   * shared navigation of every knowledge row/chip.
   *
   * @param objectId - the destination object id.
   */
  const goTo = (objectId: string): void => {
    selection.replaceAll([objectId]);
    bus.emit("ui:fly-to-object", { objectId });
  };

  if (outgoing.length === 0 && backlinks.length === 0 && tags.length === 0) {
    if (!isTextBearing) {
      return null;
    }
    // Text objects still learn the grammar in place.
    return (
      <section aria-label={t("knowledge.title")} className="space-y-1.5">
        <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          <Link2 className="size-3" aria-hidden="true" />
          {t("knowledge.title")}
        </h4>
        <p className="text-[10px] leading-4 text-muted-foreground/80">
          {t("knowledge.syntaxHint")}
        </p>
      </section>
    );
  }

  return (
    <section aria-label={t("knowledge.title")} className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        <Link2 className="size-3" aria-hidden="true" />
        {t("knowledge.title")}
      </h4>

      {outgoing.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">
            {t("knowledge.outgoing")}
          </p>
          <div className="flex flex-wrap gap-1">
            {outgoing.map((link) =>
              link.resolvedIds.length > 0 ? (
                <span
                  key={link.key + (link.linkId ?? "")}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] text-foreground"
                >
                  {link.kind === "wiki" ? (
                    <Link2
                      className="size-3 flex-none text-primary"
                      aria-hidden="true"
                    />
                  ) : (
                    <MousePointerClick
                      className="size-3 flex-none text-primary/80"
                      aria-hidden="true"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const first = link.resolvedIds[0];
                      if (first !== undefined) {
                        goTo(first);
                      }
                    }}
                    title={t("knowledge.goTo")}
                    className="max-w-full truncate transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                  >
                    {link.display}
                  </button>
                  {link.linkId !== undefined ? (
                    <button
                      type="button"
                      onClick={() => removeLink(link.linkId ?? "")}
                      title={t("knowledge.removeManualLink")}
                      aria-label={t("knowledge.removeManualLink")}
                      className="grid size-4 flex-none place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
                    >
                      <X className="size-2.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              ) : (
                <span
                  key={link.key + (link.linkId ?? "")}
                  title={t("knowledge.brokenTitle")}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-dashed border-destructive/50 bg-destructive/5 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  <Link2Off
                    className="size-3 flex-none text-destructive/70"
                    aria-hidden="true"
                  />
                  <span className="truncate">{link.display}</span>
                  <span className="flex-none text-[9px] text-destructive/80">
                    {t("knowledge.broken")}
                  </span>
                  {link.linkId !== undefined ? (
                    <button
                      type="button"
                      onClick={() => removeLink(link.linkId ?? "")}
                      title={t("knowledge.removeManualLink")}
                      aria-label={t("knowledge.removeManualLink")}
                      className="grid size-4 flex-none place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
                    >
                      <X className="size-2.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              ),
            )}
          </div>
        </div>
      )}

      {backlinks.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">
            {t("knowledge.incoming")}
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto panel-scroll">
            {backlinks.map((row) => {
              const label =
                knowledge.titleOf(row.sourceId)?.display ??
                t("knowledge.unknownSource");
              return (
                <li key={`${row.sourceId}:${row.display}:${row.linkId ?? ""}`}>
                  <button
                    type="button"
                    onClick={() => goTo(row.sourceId)}
                    title={t("knowledge.goTo")}
                    className="flex w-full items-start gap-1.5 rounded-md border border-border/60 bg-accent/30 px-2 py-1.5 text-right transition-colors hover:border-primary/40 hover:bg-accent/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    {row.kind === "wiki" ? null : (
                      <MousePointerClick
                        className="mt-0.5 size-3 flex-none text-primary/70"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium text-foreground">
                        {label}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] leading-4 text-muted-foreground/80">
                        {row.snippet !== ""
                          ? row.snippet
                          : t("knowledge.manualLinkSnippet")}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {tags.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">
            {t("knowledge.tags")}
          </p>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag.key}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-accent/40 px-2 py-0.5 text-[10px] text-foreground/90"
              >
                <Hash className="size-2.5 flex-none text-primary/80" aria-hidden="true" />
                {tag.display}
                <span className="text-[9px] text-muted-foreground/70">
                  · {formatInteger(tag.objectIds.length, language)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {isTextBearing && (
        <p className="text-[10px] leading-4 text-muted-foreground/70">
          {t("knowledge.syntaxHint")}
        </p>
      )}
    </section>
  );
}
