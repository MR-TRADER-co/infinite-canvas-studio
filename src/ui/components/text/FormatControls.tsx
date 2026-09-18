"use client";

/**
 * Rich text format controls (R3A.6): the character-level formatting set —
 * font family (live font-preview labels, Vazirmatn first), font size,
 * bold/italic/underline/strike, subscript/superscript, text colour,
 * highlight colour, alignment, RTL/LTR direction toggle, line height,
 * letter spacing, clear-formatting and the ZWNJ inserter (R3A.8).
 *
 * The SAME component renders in two hosts: the floating toolbar above the
 * text selection (while editing — commands run against the live selection)
 * and the Inspector's rich-text section (while a text box is merely
 * selected — commands run through `applyWholeDocumentFormat`, exactly one
 * undo step each).
 *
 * Every control keeps the editor's focus: `mousedown` is defaulted off on
 * buttons (the caret + selection never leave ProseMirror), except inside
 * the numeric steppers where the input must focus.
 */
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeftRight,
  Bold,
  Check,
  Code2,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Plus,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Text,
  Underline as UnderlineIcon,
  Palette,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslation, type TranslationKey } from "@/ui/i18n";
import {
  FONT_OPTIONS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  HIGHLIGHT_PALETTE,
  LETTER_SPACING_MAX,
  LETTER_SPACING_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  TEXT_COLOR_PALETTE,
} from "@/text/editor/extensions";
import type { FormatChain } from "@/text/commands/WholeDocFormat";
import { currentBlockDirection } from "@/text/editor/extensions/Direction";
import {
  isSelectionInTable,
  insertTableInheritingDirection,
} from "@/text/editor/tableCommands";
import TableGridPicker from "@/ui/components/toolbar/TableGridPicker";
import { useUiStore } from "@/ui/store/uiStore";
import { requestLinkDialog } from "@/ui/text/intents";
import { Table as TableIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTodayAsJalaliText } from "@/core/utils/jalali";

/** Props of the shared format control set. */
export interface FormatControlsProps {
  /** The shared TipTap editor (state source). */
  readonly editor: Editor;
  /** Object-level base font size (stepper placeholder, world units). */
  readonly baseFontSize: number;
  /** Executes a formatting chain (live selection or whole document). */
  readonly execute: (chain: FormatChain) => void;
  /** Floating-bar layout (single wrappable row) vs inspector rows. */
  readonly compact?: boolean;
}

/**
 * The full R3A.6 control set.
 *
 * @param props - the editor, executor and layout mode.
 * @returns the control groups.
 */
