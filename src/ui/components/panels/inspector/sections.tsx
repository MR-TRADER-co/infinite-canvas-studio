"use client";

/**
 * Core inspector section components (R7.2): each section is a plain
 * component receiving the selection snapshot, REGISTERED onto the
 * `InspectorSectionRegistry` by `ui/panels/registerPanels` (never imported
 * by the Inspector shell directly — the composition is the seam).
 *
 * Sections port the Phase 3A/4/5/6 property editing (name, stroke, fill,
 * connector style, text, card, geometry) plus the Phase 7 multi-text
 * format section (AC7.2: multi-apply font family/size/colour in ONE undo
 * entry through the inspector model's composite restyle).
 */
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  ArrowRight,
  CircleSlash,
  Clock,
  CornerDownRight,
  Minus,
  MousePointer2,
  PaintBucket,
  PenLine,
  Ruler,
  Search,
  Smile,
  Spline,
  StickyNote,
  Tag,
  Type,
  X,
} from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";
import { isShapeObject } from "@/core/model/ShapeObject";
import {
  isFreehandObject,
  type StrokeStyleKind,
} from "@/core/model/FreehandObject";
import { isTextBoxObject } from "@/core/model/TextBoxObject";
import { isStickyNoteObject } from "@/core/model/StickyNoteObject";
import { isStickerObject } from "@/core/model/StickerObject";
import {
  CURATED_STICKERS,
  searchStickers,
} from "@/core/stickers/StickerLibrary";
import {
  isConnectorObject,
  type ConnectorArrowMode,
  type ConnectorObjectData,
  type ConnectorRoutingKind,
} from "@/core/model/ConnectorObject";
import { isGroupObject } from "@/core/model/GroupObject";
import { showsNameBadge } from "@/core/model/NameBadge";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { InspectorSectionProps } from "@/ui/registry/InspectorSectionRegistry";
import type { InspectorModel } from "@/ui/hooks/useInspectorModel";
import { useTranslation, type TranslationKey } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";
import { useRecentStickers } from "@/ui/stickers/recentStickersStore";
import {
  FontSizeStepper,
  NumberField,
  SwatchGrid,
  WidthPicker,
  dashPreviewStyle,
  fillSwatchOptions,
  stickySwatchOptions,
  strokeSwatchOptions,
  textSwatchOptions,
} from "@/ui/components/panels/inspector/Controls";
import InspectorTextSection from "@/ui/components/text/InspectorTextSection";
import { cn } from "@/lib/utils";

/** Sticky-note default font size (the card stepper's fallback). */
const DEFAULT_STICKY_FONT_SIZE = 18;

/**
 * The curated sticker palette (R11.1) now lives in the core sticker
 * library (`CURATED_STICKERS`) — the same module powers the R12.1
 * picker dialog's search, so the palette and the library can never
 * drift apart.
 */

/** Font families the multi-text section offers (R7.2/AC7.2). */
const FONT_FAMILIES: ReadonlyArray<{
  readonly value: string;
  readonly labelKey: TranslationKey;
}> = [
  { value: "", labelKey: "inspector.fontFamilyDefault" },
  { value: "Vazirmatn", labelKey: "inspector.fontFamilyVazirmatn" },
  { value: "Tahoma", labelKey: "inspector.fontFamilyTahoma" },
];

/**
 * Name section: renames the single selected object (target `*`).
 *
 * @param props - the section props.
 * @returns the section element, or null for multi selections.
 */
