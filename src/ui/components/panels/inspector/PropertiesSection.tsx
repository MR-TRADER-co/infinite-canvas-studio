"use client";

/**
 * The inspector's structured-properties section (Knowledge Pack R11.8):
 * typed key→value rows on the selected object — text / number / date /
 * checkbox / select / tags editors — with add + remove, ONE undo step
 * per edit, and the project-level PropertySchema feeding name
 * suggestions and `select` options.
 *
 * Every commit swaps the WHOLE properties record through one
 * UpdateObjectCommand (the QuerySection convention); the schema store
 * learns unknown names by inference on first use (R11.3) and is NOT
 * part of undo (the styles precedent).
 */
import { useEffect, useState, type ReactElement } from "react";
import {
  Braces,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  Hash,
  ListPlus,
  Trash2,
  Type as TypeIcon,
} from "lucide-react";
import { Application, Services } from "@/App";
import { AppContext } from "@/AppContext";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import {
  PROPERTY_TYPES,
  TAGS_PROPERTY,
  cleanPropertyName,
  coercePropertyValue,
  isTagsValue,
  type PropertyFieldSchema,
  type PropertyType,
  type PropertyValue,
} from "@/core/model/Properties";
import { dateToJalali, formatJalaliNumeric } from "@/core/utils/jalali";
import { useTranslation } from "@/ui/i18n";
import type { InspectorSectionProps } from "@/ui/registry/InspectorSectionRegistry";
import { cn } from "@/lib/utils";

/** The per-type visual language: icon + chip classes (RTL-safe). */
const TYPE_STYLE: Record<
  PropertyType,
  { icon: typeof TypeIcon; chip: string }
