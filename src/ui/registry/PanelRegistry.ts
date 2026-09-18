"use client";

/**
 * Panel registry (R7.1): the registered home of every dockable panel —
 * the layout renders panels FROM this registry, so a panel (core or a
 * future plugin's) appears in the dock with ZERO layout-code edits
 * (AC7.11's seam proof).
 *
 * Entries carry `{id (owner.name), titleKey, icon, component, placement:
 * left|right|bottom, order, defaultOpen}`. The `core.` owner prefix is
 * reserved for the first-party app (§1.7.2) — third-party panels arrive
 * with the Phase 9 plugin runtime and will register through their own
 * owner namespace.
 *
 * Open/closed state is VIEW state: the host persists it to localStorage
 * (per panel id) and rehydrates on mount — see `PanelContainer`.
 */
import type { ComponentType } from "react";
import { Registry, type RegistryEntryMeta } from "@/core/registry/Registry";

/** Dock placements a panel can request. */
export type PanelPlacement = "left" | "right" | "bottom";

/** The reserved owner prefix of the first-party app (§1.7.2). */
const PANEL_CORE_OWNER = "core";

/** Valid `owner.name` id pattern (hierarchical names allowed). */
const PANEL_ID_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-zA-Z][a-zA-Z0-9_-]*)+$/;

/**
 * One registered panel (R7.1).
 */
export interface PanelEntry extends RegistryEntryMeta {
  /** `owner.name` id — `core.` reserved for the app (§1.7.2). */
  readonly id: string;
  /** i18n key of the panel title (header + toggle tooltip). */
  readonly titleKey: string;
  /** Icon name (lucide) of the dock toggle button. */
  readonly icon: string;
  /** The panel body component (mounts inside the dock slot). */
  readonly component: ComponentType;
  /** Which dock edge the panel lives on. */
  readonly placement: PanelPlacement;
  /** Rendering order inside the dock (ascending). */
  readonly order: number;
  /** Whether the panel starts open on a fresh profile. */
  readonly defaultOpen: boolean;
}

/**
 * The panel registry: a `Registry<PanelEntry>` with placement-aware
 * listing and reserved-owner enforcement.
 */
export class PanelRegistry extends Registry<PanelEntry> {
  /** Whether non-`core.` owners may register (R9.5: plugin panels). */
  private readonly allowThirdPartyOwners: boolean;

  /**
   * @param allowThirdPartyOwners - whether plugin owners may register
   *        (false until the Phase 9 plugin runtime opens the registry).
   */
  public constructor(allowThirdPartyOwners: boolean = false) {
    super("panels");
    this.allowThirdPartyOwners = allowThirdPartyOwners;
  }

  /**
   * Registers one panel, enforcing the id scheme + reserved owner.
   *
   * @param entry - the panel registration.
   * @returns this registry (chaining).
   * @throws Error on invalid/duplicate ids or non-`core.` owners.
   */
  public override register(entry: PanelEntry): this {
    if (!PANEL_ID_PATTERN.test(entry.id)) {
      throw new Error(
        `[panels] id "${entry.id}" must follow the owner.name scheme (e.g. core.layers)`,
      );
    }
    const owner = entry.id.split(".")[0] ?? "";
    if (owner !== PANEL_CORE_OWNER && !this.allowThirdPartyOwners) {
      throw new Error(
        `[panels] owner "${owner}" is not allowed here — "${PANEL_CORE_OWNER}." is reserved for core panels (plugin panels arrive in Phase 9)`,
      );
    }
    if (
      entry.placement !== "left" &&
      entry.placement !== "right" &&
      entry.placement !== "bottom"
    ) {
      throw new Error(
        `[panels] entry "${entry.id}" requires a placement of left|right|bottom`,
      );
    }
    return super.register(entry);
  }

  /**
   * @param placement - the dock edge.
   * @returns the panels of that placement, ordered by `order`.
   */
  public listByPlacement(placement: PanelPlacement): readonly PanelEntry[] {
    return this.list()
      .filter((entry) => entry.placement === placement)
      .sort((a, b) => a.order - b.order);
  }
}