export function NameSection(props: InspectorSectionProps): ReactElement | null {
  const { objects, model } = props;
  const single = objects.length === 1 ? (objects[0] ?? null) : null;
  const { t } = useTranslation();
  const [draft, setDraft] = useState(single?.name ?? "");
  if (single === null) {
    return null;
  }
  const locked = single.locked;
  const commit = (): void => {
    if (draft.trim() !== (single.name ?? "")) {
      model.rename(draft);
    }
  };
  return (
    <section aria-label={t("inspector.name")} className="space-y-1.5">
      <SectionLabel icon={Tag} labelKey="inspector.name" />
      <input
        key={`${single.id}:${single.name ?? ""}`}
        type="text"
        dir="auto"
        value={draft}
        disabled={locked}
        maxLength={120}
        placeholder={t("inspector.namePlaceholder")}
        aria-label={t("inspector.name")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            (event.target as HTMLInputElement).blur();
          } else if (event.key === "Escape") {
            setDraft(single.name ?? "");
            (event.target as HTMLInputElement).blur();
          }
        }}
        className={cn(
          "w-full rounded-lg border border-border/70 bg-background/70 px-2.5 py-1.5",
          "text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60",
          "focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      />
      {showsNameBadge(single) && (
        <p
          className={cn(
            "flex items-center gap-1.5 rounded-lg border border-border/60 bg-accent/40 px-2.5 py-1.5",
            "text-[11px] leading-5 text-muted-foreground",
          )}
        >
          <Tag className="size-3.5 flex-none text-primary" aria-hidden="true" />
          {t("inspector.nameBadgeHint")}
        </p>
      )}
    </section>
  );
}

/**
 * Stroke section: width presets + colour swatches for every stroke-bearing
 * object in the selection (target `*`, self-guarding).
 *
 * @param props - the section props.
 * @returns the section element, or null when nothing carries a stroke.
 */
export function StrokeSection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { objects, model } = props;
  const theme = useUiStore((state) => state.theme);
  const bearing = objects.filter(
    (object) =>
      isShapeObject(object) ||
      isFreehandObject(object) ||
      isConnectorObject(object),
  );
  const locked = objects.every((object) => object.locked);
  if (bearing.length === 0) {
    return null;
  }
  const strokeWidth = sharedNumber(objects, (object) =>
    isShapeObject(object) ||
    isFreehandObject(object) ||
    isConnectorObject(object)
      ? object.strokeWidth
      : undefined,
  );
  const strokeColor = sharedString(objects, (object) =>
    isShapeObject(object)
      ? object.stroke
      : isFreehandObject(object) || isConnectorObject(object)
        ? object.strokeColor
        : undefined,
  );
  return (
    <section aria-label="inspector.stroke" className="space-y-2.5">
      <SectionLabel icon={PenLine} labelKey="inspector.stroke" />
      <WidthPicker
        current={strokeWidth}
        disabled={locked}
        onPick={(width) => model.applyStyle({ strokeWidth: width })}
      />
      <SwatchGrid
        options={strokeSwatchOptions(theme)}
        current={strokeColor}
        disabled={locked}
        onPick={(color) =>
          model.applyStyle({ stroke: color, strokeColor: color })
        }
      />
    </section>
  );
}

/**
 * Fill section: colour swatches for shapes (target `shape`).
 *
 * @param props - the section props.
 * @returns the section element, or null when no shape is selected.
 */
export function FillSection(props: InspectorSectionProps): ReactElement | null {
  const { objects, model } = props;
  if (!objects.some((object) => isShapeObject(object))) {
    return null;
  }
  const locked = objects.every((object) => object.locked);
  const fillColor = sharedString(objects, (object) =>
    isShapeObject(object) ? object.fill : undefined,
  );
  return (
    <section aria-label="inspector.fill" className="space-y-2.5">
      <SectionLabel icon={PaintBucket} labelKey="inspector.fill" />
      <SwatchGrid
        options={fillSwatchOptions()}
        current={fillColor}
        disabled={locked}
        onPick={(color) => model.applyStyle({ fill: color })}
      />
    </section>
  );
}

/**
 * Connector style section: routing/arrowhead/dash rows (target
 * `connector`).
 *
 * @param props - the section props.
 * @returns the section element, or null when no connector is selected.
 */
