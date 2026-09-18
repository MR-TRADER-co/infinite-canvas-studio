"use client";

/**
 * Table dimensions grid picker (R6.1): a hover-sweep 10×8 grid of cells
 * that previews the picked table size live (Google-Docs style). Shared by
 * the canvas toolbar's table tool button and the rich-text toolbar's
 * insert-table control. Numbers render localised (Persian digits in fa).
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import { useUiStore } from "@/ui/store/uiStore";
import { TABLE_MAX_COLS, TABLE_MAX_ROWS } from "@/text/editor/richtext";
import { cn } from "@/lib/utils";

/** Props of the grid picker. */
export interface TableGridPickerProps {
  /** The currently committed row count (initial highlight). */
  readonly rows: number;
  /** The currently committed column count (initial highlight). */
  readonly cols: number;
  /** Invoked with the picked dimensions on click. */
  readonly onPick: (rows: number, cols: number) => void;
  /** Whether every cell ignores pointer events (outside tables). */
  readonly disabled?: boolean;
}

/**
 * @param props - the committed dimensions and the pick callback.
 * @returns the hover-sweep grid plus the live dimensions caption.
 */
export default function TableGridPicker(
  props: TableGridPickerProps,
): ReactNode {
  const { t, language } = useTranslation();
  const dir = useUiStore((state) => state.language) === "fa" ? "rtl" : "ltr";
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(
    null,
  );

  const activeRows = hover?.rows ?? props.rows;
  const activeCols = hover?.cols ?? props.cols;

  // Immutable ranges (react-hooks/immutability: loop variables used inside
  // JSX closures must not be mutated — build the index arrays up front).
  const rowRange = Array.from(
    { length: TABLE_MAX_ROWS },
    (_, index) => index + 1,
  );
  const colRange = Array.from(
    { length: TABLE_MAX_COLS },
    (_, index) => index + 1,
  );

  const cells: ReactNode[] = rowRange.flatMap((rowIndex) =>
    colRange.map((colIndex) => {
      const inside = rowIndex <= activeRows && colIndex <= activeCols;
      const committed =
        !props.disabled && rowIndex <= props.rows && colIndex <= props.cols;
      return (
        <button
          key={`${rowIndex}-${colIndex}`}
          type="button"
          role="gridcell"
          aria-selected={inside}
          aria-label={`${formatInteger(colIndex, language)}×${formatInteger(rowIndex, language)}`}
          disabled={props.disabled}
          onMouseEnter={() => setHover({ rows: rowIndex, cols: colIndex })}
          onFocus={() => setHover({ rows: rowIndex, cols: colIndex })}
          onClick={() => {
            props.onPick(rowIndex, colIndex);
            setHover(null);
          }}
          className={cn(
            "size-3.5 rounded-[3px] border transition-colors duration-75",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            inside
              ? "border-primary/60 bg-primary/70"
              : "border-border/50 bg-transparent hover:bg-accent/50",
            committed && !inside ? "bg-primary/25" : "",
            props.disabled && "opacity-50",
          )}
        />
      );
    }),
  );

  return (
    <div
      className="flex flex-col items-center gap-2 select-none"
      onMouseLeave={() => setHover(null)}
      dir={dir === "rtl" ? "rtl" : "ltr"}
    >
      <div
        role="grid"
        aria-label={t("toolbar.tablePicker")}
        className="grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${TABLE_MAX_COLS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${TABLE_MAX_ROWS}, minmax(0, 1fr))`,
        }}
      >
        {cells}
      </div>
      <p className="text-[11px] font-medium tabular-nums text-muted-foreground">
        {t("table.dimensions")
          .replace("{cols}", formatInteger(activeCols, language))
          .replace("{rows}", formatInteger(activeRows, language))}
      </p>
    </div>
  );
}