> = {
  text: {
    icon: TypeIcon,
    chip: "border-slate-400/40 bg-slate-400/10 text-slate-600 dark:text-slate-300",
  },
  number: {
    icon: Hash,
    chip: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  },
  date: {
    icon: CalendarDays,
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  boolean: {
    icon: CheckSquare,
    chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  select: {
    icon: ChevronDown,
    chip: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  tags: {
    icon: Hash,
    chip: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
};

/** The empty default value of a type (the add-row's initial commit). */
function defaultValueOfType(type: PropertyType): PropertyValue {
  switch (type) {
    case "number":
      return 0;
    case "boolean":
      return false;
    case "tags":
      return [];
    default:
      return "";
  }
}

/** Parses an ISO date into a Jalali tooltip string ("" when unusable). */
function jalaliTooltip(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  try {
    return formatJalaliNumeric(dateToJalali(date));
  } catch {
    return "";
  }
}

/**
 * The inspector section body (registered as `core.inspector.properties`).
 *
 * @param props - the inspector section props (the live selection).
 * @returns the section, or null for empty/multi selections.
 */
export default function PropertiesSection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { objects } = props;
  const { t, language } = useTranslation();
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    // Re-render on schema mutations (the name suggestions + select
    // options live in the property-schema store).
    let stopSchema: (() => void) | null = null;
    void Application.boot().then((context: AppContext) => {
      stopSchema = context
        .get(Services.eventBus)
        .on("property-schema:changed", () => setTick((value) => value + 1));
    });
    return () => {
      stopSchema?.();
    };
  }, []);

  const single = objects.length === 1 ? (objects[0] ?? null) : null;
  if (single === null) {
    return null;
  }
  const locked = single.locked;
  const context = AppContext.getDefault();
  const scene = context.tryGet(Services.scene);
  const history = context.tryGet(Services.history);
  const schema = context.tryGet(Services.propertySchema);
  if (
    scene === undefined ||
    history === undefined ||
    schema === undefined
  ) {
    return null;
  }
  void tick; // (the property-schema:changed subscription drives re-renders)

  const entries = Object.entries(single.properties ?? {}) as [
    string,
    PropertyValue,
  ][];

  /**
   * Commits the next properties record (one undo step) and teaches the
   * schema unknown names by inference.
   *
   * @param next - the full next record (empty = clear the field).
   */
  const commitRecord = (
    next: Readonly<Record<string, PropertyValue>>,
  ): void => {
    if (locked) {
      return;
    }
    let schemaChanged = false;
    for (const [name, value] of Object.entries(next)) {
      schemaChanged = schema.inferField(name, value) || schemaChanged;
    }
    const record = Object.keys(next).length === 0 ? undefined : { ...next };
    // `properties: undefined` (an emptied record) clears the field: the
    // patch spread replaces the old value wholesale.
    const command = new UpdateObjectCommand(
      scene,
      single.id,
      { properties: record },
      single,
    );
    command.do();
    history.push(command);
    if (schemaChanged) {
      schema.notify();
    }
  };

  /**
   * Sets one property's value (add or edit — one undo step).
   *
   * @param name - the property name.
   * @param value - the next value (undefined removes).
   */
  const setValue = (name: string, value: PropertyValue | undefined): void => {
    const next: Record<string, PropertyValue> = { ...(single.properties ?? {}) };
    if (value === undefined) {
      delete next[name];
    } else {
      next[name] = value;
    }
    commitRecord(next);
  };

  const knownNames = schema.names();
  const datalistId = `property-names-${single.id}`;

  return (
    <section aria-label={t("properties.title")} className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        <Braces className="size-3" aria-hidden="true" />
        {t("properties.title")}
        {entries.length > 0 && (
          <span className="ms-auto rounded-full bg-accent/60 px-1.5 py-px text-[9px] font-medium tabular-nums text-muted-foreground">
            {entries.length}
          </span>
        )}
      </h4>

      {entries.length === 0 && !adding && (
        <p className="rounded-lg border border-dashed border-border/70 bg-accent/20 px-2.5 py-2 text-[10px] leading-4 text-muted-foreground/80">
          {t("properties.emptyHint")}
        </p>
      )}

      <div className="space-y-1.5">
        {entries.map(([name, value]) => {
          const field =
            schema.field(name) ?? inferSchemaOf(name, value);
          return (
            <PropertyRow
              key={`${single.id}:${name}:${String(value)}`}
              name={name}
              value={value}
              field={field}
              locked={locked}
              language={language}
              suggestedNames={knownNames}
              onCommit={(next) => {
                setValue(name, next);
              }}
              onRemove={() => {
                setValue(name, undefined);
              }}
            />
          );
        })}
      </div>

      <datalist id={datalistId}>
        {knownNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {adding ? (
        <AddPropertyRow
          language={language}
          suggestedNames={knownNames}
          datalistId={datalistId}
          onCancel={() => {
            setAdding(false);
          }}
          onAdd={(name, type, options) => {
            setAdding(false);
            if (schema.setField(name, type, options)) {
              schema.notify();
            }
            setValue(name, defaultValueOfType(type));
          }}
        />
      ) : (
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            setAdding(true);
          }}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70",
            "bg-accent/20 px-2 py-1.5 text-[11px] text-muted-foreground transition-all",
            "hover:border-primary/50 hover:bg-primary/10 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border/70 disabled:hover:bg-accent/20",
          )}
        >
          <ListPlus className="size-3.5" aria-hidden="true" />
          {t("properties.add")}
        </button>
      )}
    </section>
  );
}

/** Infers a transient schema when the store does not know a name yet. */
function inferSchemaOf(
  name: string,
  value: PropertyValue,
): PropertyFieldSchema {
  if (typeof value === "number") {
    return { type: "number" };
  }
  if (typeof value === "boolean") {
    return { type: "boolean" };
  }
  if (typeof value === "string") {
    return /^\d{4}-\d{2}-\d{2}/.test(value)
      ? { type: "date" }
      : { type: "text" };
  }
  return { type: "tags" };
}