export function ConnectorSection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { t } = useTranslation();
  const { objects, model } = props;
  const hasConnector = objects.some((object) => isConnectorObject(object));
  const locked = objects.every((object) => object.locked);
  if (!hasConnector) {
    return null;
  }
  const single = objects.length === 1 ? (objects[0] ?? null) : null;
  const connectorRouting = sharedString(objects, (object) =>
    isConnectorObject(object) ? object.routingKind : undefined,
  ) as ConnectorRoutingKind | null;
  const connectorDash = sharedString(objects, (object) =>
    isConnectorObject(object) ? object.strokeStyle : undefined,
  ) as StrokeStyleKind | null;
  const connectorArrowMode = sharedString(objects, (object) =>
    isConnectorObject(object) ? arrowModeOf(object) : undefined,
  ) as ConnectorArrowMode | null;
  return (
    <section aria-label="inspector.connector" className="space-y-2.5">
      <SectionLabel icon={Spline} labelKey="inspector.connector" />
      {single !== null && isConnectorObject(single) && (
        <p className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-accent/40 px-2.5 py-1.5 text-[11px] leading-5 text-muted-foreground">
          <MousePointer2
            className="size-3.5 flex-none text-primary"
            aria-hidden="true"
          />
          {t("a11y.reconnectEndpoint")}
        </p>
      )}
      <ConnectorStyleRow
        labelKey="inspector.routing"
        options={ROUTING_ROW_OPTIONS}
        current={connectorRouting}
        disabled={locked}
        onPick={(routing) => model.applyStyle({ routingKind: routing })}
      />
      <ConnectorStyleRow
        labelKey="inspector.arrow"
        options={ARROW_ROW_OPTIONS}
        current={connectorArrowMode}
        disabled={locked}
        onPick={(arrow) =>
          model.applyStyle({
            startArrow: arrow === "both" ? "arrow" : "none",
            endArrow: arrow === "none" ? "none" : "arrow",
          })
        }
      />
      <ConnectorStyleRow
        labelKey="inspector.dash"
        options={DASH_ROW_OPTIONS}
        current={connectorDash}
        disabled={locked}
        onPick={(dash) => model.applyStyle({ strokeStyle: dash })}
      />
    </section>
  );
}

/** Local translator for the connector hint (hook rules: top level). */

/**
 * Text box section: font-size stepper + ink swatches (target `textBox`).
 *
 * @param props - the section props.
 * @returns the section element, or null when no text box is selected.
 */
export function TextBoxSection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { objects, model } = props;
  const theme = useUiStore((state) => state.theme);
  const hasTextBox = objects.some((object) => isTextBoxObject(object));
  const locked = objects.every((object) => object.locked);
  if (!hasTextBox) {
    return null;
  }
  const fontSize = sharedNumber(objects, (object) =>
    isTextBoxObject(object) ? object.fontSize : undefined,
  );
  const textColor = sharedString(objects, (object) =>
    isTextBoxObject(object) ? object.color : undefined,
  );
  return (
    <section aria-label="inspector.text" className="space-y-2.5">
      <SectionLabel icon={Type} labelKey="inspector.text" />
      <FontSizeStepper
        value={fontSize ?? 20}
        disabled={locked}
        onCommit={(size) => model.applyStyle({ fontSize: size })}
      />
      <SwatchGrid
        options={textSwatchOptions(theme)}
        current={textColor}
        disabled={locked}
        onPick={(color) => model.applyStyle({ color })}
      />
    </section>
  );
}

/**
 * Rich-text section: the Phase 3A character-level controls for a single
 * unlocked text box (target `text`, self-guarding).
 *
 * @param props - the section props.
 * @returns the section element, or null.
 */
export function RichTextSection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { objects } = props;
  const single = objects.length === 1 ? (objects[0] ?? null) : null;
  if (single === null || !isTextBoxObject(single) || single.locked) {
    return null;
  }
  return <InspectorTextSection object={single} />;
}

/**
 * Sticky card section: card colour swatches + font-size stepper (target
 * `stickyNote`).
 *
 * @param props - the section props.
 * @returns the section element, or null when no note is selected.
 */
