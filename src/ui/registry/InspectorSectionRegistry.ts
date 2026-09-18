"use client";

/**
 * Inspector-section registry (R7.2): the Inspector panel is COMPOSED of
 * registered sections contributed per selection target type — a new
 * section (core or future plugin) appears inside the Inspector with ZERO
 * Inspector-code edits (AC7.11's second seam proof).
 *
 * Sections target either the selection KIND (`shape`, `textBox`, …) or
 * the special targets:
 * - `"*"` — renders for every non-empty selection (position/size);
 * - `"text"` — renders while ANY text object is selected (the multi-text
 *   format section, AC7.2).
 *
 * The component receives the live selection snapshot (objects +
 * services accessor) as props; ordering inside the target follows the
 * `order` field.
 */
import type { ComponentType } from "react";
import { Registry, type RegistryEntryMeta } from "@/core/registry/Registry";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { InspectorModel } from "@/ui/hooks/useInspectorModel";

/** Selection targets a section can attach to. */
export type InspectorTarget = "*" | "text" | string;

/** Props handed to every inspector section component. */
export interface InspectorSectionProps {
  /** The currently selected objects (top-level, paint order). */
  readonly objects: readonly SceneObjectData[];
  /** The shared inspector model (style/move/rename actions, one undo entry
   *  per call — the multi-apply contract of AC7.2). */
  readonly model: InspectorModel;
}

/** The reserved owner prefix of the first-party app (§1.7.2). */
const SECTION_CORE_OWNER = "core";

/** Valid `owner.name` id pattern (hierarchical names allowed). */
const SECTION_ID_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-zA-Z][a-zA-Z0-9_-]*)+$/;

/**
 * One registered inspector section (R7.2).
 */
export interface InspectorSectionEntry extends RegistryEntryMeta {
  /** `owner.name` id — `core.` reserved for the app (§1.7.2). */
  readonly id: string;
  /** Which selection content this section renders for. */
  readonly target: InspectorTarget;
  /** The section body component. */
  readonly component: ComponentType<InspectorSectionProps>;
  /** Rendering order among the sections of the same target. */
  readonly order: number;
  /** Optional i18n key of a section header rendered above the body. */
  readonly titleKey?: string;
}

/**
 * The inspector-section registry: a `Registry<InspectorSectionEntry>`
 * with target-aware resolution (matching order: exact kind > `text` >
 * `*`) and reserved-owner enforcement.
 */
export class InspectorSectionRegistry extends Registry<InspectorSectionEntry> {
  /** Creates a registry named "inspector". */
  public constructor() {
    super("inspector");
  }

  /**
   * Registers one section, enforcing the id scheme + reserved owner.
   *
   * @param entry - the section registration.
   * @returns this registry (chaining).
   * @throws Error on invalid/duplicate ids or non-`core.` owners.
   */
  public override register(entry: InspectorSectionEntry): this {
    if (!SECTION_ID_PATTERN.test(entry.id)) {
      throw new Error(
        `[inspector] id "${entry.id}" must follow the owner.name scheme (e.g. core.inspector.geometry)`,
      );
    }
    const owner = entry.id.split(".")[0] ?? "";
    if (owner !== SECTION_CORE_OWNER) {
      throw new Error(
        `[inspector] owner "${owner}" is not allowed here — "${SECTION_CORE_OWNER}." is reserved for core sections (plugin sections arrive in Phase 9)`,
      );
    }
    if (typeof entry.target !== "string" || entry.target.length === 0) {
      throw new Error(
        `[inspector] entry "${entry.id}" requires a non-empty target`,
      );
    }
    return super.register(entry);
  }

  /**
   * Resolves the sections rendering for the current selection: exact
   * kind matches, then `text` (any text object selected), then `*`
   * (any selection) — each group ordered by `order`.
   *
   * @param kinds - the kinds of the selected objects.
   * @returns the section entries to render, in order.
   */
  public sectionsForSelection(
    kinds: readonly string[],
  ): readonly InspectorSectionEntry[] {
    const exact: InspectorSectionEntry[] = [];
    const text: InspectorSectionEntry[] = [];
    const any: InspectorSectionEntry[] = [];
    const hasText = kinds.some(
      (kind) => kind === "textBox" || kind === "stickyNote",
    );
    for (const entry of this.list()) {
      if (kinds.includes(entry.target)) {
        exact.push(entry);
      } else if (entry.target === "text" && hasText) {
        text.push(entry);
      } else if (entry.target === "*") {
        any.push(entry);
      }
    }
    const byOrder = (a: InspectorSectionEntry, b: InspectorSectionEntry) =>
      a.order - b.order;
    exact.sort(byOrder);
    text.sort(byOrder);
    any.sort(byOrder);
    return [...exact, ...text, ...any];
  }
}