/** One property row: type badge + typed editor + remove. */
function PropertyRow(props: {
  readonly name: string;
  readonly value: PropertyValue;
  readonly field: PropertyFieldSchema;
  readonly locked: boolean;
  readonly language: string;
  readonly suggestedNames: readonly string[];
  readonly onCommit: (value: PropertyValue | undefined) => void;
  readonly onRemove: () => void;
}): ReactElement {
  const {
    name,
    value,
    field,
    locked,
    language,
    onCommit,
    onRemove,
  } = props;
  const { t } = useTranslation();
  const type = field.type;
  const style = TYPE_STYLE[type];
  const Icon = style.icon;
  const initial = isTagsValue(value)
    ? value.join("، ")
    : typeof value === "string"
      ? value
      : typeof value === "number"
        ? String(value)
        : "";
  const [draft, setDraft] = useState(initial);

  /** Commits the draft when it changed (blur/Enter). */
  const commitDraft = (): void => {
    const next = coercePropertyValue(type, draft);
    if (type === "tags") {
      const current = isTagsValue(value) ? value : [];
      const nextTags = (next ?? []) as readonly string[];
      if (
        nextTags.length !== current.length ||
        nextTags.some((tag, index) => tag !== current[index])
      ) {
        onCommit(nextTags);
      }
      return;
    }
    if (next === null) {
      setDraft(initial);
      return;
    }
    const currentText =
      typeof value === "string"
        ? value
        : typeof value === "number"
          ? String(value)
          : "";
    if (String(next) !== currentText) {
      onCommit(next);
    }
  };

  const inputClasses = cn(
    "w-full min-w-0 rounded-lg border border-border/60 bg-background/70 px-2 py-1",
    "text-[11px] leading-5 text-foreground outline-none transition-all",
    "placeholder:text-muted-foreground/50",
    "focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40",
    "disabled:cursor-not-allowed disabled:opacity-60",
  );

  return (
    <div
      className={cn(
        "group rounded-lg border border-border/50 bg-accent/25 p-1.5 transition-colors",
        "focus-within:border-primary/40 focus-within:bg-accent/40 hover:border-border/80",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-flex flex-none items-center gap-1 rounded-md border px-1.5 py-0.5",
            "text-[9px] font-semibold leading-none",
            style.chip,
          )}
          title={t(`properties.type.${type}`)}
        >
          <Icon className="size-2.5" aria-hidden="true" />
          {t(`properties.type.${type}`)}
        </span>
        <span
          dir="auto"
          className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/90"
          title={name}
        >
          {name === TAGS_PROPERTY ? `#${name}` : name}
        </span>
        <button
          type="button"
          disabled={locked}
          onClick={onRemove}
          title={t("properties.remove")}
          aria-label={`${t("properties.remove")}: ${name}`}
          className={cn(
            "flex-none rounded-md p-1 text-muted-foreground/60 transition-all",
            "hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-destructive/40",
            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            "disabled:cursor-not-allowed disabled:opacity-0",
          )}
        >
          <Trash2 className="size-3" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-1">
        {type === "boolean" ? (
          <label className="flex cursor-pointer items-center gap-2 px-1 py-0.5">
            <input
              type="checkbox"
              checked={value === true}
              disabled={locked}
              onChange={(event) => {
                onCommit(event.target.checked);
              }}
              className="size-3.5 accent-primary"
            />
            <span className="text-[11px] text-muted-foreground">
              {value === true ? t("properties.true") : t("properties.false")}
            </span>
          </label>
        ) : type === "select" ? (
          <select
            value={typeof value === "string" ? value : ""}
            disabled={locked}
            onChange={(event) => {
              onCommit(event.target.value);
            }}
            className={cn(inputClasses, "cursor-pointer")}
            dir="auto"
          >
            <option value="">{t("properties.selectEmpty")}</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            {/* An out-of-list value stays visible (never silently lost). */}
            {typeof value === "string" &&
              value !== "" &&
              !(field.options ?? []).includes(value) && (
                <option value={value}>{value}</option>
              )}
          </select>
        ) : type === "tags" && isTagsValue(value) ? (
          <div className="space-y-1">
            {value.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {value.map((tag) => (
                  <span
                    key={tag}
                    dir="auto"
                    className="inline-flex items-center gap-0.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-700 dark:text-rose-300"
                  >
                    <Hash className="size-2.5" aria-hidden="true" />
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              dir="auto"
              value={draft}
              disabled={locked}
              maxLength={160}
              placeholder={t("properties.tagsPlaceholder")}
              aria-label={`${name}: ${t("properties.type.tags")}`}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitDraft();
                  (event.target as HTMLInputElement).blur();
                } else if (event.key === "Escape") {
                  setDraft(initial);
                  (event.target as HTMLInputElement).blur();
                }
              }}
              className={inputClasses}
            />
          </div>
        ) : type === "date" ? (
          <input
            type="date"
            value={typeof value === "string" ? value : ""}
            disabled={locked}
            onChange={(event) => {
              onCommit(event.target.value === "" ? "" : event.target.value);
            }}
            aria-label={`${name}: ${t("properties.type.date")}`}
            title={
              typeof value === "string" && value !== ""
                ? `${jalaliTooltip(value)}${language === "fa" ? " (جلالی)" : ""}`
                : undefined
            }
            className={cn(inputClasses, "tabular-nums")}
          />
        ) : (
          <input
            type="text"
            dir="auto"
            inputMode={type === "number" ? "decimal" : undefined}
            value={draft}
            disabled={locked}
            maxLength={200}
            placeholder={
              type === "number"
                ? t("properties.numberPlaceholder")
                : t("properties.textPlaceholder")
            }
            aria-label={`${name}: ${t(`properties.type.${type}`)}`}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitDraft();
                (event.target as HTMLInputElement).blur();
              } else if (event.key === "Escape") {
                setDraft(initial);
                (event.target as HTMLInputElement).blur();
              }
            }}
            className={cn(inputClasses, type === "number" && "tabular-nums")}
          />
        )}
      </div>
    </div>
  );
}