export function StickySection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { objects, model } = props;
  const hasSticky = objects.some((object) => isStickyNoteObject(object));
  const locked = objects.every((object) => object.locked);
  if (!hasSticky) {
    return null;
  }
  const stickyFontSize = sharedNumber(objects, (object) =>
    isStickyNoteObject(object) ? object.fontSize : undefined,
  );
  const noteColor = sharedString(objects, (object) =>
    isStickyNoteObject(object) ? object.noteColor : undefined,
  );
  return (
    <section aria-label="inspector.noteColor" className="space-y-2.5">
      <SectionLabel icon={StickyNote} labelKey="inspector.noteColor" />
      <SwatchGrid
        options={stickySwatchOptions()}
        current={noteColor}
        disabled={locked}
        onPick={(color) => model.applyStyle({ noteColor: color })}
      />
      <FontSizeStepper
        value={stickyFontSize ?? DEFAULT_STICKY_FONT_SIZE}
        disabled={locked}
        onCommit={(size) => model.applyStyle({ fontSize: size })}
      />
    </section>
  );
}

/**
 * Sticker section (R11.1, target `sticker`): the glyph picker — a live
 * preview of the current emoji plus the curated palette grid. Picking a
 * glyph restyles EVERY selected sticker in one composite undo entry; the
 * preview chip mirrors the canvas backing-plate styling so the section
 * reads as part of the same product language.
 *
 * @param props - the section props.
 * @returns the section element, or null when no sticker is selected.
 */