export default function FormatControls(props: FormatControlsProps): ReactNode {
  const { t } = useTranslation();
  const { editor, execute } = props;
  const textStyle = editor.getAttributes("textStyle");
  const highlightAttrs = editor.getAttributes("highlight");
  const dir = currentBlockDirection(editor);

  const run = (f: FormatChain): void => execute(f);

  const groups: ReactNode[] = [
    <BlockFormatGroup key="block" editor={editor} run={run} />,
    <ListFormatGroup key="lists" editor={editor} run={run} />,
    <FontFamilyMenu
      key="font"
      current={(textStyle.fontFamily as string | undefined) ?? null}
      onPick={(family) =>
        run(
          family === null
            ? (c) => c.unsetFontFamily()
            : (c) => c.setFontFamily(family),
        )
      }
    />,
    <MetricStepper
      key="size"
      labelKey="textFormat.fontSize"
      value={(textStyle.fontSize as number | undefined) ?? null}
      placeholder={props.baseFontSize}
      min={FONT_SIZE_MIN}
      max={FONT_SIZE_MAX}
      step={1}
      decimals={0}
      onCommit={(value) =>
        run(
          value === null
            ? (c) => c.unsetFontSize()
            : (c) => c.setFontSize(value),
        )
      }
    />,
    <MarkGroup key="marks" editor={editor} run={run} />,
    <ColorMenu
      key="color"
      icon={Palette}
      labelKey="textFormat.textColor"
      current={(textStyle.color as string | undefined) ?? null}
      palette={TEXT_COLOR_PALETTE}
      onPick={(color) =>
        run(color === null ? (c) => c.unsetColor() : (c) => c.setColor(color))
      }
    />,
    <ColorMenu
      key="highlight"
      icon={Highlighter}
      labelKey="textFormat.highlight"
      current={(highlightAttrs.color as string | undefined) ?? null}
      palette={HIGHLIGHT_PALETTE}
      onPick={(color) =>
        run(
          color === null
            ? (c) => c.unsetHighlight()
            : (c) => c.setHighlight({ color }),
        )
      }
    />,
    <AlignGroup key="align" editor={editor} run={run} />,
    // Insert-table grid picker (R6.1): offered while editing OUTSIDE tables
    // (inside a table the TableToolbar owns the structure commands).
    props.compact === true && !isSelectionInTable(editor) ? (
      <InsertTableMenu key="insertTable" editor={editor} />
    ) : null,
    <FormatButton
      key="direction"
      icon={ArrowLeftRight}
      labelKey="textFormat.direction"
      hint={
        dir === "rtl"
          ? t("textFormat.rtl")
          : dir === "ltr"
            ? t("textFormat.ltr")
            : t("textFormat.auto")
      }
      active={dir !== "auto"}
      onClick={(event) => {
        if (event.shiftKey) {
          run((c) => c.unsetTextDirection());
          return;
        }
        run((c) => c.setTextDirection(dir === "rtl" ? "ltr" : "rtl"));
      }}
    />,
    <MetricStepper
      key="lineHeight"
      labelKey="textFormat.lineHeight"
      value={(textStyle.lineHeight as number | undefined) ?? null}
      placeholder={1.65}
      min={LINE_HEIGHT_MIN}
      max={LINE_HEIGHT_MAX}
      step={0.1}
      decimals={2}
      onCommit={(value) =>
        run(
          value === null
            ? (c) => c.unsetLineHeight()
            : (c) => c.setLineHeight(value),
        )
      }
    />,
    <MetricStepper
      key="letterSpacing"
      labelKey="textFormat.letterSpacing"
      value={(textStyle.letterSpacing as number | undefined) ?? null}
      placeholder={0}
      min={LETTER_SPACING_MIN}
      max={LETTER_SPACING_MAX}
      step={0.5}
      decimals={1}
      onCommit={(value) =>
        run(
          value === null
            ? (c) => c.unsetLetterSpacing()
            : (c) => c.setLetterSpacing(value),
        )
      }
    />,
    <FormatButton
      key="zwnj"
      icon={null}
      labelKey="textFormat.zwnj"
      glyph="می‌"
      onClick={() => run((c) => c.insertContent("‌"))}
    />,
    // R8.3: the Jalali "insert current date" pair on the text toolbar
    // (long «۲۱ مرداد ۱۴۰۳» + numeric 1403/05/21).
    <FormatButton
      key="insertDate"
      icon={null}
      labelKey="textFormat.insertDate"
      glyph="۲۱ مرداد ۱۴۰۳"
      onClick={() =>
        run((c) => c.insertContent(formatTodayAsJalaliText("long")))
      }
    />,
    <FormatButton
      key="insertDateNumeric"
      icon={null}
      labelKey="textFormat.insertDateNumeric"
      glyph="۱۴۰۳/۰۵/۲۱"
      onClick={() =>
        run((c) => c.insertContent(formatTodayAsJalaliText("numeric")))
      }
    />,
    // Ctrl+K link dialog (R3B.3): floating bar only — the inspector path
    // formats whole documents, links belong to the live selection.
    props.compact === true ? (
      <FormatButton
        key="link"
        icon={Link2}
        labelKey="textFormat.link"
        active={editor.isActive("link")}
        onClick={() => requestLinkDialog()}
      />
    ) : null,
    <FormatButton
      key="clear"
      icon={RemoveFormatting}
      labelKey="textFormat.clearFormatting"
      onClick={() => run((c) => c.unsetAllMarks().clearNodes())}
    />,
  ];

  if (props.compact !== true) {
    return <div className="space-y-2.5">{groups}</div>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {groups.map((group, index) => (
        <div key={index} className="flex items-center gap-1">
          {index > 0 && (
            <span className="mx-0.5 h-4 w-px bg-border/70" aria-hidden="true" />
          )}
          {group}
        </div>
      ))}
    </div>
  );
}

/**
 * Block-format group (R3B.1): heading dropdown (paragraph / H1–H3 with
 * Persian labels), blockquote, code block and horizontal rule.
 */