/** The add row: name + type (+ select options) before the first commit. */
function AddPropertyRow(props: {
  readonly language: string;
  readonly suggestedNames: readonly string[];
  readonly datalistId: string;
  readonly onCancel: () => void;
  readonly onAdd: (
    name: string,
    type: PropertyType,
    options?: readonly string[],
  ) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const [options, setOptions] = useState("");
  const trimmed = cleanPropertyName(name);
  const canAdd = trimmed.length > 0;

  const inputClasses = cn(
    "w-full min-w-0 rounded-lg border border-border/60 bg-background/70 px-2 py-1",
    "text-[11px] leading-5 text-foreground outline-none transition-all",
    "placeholder:text-muted-foreground/50",
    "focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40",
  );

  return (
    <div
      className={cn(
        "space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-1.5",
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150",
      )}
    >
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          dir="auto"
          value={name}
          list={props.datalistId}
          maxLength={40}
          placeholder={t("properties.namePlaceholder")}
          aria-label={t("properties.namePlaceholder")}
          autoFocus
          onChange={(event) => {
            setName(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canAdd) {
              props.onAdd(trimmed, type, splitOptions(options));
            } else if (event.key === "Escape") {
              props.onCancel();
            }
          }}
          className={inputClasses}
        />
        <select
          value={type}
          onChange={(event) => {
            const next = event.target.value as PropertyType;
            if ((PROPERTY_TYPES as readonly string[]).includes(next)) {
              setType(next);
            }
          }}
          aria-label={t("properties.typeLabel")}
          className={cn(inputClasses, "w-24 flex-none cursor-pointer")}
        >
          {PROPERTY_TYPES.map((option) => (
            <option key={option} value={option}>
              {t(`properties.type.${option}`)}
            </option>
          ))}
        </select>
      </div>
      {type === "select" && (
        <input
          type="text"
          dir="auto"
          value={options}
          maxLength={200}
          placeholder={t("properties.optionsPlaceholder")}
          aria-label={t("properties.optionsPlaceholder")}
          onChange={(event) => {
            setOptions(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canAdd) {
              props.onAdd(trimmed, type, splitOptions(options));
            } else if (event.key === "Escape") {
              props.onCancel();
            }
          }}
          className={inputClasses}
        />
      )}
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {t("properties.cancel")}
        </button>
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => {
            props.onAdd(trimmed, type, splitOptions(options));
          }}
          className={cn(
            "rounded-md bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground",
            "transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {t("properties.addConfirm")}
        </button>
      </div>
    </div>
  );
}

/** Splits the select-options input (comma/، -separated). */
function splitOptions(raw: string): readonly string[] | undefined {
  const parts = raw
    .split(/[,،]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length === 0 ? undefined : parts;
}