export function StickerSection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { objects, model } = props;
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const recents = useRecentStickers((state) => state.recents);
  const noteRecent = useRecentStickers((state) => state.note);
  const searching = query.trim() !== "";
  const results = useMemo(
    () => (searching ? searchStickers(query) : []),
    [query, searching],
  );
  const stickers = objects.filter(isStickerObject);
  if (stickers.length === 0) {
    return null;
  }
  const locked = objects.every((object) => object.locked);
  const current =
    stickers.length === 1 ? (stickers[0]?.emoji ?? "") : "";
  const mixed =
    stickers.length > 1 &&
    stickers.some((sticker) => sticker.emoji !== (stickers[0]?.emoji ?? ""));
  /** Applies one emoji through the composite restyle + recents. */
  const apply = (emoji: string): void => {
    model.applyStyle({ emoji });
    noteRecent(emoji);
  };
  return (
    <section aria-label="inspector.sticker" className="space-y-2.5">
      <SectionLabel icon={Smile} labelKey="inspector.sticker" />
      <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-accent/30 px-2.5 py-2">
        <span
          className="flex size-10 flex-none items-center justify-center rounded-full bg-background/70 text-2xl leading-none shadow-inner"
          aria-hidden="true"
        >
          {mixed ? "❔" : (current || "⭐")}
        </span>
        <p className="text-[11px] leading-5 text-muted-foreground">
          {mixed ? t("inspector.stickerMixed") : t("inspector.stickerHint")}
        </p>
      </div>
      {/* R12.1: the search box switches the palette to the full
          library (bilingual keywords — «ستاره» and "star" both work). */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("inspector.stickerSearchPlaceholder")}
          aria-label={t("inspector.stickerSearchLabel")}
          dir="auto"
          className="h-8 w-full rounded-lg border border-border/60 bg-background/70 ps-8 pe-7 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        {searching ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("search.clear")}
            className="absolute end-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {searching ? (
        results.length > 0 ? (
          <div
            className="panel-scroll grid max-h-48 grid-cols-8 gap-1 overflow-y-auto rounded-lg border border-border/50 bg-background/30 p-1"
            role="radiogroup"
            aria-label={t("inspector.stickerSearchLabel")}
          >
            {results.map((entry) => {
              const active = !mixed && entry.emoji === current;
              return (
                <button
                  key={entry.emoji}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={locked}
                  title={entry.keywords[0] ?? entry.emoji}
                  onClick={() => apply(entry.emoji)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg text-lg leading-none",
                    "transition-all duration-150 hover:scale-110 hover:bg-accent/60",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                    active
                      ? "bg-accent ring-2 ring-ring shadow-sm"
                      : "bg-background/50",
                    locked && "opacity-50",
                  )}
                >
                  {entry.emoji}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border/60 px-2 py-3 text-center text-[11px] text-muted-foreground/70">
            {t("inspector.stickerNoResults")}
          </p>
        )
      ) : (
        <>
          {!searching && recents.length > 0 ? (
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                <Clock className="size-2.5" aria-hidden="true" />
                {t("stickerLibrary.recents")}
              </p>
              <div className="flex flex-wrap gap-1">
                {recents.slice(0, 8).map((emoji) => (
                  <button
                    key={`recent:${emoji}`}
                    type="button"
                    disabled={locked}
                    title={emoji}
                    onClick={() => apply(emoji)}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-lg text-base leading-none",
                      "transition-all duration-150 hover:scale-110 hover:bg-accent/60",
                      "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                      "bg-background/40",
                      locked && "opacity-50",
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div
            className="grid grid-cols-8 gap-1"
            role="radiogroup"
            aria-label={t("inspector.sticker")}
          >
            {CURATED_STICKERS.map((emoji) => {
              const active = !mixed && emoji === current;
              return (
                <button
                  key={emoji}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={locked}
                  title={emoji}
                  onClick={() => apply(emoji)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg text-lg leading-none",
                    "transition-all duration-150 hover:scale-110 hover:bg-accent/60",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                    active
                      ? "bg-accent ring-2 ring-ring shadow-sm"
                      : "bg-background/50",
                    locked && "opacity-50",
                  )}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Geometry section: position/size/rotation numerics of the single sized
 * object (target `*`, self-guarding).
 *
 * @param props - the section props.
 * @returns the section element, or null.
 */
export function GeometrySection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { objects, model } = props;
  const { t } = useTranslation();
  const single = objects.length === 1 ? (objects[0] ?? null) : null;
  const sizedSingle = single !== null && hasSize(single) ? single : null;
  const locked = objects.every((object) => object.locked);
  if (sizedSingle === null) {
    return null;
  }
  const rotatableSingle =
    single !== null &&
    !isGroupObject(single) &&
    !isFreehandSingle(single) &&
    !isConnectorObject(single)
      ? single
      : null;
  const rotationDeg =
    rotatableSingle !== null
      ? Math.round((rotatableSingle.rotation * 180) / Math.PI)
      : 0;
  return (
    <section aria-label="inspector.geometry" className="space-y-2.5">
      <SectionLabel icon={Ruler} labelKey="inspector.geometry" />
      <div className="grid grid-cols-2 gap-2">
        <LabeledField label={t("inspector.x")}>
          <NumberField
            value={sizedSingle.position.x}
            onCommit={(x) => model.moveTo(x, sizedSingle.position.y)}
            disabled={locked}
            ariaLabelKey="inspector.x"
          />
        </LabeledField>
        <LabeledField label={t("inspector.y")}>
          <NumberField
            value={sizedSingle.position.y}
            onCommit={(y) => model.moveTo(sizedSingle.position.x, y)}
            disabled={locked}
            ariaLabelKey="inspector.y"
          />
        </LabeledField>
        <LabeledField label={t("inspector.width")}>
          <NumberField
            value={sizedSingle.width}
            min={1}
            onCommit={(width) => model.resizeTo(width, sizedSingle.height)}
            disabled={locked}
            ariaLabelKey="inspector.width"
          />
        </LabeledField>
        <LabeledField label={t("inspector.height")}>
          <NumberField
            value={sizedSingle.height}
            min={1}
            onCommit={(height) => model.resizeTo(sizedSingle.width, height)}
            disabled={locked}
            ariaLabelKey="inspector.height"
          />
        </LabeledField>
        {rotatableSingle !== null && (
          <LabeledField label={t("inspector.rotation")}>
            <NumberField
              value={rotationDeg}
              min={-360}
              max={360}
              onCommit={(degrees) => model.rotateTo(degrees)}
              disabled={locked}
              ariaLabelKey="inspector.rotation"
            />
          </LabeledField>
        )}
      </div>
    </section>
  );
}

/**
 * Multi-text format section (R7.2/AC7.2): font family + size + ink colour
 * applying to EVERY selected text object (boxes AND notes) in ONE undo
 * entry (target `text`; renders at ≥2 text objects — the single-object
 * case is covered by the per-kind sections).
 *
 * @param props - the section props.
 * @returns the section element, or null.
 */
export function MultiTextSection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { objects, model } = props;
  const theme = useUiStore((state) => state.theme);
  const texts = objects.filter(
    (object) => isTextBoxObject(object) || isStickyNoteObject(object),
  );
  const locked = objects.every((object) => object.locked);
  const { t } = useTranslation();
  if (texts.length < 2) {
    return null;
  }
  const fontSize = sharedNumber(texts, (object) =>
    isTextBoxObject(object) || isStickyNoteObject(object)
      ? object.fontSize
      : undefined,
  );
  const textColor = sharedString(texts, (object) =>
    isTextBoxObject(object) || isStickyNoteObject(object)
      ? object.color
      : undefined,
  );
  const family =
    sharedString(texts, (object) =>
      isTextBoxObject(object) || isStickyNoteObject(object)
        ? object.fontFamily
        : undefined,
    ) ?? "";
  return (
    <section aria-label="inspector.multiText" className="space-y-2.5">
      <SectionLabel icon={Type} labelKey="inspector.multiText" />
      <label className="flex flex-col gap-1">
        <span className="px-0.5 text-[11px] font-medium text-muted-foreground">
          {t("inspector.fontFamily")}
        </span>
        <select
          value={family}
          disabled={locked}
          onChange={(event) =>
            model.applyStyle({ fontFamily: event.target.value })
          }
          className={cn(
            "w-full rounded-lg border border-border/70 bg-background/70 px-2 py-1.5",
            "text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {FONT_FAMILIES.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </label>
      <FontSizeStepper
        value={fontSize ?? 20}
        disabled={locked}
        onCommit={(size) => model.applyStyle({ fontSize: size })}
      />
      <SwatchGrid
        options={textSwatchOptions(theme)}
        current={textColor}
        disabled={locked}
        onPick={(color) => model.applyStyle({ color })}
      />
    </section>
  );
}

/* ── Shared section plumbing (ported from the pre-registry inspector) ── */

/**
 * Section heading: icon + translated label.
 *
 * @param props - the lucide icon and the label key.
 * @returns the heading element.
 */
export function SectionLabel(props: {
  readonly icon: LucideIcon;
  readonly labelKey: TranslationKey;
}): ReactElement {
  const { t } = useTranslation();
  const Icon = props.icon;
  return (
    <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
      <Icon className="size-3.5 text-muted-foreground/70" aria-hidden="true" />
      {t(props.labelKey)}
    </h3>
  );
}

/**
 * One labelled numeric slot of the geometry grid.
 *
 * @param props - the field label and the field element.
 * @returns the labelled field element.
 */
function LabeledField(props: {
  readonly label: string;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-muted-foreground/80">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}

/**
 * @param object - the object to inspect.
 * @returns whether the object carries numeric `width`/`height` fields.
 */
function hasSize(object: SceneObjectData): object is SceneObjectData & {
  readonly width: number;
  readonly height: number;
} {
  return (
    "width" in object &&
    "height" in object &&
    typeof object.width === "number" &&
    typeof object.height === "number"
  );
}

/** Freehand single guard (typed). */
function isFreehandSingle(object: SceneObjectData): boolean {
  return isFreehandObject(object);
}

/**
 * Reduces one numeric field over the selection: the shared value when every
 * compatible object agrees, `null` when mixed (or none compatible).
 */
function sharedNumber(
  objects: readonly SceneObjectData[],
  pick: (object: SceneObjectData) => number | undefined,
): number | null {
  let value: number | null = null;
  for (const object of objects) {
    const current = pick(object);
    if (current === undefined) {
      continue;
    }
    if (value === null) {
      value = current;
    } else if (current !== value) {
      return null;
    }
  }
  return value;
}

/**
 * Reduces one string field over the selection (the sharedNumber variant).
 */
function sharedString(
  objects: readonly SceneObjectData[],
  pick: (object: SceneObjectData) => string | undefined,
): string | null {
  let value: string | null = null;
  for (const object of objects) {
    const current = pick(object);
    if (current === undefined) {
      continue;
    }
    if (value === null) {
      value = current;
    } else if (current !== value) {
      return null;
    }
  }
  return value;
}

/** One option of a connector style row. */
interface ConnectorRowOption<T extends string> {
  readonly value: T;
  readonly labelKey: TranslationKey;
  readonly icon?: LucideIcon;
}

/** Routing options of the inspector connector row. */
const ROUTING_ROW_OPTIONS: readonly ConnectorRowOption<ConnectorRoutingKind>[] =
  [
    { value: "straight", labelKey: "connector.routing.straight", icon: Minus },
    {
      value: "orthogonal",
      labelKey: "connector.routing.orthogonal",
      icon: CornerDownRight,
    },
    { value: "curved", labelKey: "connector.routing.curved", icon: Spline },
  ];

/** Arrow options of the inspector connector row. */
const ARROW_ROW_OPTIONS: readonly ConnectorRowOption<ConnectorArrowMode>[] = [
  { value: "none", labelKey: "connector.arrow.none", icon: CircleSlash },
  { value: "end", labelKey: "connector.arrow.end", icon: ArrowRight },
  { value: "both", labelKey: "connector.arrow.both", icon: ArrowLeftRight },
];

/** Dash options of the inspector connector row (CSS line previews). */
const DASH_ROW_OPTIONS: readonly ConnectorRowOption<StrokeStyleKind>[] = [
  { value: "solid", labelKey: "connector.dash.solid" },
  { value: "dashed", labelKey: "connector.dash.dashed" },
  { value: "dotted", labelKey: "connector.dash.dotted" },
];

/**
 * A labelled three-option radio row of connector style choices.
 *
 * @param props - the row label key, options, current value and pick handler.
 * @returns the row element.
 */
function ConnectorStyleRow<T extends string>(props: {
  readonly labelKey: TranslationKey;
  readonly options: readonly ConnectorRowOption<T>[];
  readonly current: T | null;
  readonly disabled: boolean;
  readonly onPick: (value: T) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div>
      <p className="mb-1 px-0.5 text-[11px] font-medium text-muted-foreground">
        {t(props.labelKey)}
      </p>
      <div
        className="grid grid-cols-3 gap-1"
        role="radiogroup"
        aria-label={t(props.labelKey)}
      >
        {props.options.map((option) => {
          const active = option.value === props.current;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={t(option.labelKey)}
              title={t(option.labelKey)}
              disabled={props.disabled}
              onClick={() => props.onPick(option.value)}
              className={cn(
                "group flex flex-col items-center gap-1 rounded-lg border px-1.5 py-1.5 outline-none",
                "transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:opacity-40",
                active
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {Icon !== undefined ? (
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "size-4 transition-transform duration-150",
                    active ? "scale-110 text-primary" : "group-hover:scale-105",
                  )}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-0.5 w-7 rounded-full",
                    active ? "bg-primary" : "bg-muted-foreground/70",
                  )}
                  style={dashPreviewStyle(option.value as StrokeStyleKind)}
                />
              )}
              <span className="text-[10px] leading-tight">
                {t(option.labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Maps a connector's two endpoint arrows onto the shared arrow preset.
 *
 * @param connector - the connector to inspect.
 * @returns the arrow mode ("none" | "end" | "both").
 */
function arrowModeOf(connector: ConnectorObjectData): ConnectorArrowMode {
  if (connector.startArrow === "arrow" && connector.endArrow === "arrow") {
    return "both";
  }
  if (connector.endArrow === "arrow") {
    return "end";
  }
  return "none";
}

/** Type re-export for the registry props. */
export type { InspectorModel };