function BlockFormatGroup(props: {
  editor: Editor;
  run: (f: FormatChain) => void;
}): ReactNode {
  const { editor } = props;
  return (
    <div className="flex items-center gap-1">
      <HeadingMenu editor={editor} run={props.run} />
      <FormatButton
        icon={Quote}
        labelKey="textFormat.blockquote"
        active={editor.isActive("blockquote")}
        onClick={() => props.run((c) => c.toggleBlockquote())}
      />
      <FormatButton
        icon={Code2}
        labelKey="textFormat.codeBlock"
        active={editor.isActive("codeBlock")}
        onClick={() => props.run((c) => c.toggleCodeBlock())}
      />
      <FormatButton
        icon={Minus}
        labelKey="textFormat.horizontalRule"
        onClick={() => props.run((c) => c.setHorizontalRule())}
      />
    </div>
  );
}

/** The heading-level dropdown (paragraph, H1, H2, H3 — Persian labels). */
function HeadingMenu(props: {
  editor: Editor;
  run: (f: FormatChain) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useCloseOnOutside(ref, open, setOpen);
  const headingLevel = currentHeadingLevel(props.editor);
  const options: Array<{
    key: TranslationKey;
    level: number | null;
    icon: React.ComponentType<{ className?: string }> | null;
  }> = [
    { key: "textFormat.paragraph", level: null, icon: Text },
    { key: "textFormat.heading1", level: 1, icon: Heading1Icon },
    { key: "textFormat.heading2", level: 2, icon: Heading2Icon },
    { key: "textFormat.heading3", level: 3, icon: Heading3Icon },
  ];
  const currentLabel =
    headingLevel === null
      ? t("textFormat.paragraph")
      : headingLevel === 1
        ? t("textFormat.heading1")
        : headingLevel === 2
          ? t("textFormat.heading2")
          : t("textFormat.heading3");
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t("textFormat.block")}
        aria-expanded={open}
        title={t("textFormat.block")}
        onMouseDown={preventFocusSteal}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] outline-none",
          "transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring",
          open || headingLevel !== null
            ? "bg-primary/10 text-foreground"
            : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
        )}
      >
        <span className="max-w-28 truncate">{currentLabel}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("textFormat.block")}
          className="absolute top-9 z-50 min-w-44 overflow-hidden rounded-xl border border-border/60 bg-background/95 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          {options.map((option) => {
            const Icon = option.icon;
            const active = headingLevel === option.level;
            return (
              <button
                key={option.key}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onMouseDown={preventFocusSteal}
                onClick={() => {
                  setOpen(false);
                  props.run(
                    option.level === null
                      ? (c) => c.setParagraph()
                      : (c) =>
                          c.setHeading({ level: option.level as 1 | 2 | 3 }),
                  );
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-start",
                  "text-[12px] outline-none transition-colors duration-100",
                  "hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="flex items-center gap-2 truncate">
                  {Icon !== null && (
                    <Icon className="size-3.5" aria-hidden="true" />
                  )}
                  {t(option.key)}
                </span>
                {active && (
                  <Check
                    className="size-3.5 flex-none text-primary"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * @param editor - the shared editor.
 * @returns the heading level of the selection's block (null = paragraph).
 */
function currentHeadingLevel(editor: Editor): number | null {
  for (const level of [1, 2, 3]) {
    if (editor.isActive("heading", { level })) {
      return level;
    }
  }
  return null;
}

/** Lucide heading icons (rendered as small glyph buttons). */
function Heading1Icon(props: { className?: string }): ReactNode {
  return <HeadingGlyph {...props} label="۱" />;
}

function Heading2Icon(props: { className?: string }): ReactNode {
  return <HeadingGlyph {...props} label="۲" />;
}

function Heading3Icon(props: { className?: string }): ReactNode {
  return <HeadingGlyph {...props} label="۳" />;
}

/** A bold "H" + level glyph (avoids pulling three extra lucide icons). */
function HeadingGlyph(props: { className?: string; label: string }): ReactNode {
  return (
    <span
      className={cn("inline-flex items-baseline font-bold", props.className)}
    >
      H<span className="text-[9px] leading-none">{props.label}</span>
    </span>
  );
}

/**
 * List group (R3B.2): bullet, ordered and task lists — markers sit on the
 * correct side for RTL paragraphs via the per-block `dir` attributes.
 */
function ListFormatGroup(props: {
  editor: Editor;
  run: (f: FormatChain) => void;
}): ReactNode {
  const { editor } = props;
  return (
    <div className="flex items-center gap-1">
      <FormatButton
        icon={List}
        labelKey="textFormat.bulletList"
        active={editor.isActive("bulletList")}
        onClick={() => props.run((c) => c.toggleBulletList())}
      />
      <FormatButton
        icon={ListOrdered}
        labelKey="textFormat.orderedList"
        active={editor.isActive("orderedList")}
        onClick={() => props.run((c) => c.toggleOrderedList())}
      />
      <FormatButton
        icon={ListChecks}
        labelKey="textFormat.taskList"
        active={editor.isActive("taskList")}
        onClick={() => props.run((c) => c.toggleTaskList())}
      />
    </div>
  );
}

/** Bold / italic / underline / strike / subscript / superscript group. */
function MarkGroup(props: {
  editor: Editor;
  run: (f: FormatChain) => void;
}): ReactNode {
  const { editor } = props;
  const items: Array<{
    icon: LucideIcon;
    key: TranslationKey;
    name: string;
    command: FormatChain;
  }> = [
    {
      icon: Bold,
      key: "textFormat.bold",
      name: "bold",
      command: (c) => c.toggleBold(),
    },
    {
      icon: Italic,
      key: "textFormat.italic",
      name: "italic",
      command: (c) => c.toggleItalic(),
    },
    {
      icon: UnderlineIcon,
      key: "textFormat.underline",
      name: "underline",
      command: (c) => c.toggleUnderline(),
    },
    {
      icon: Strikethrough,
      key: "textFormat.strike",
      name: "strike",
      command: (c) => c.toggleStrike(),
    },
    {
      icon: SubscriptIcon,
      key: "textFormat.subscript",
      name: "subscript",
      command: (c) => c.toggleSubscript(),
    },
    {
      icon: SuperscriptIcon,
      key: "textFormat.superscript",
      name: "superscript",
      command: (c) => c.toggleSuperscript(),
    },
  ];
  return (
    <div className="flex items-center gap-1">
      {items.map((item) => (
        <FormatButton
          key={item.key}
          icon={item.icon}
          labelKey={item.key}
          active={editor.isActive(item.name)}
          onClick={() => props.run(item.command)}
        />
      ))}
    </div>
  );
}

/** Alignment group (right/center/left/justify). */
function AlignGroup(props: {
  editor: Editor;
  run: (f: FormatChain) => void;
}): ReactNode {
  const { editor } = props;
  const items: Array<{ icon: LucideIcon; key: TranslationKey; align: string }> =
    [
      { icon: AlignRight, key: "textFormat.alignRight", align: "right" },
      { icon: AlignCenter, key: "textFormat.alignCenter", align: "center" },
      { icon: AlignLeft, key: "textFormat.alignLeft", align: "left" },
      { icon: AlignJustify, key: "textFormat.alignJustify", align: "justify" },
    ];
  return (
    <div className="flex items-center gap-1">
      {items.map((item) => (
        <FormatButton
          key={item.key}
          icon={item.icon}
          labelKey={item.key}
          active={editor.isActive({ textAlign: item.align })}
          onClick={() => props.run((c) => c.setTextAlign(item.align))}
        />
      ))}
    </div>
  );
}

/** One icon button of the format UI (focus-preserving, tooltip + hint). */
function FormatButton(props: {
  readonly icon: LucideIcon | null;
  readonly labelKey: TranslationKey;
  readonly hint?: string;
  readonly glyph?: string;
  readonly active?: boolean;
  readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}): ReactNode {
  const { t } = useTranslation();
  const Icon = props.icon;
  const title =
    props.hint === undefined
      ? t(props.labelKey)
      : `${t(props.labelKey)} — ${props.hint}${props.labelKey === "textFormat.zwnj" ? " (Ctrl+Shift+Space)" : ""}`;
  return (
    <button
      type="button"
      aria-label={t(props.labelKey)}
      aria-pressed={props.active === true}
      title={title}
      onMouseDown={preventFocusSteal}
      onClick={props.onClick}
      className={cn(
        "grid h-8 min-w-8 place-items-center rounded-lg px-1.5 text-[13px] font-medium outline-none",
        "transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring",
        props.active === true
          ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
          : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
      )}
    >
      {Icon !== null ? (
        <Icon className="size-4" aria-hidden="true" />
      ) : (
        <span className="px-0.5" aria-hidden="true">
          {props.glyph}
        </span>
      )}
    </button>
  );
}

/** Font family dropdown with live font-preview labels (Vazirmatn first). */
function FontFamilyMenu(props: {
  readonly current: string | null;
  readonly onPick: (family: string | null) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutside(ref, open, setOpen);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t("textFormat.fontFamily")}
        aria-expanded={open}
        title={t("textFormat.fontFamily")}
        onMouseDown={preventFocusSteal}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] outline-none",
          "transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring",
          open || props.current !== null
            ? "bg-primary/10 text-foreground"
            : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
        )}
        style={{ fontFamily: props.current ?? undefined }}
      >
        <span className="max-w-24 truncate">
          {props.current === null
            ? t("font.vazirmatn")
            : shortFamily(props.current)}
        </span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("textFormat.fontFamily")}
          className="absolute top-9 z-50 min-w-44 overflow-hidden rounded-xl border border-border/60 bg-background/95 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          <FontOption
            family={null}
            label={t("textFormat.defaultFont")}
            current={props.current}
            onPick={props.onPick}
          />
          {FONT_OPTIONS.map((option) => (
            <FontOption
              key={option.family}
              family={option.family}
              label={t(option.labelKey)}
              current={props.current}
              onPick={props.onPick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One font option row with a live font preview label. */
function FontOption(props: {
  readonly family: string | null;
  readonly label: string;
  readonly current: string | null;
  readonly onPick: (family: string | null) => void;
}): ReactNode {
  const active =
    props.family === null
      ? props.current === null
      : shortFamily(props.current ?? "") === shortFamily(props.family);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onMouseDown={preventFocusSteal}
      onClick={() => props.onPick(props.family)}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-start",
        "text-[12px] outline-none transition-colors duration-100",
        "hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring",
        active ? "text-foreground" : "text-muted-foreground",
      )}
      style={{ fontFamily: props.family ?? "Vazirmatn" }}
    >
      <span className="truncate">{props.label}</span>
      {active && (
        <Check className="size-3.5 flex-none text-primary" aria-hidden="true" />
      )}
    </button>
  );
}

/** Colour/highlight palette popover. */
function ColorMenu(props: {
  readonly icon: LucideIcon;
  readonly labelKey: TranslationKey;
  readonly current: string | null;
  readonly palette: readonly string[];
  readonly onPick: (color: string | null) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutside(ref, open, setOpen);
  const Icon = props.icon;
  const unset = props.palette[0];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t(props.labelKey)}
        aria-expanded={open}
        title={t(props.labelKey)}
        onMouseDown={preventFocusSteal}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "relative grid h-8 w-8 place-items-center rounded-lg outline-none",
          "transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring",
          open || (props.current !== null && props.current !== unset)
            ? "bg-primary/10 text-foreground"
            : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
        {props.current !== null && props.current !== unset && (
          <span
            aria-hidden="true"
            className="absolute bottom-1 end-1 size-2 rounded-full border border-background"
            style={{ backgroundColor: props.current }}
          />
        )}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t(props.labelKey)}
          className="absolute top-9 z-50 w-44 rounded-xl border border-border/60 bg-background/95 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          <div className="grid grid-cols-6 gap-1.5">
            {props.palette.map((color, index) => (
              <SwatchButton
                key={color}
                color={color}
                isUnset={index === 0}
                unsetLabel={t("textFormat.themeInk")}
                active={color === props.current}
                onPick={() => props.onPick(index === 0 ? null : color)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One palette swatch (the first entry is the "unset/theme" swatch). */
function SwatchButton(props: {
  readonly color: string;
  readonly isUnset: boolean;
  readonly unsetLabel: string;
  readonly active: boolean;
  readonly onPick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.active}
      aria-label={props.isUnset ? props.unsetLabel : props.color}
      title={props.isUnset ? props.unsetLabel : props.color}
      onMouseDown={preventFocusSteal}
      onClick={props.onPick}
      className={cn(
        "grid size-6 place-items-center rounded-md border outline-none",
        "transition-transform duration-100 focus-visible:ring-2 focus-visible:ring-ring",
        props.active
          ? "border-primary/70 scale-110"
          : "border-border/60 hover:scale-105 hover:border-foreground/30",
      )}
      style={
        props.isUnset || props.color === "transparent"
          ? undefined
          : { backgroundColor: props.color }
      }
    >
      {props.isUnset && (
        <span
          aria-hidden="true"
          className="size-3 rounded-[3px] border border-border bg-gradient-to-br from-background to-muted"
        />
      )}
      {props.color === "transparent" && !props.isUnset && (
        <span
          aria-hidden="true"
          className="size-3 rounded-[3px] border border-border bg-background"
        />
      )}
    </button>
  );
}

/** Numeric stepper for font size / line height / letter spacing. */
function MetricStepper(props: {
  readonly labelKey: TranslationKey;
  readonly value: number | null;
  readonly placeholder: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly decimals: number;
  readonly onCommit: (value: number | null) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (props.value === null ? "" : String(props.value));
  const round = (value: number): number =>
    Number(
      (Math.round(value / props.step) * props.step).toFixed(props.decimals),
    );
  const commit = (raw: string): void => {
    setDraft(null);
    const parsed = Number.parseFloat(raw);
    if (raw.trim() === "" || !Number.isFinite(parsed)) {
      props.onCommit(null);
      return;
    }
    props.onCommit(Math.min(props.max, Math.max(props.min, round(parsed))));
  };
  const bump = (delta: number): void => {
    const base = props.value ?? props.placeholder;
    props.onCommit(
      Math.min(props.max, Math.max(props.min, round(base + delta))),
    );
  };
  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label={t(props.labelKey)}
      title={t(props.labelKey)}
    >
      <button
        type="button"
        aria-label={t("inspector.decrease")}
        title={t("inspector.decrease")}
        disabled={(props.value ?? props.placeholder) <= props.min}
        onMouseDown={preventFocusSteal}
        onClick={() => bump(-props.step)}
        className={cn(
          "grid size-6 place-items-center rounded-md text-muted-foreground outline-none",
          "transition-colors duration-150 hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        )}
      >
        <Minus className="size-3" aria-hidden="true" />
      </button>
      <input
        type="text"
        inputMode="decimal"
        aria-label={t(props.labelKey)}
        className={cn(
          "h-7 w-11 rounded-md border border-border/60 bg-background/60 px-1 text-center",
          "text-[12px] tabular-nums text-foreground outline-none",
          "focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring",
        )}
        value={shown}
        placeholder={String(props.placeholder)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit((event.target as HTMLInputElement).value);
          }
        }}
      />
      <button
        type="button"
        aria-label={t("inspector.increase")}
        title={t("inspector.increase")}
        disabled={(props.value ?? props.placeholder) >= props.max}
        onMouseDown={preventFocusSteal}
        onClick={() => bump(props.step)}
        className={cn(
          "grid size-6 place-items-center rounded-md text-muted-foreground outline-none",
          "transition-colors duration-150 hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        )}
      >
        <Plus className="size-3" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Closes a popover on outside pointer presses (capture-phase, so the press
 * lands before any other handler).
 */
function useCloseOnOutside(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void,
): void {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const node = ref.current;
      if (
        node !== null &&
        event.target instanceof Node &&
        !node.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, ref, setOpen]);
}

/**
 * Keeps the editor caret/selection: defaulting the mousedown off prevents
 * the browser from moving DOM focus to the clicked button (the deferred
 * focusout handler would otherwise end the session on every format click).
 */
function preventFocusSteal(event: React.MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/**
 * @param family - a CSS font-family value.
 * @returns its first family name (for compact display).
 */
function shortFamily(family: string): string {
  return family.split(",")[0]?.replace(/['"]/g, "").trim() ?? family;
}

/**
 * Insert-table dropdown (R6.1): a compact trigger opening the hover-sweep
 * dimensions grid; picking a size inserts a table at the caret inheriting
 * the surrounding paragraph direction (R6.5). Custom (non-portal)
 * dropdown so the click never leaves the `data-text-format-ui` subtree —
 * the text session survives the interaction.
 */
function InsertTableMenu(props: { readonly editor: Editor }): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutside(ref, open, setOpen);
  const rows = useUiStore((state) => state.tableRows);
  const cols = useUiStore((state) => state.tableColumns);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t("table.insert")}
        aria-expanded={open}
        title={t("table.insert")}
        onMouseDown={preventFocusSteal}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-lg outline-none",
          "transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring",
          open
            ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
            : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
        )}
      >
        <TableIcon className="size-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("table.insert")}
          className="absolute top-9 z-50 w-max rounded-xl border border-border/60 bg-background/95 p-2.5 shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          <TableGridPicker
            rows={rows}
            cols={cols}
            onPick={(pickedRows, pickedCols) => {
              setOpen(false);
              insertTableInheritingDirection(
                props.editor,
                pickedRows,
                pickedCols,
                true,
              );
            }}
          />
        </div>
      )}
    </div>
  );
}
