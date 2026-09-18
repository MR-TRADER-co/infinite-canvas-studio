"use client";

/**
 * Settings-section registry (R8.2): the Settings dialog is COMPOSED of
 * contributed sections `{id, titleKey, order, component}` — a section
 * (core today, a plugin's in Phase 9) appears in the dialog with ZERO
 * dialog-code edits (AC8.3's seam proof).
 *
 * Each section component owns its controls and reads/writes through the
 * live settings surface (the UI store + the persistence subscriber) —
 * every change takes effect immediately, there is no Apply button.
 */
import type { ComponentType } from "react";
import { Registry } from "@/core/registry/Registry";

/** The reserved owner prefix of the first-party app (§1.7.2). */
const SETTINGS_CORE_OWNER = "core";

/** Valid `owner.name` id pattern. */
const SETTINGS_ID_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-zA-Z][a-zA-Z0-9_-]*)+$/;

/** One registered settings section (R8.2). */
export interface SettingsSectionEntry {
  /** `owner.name` id — `core.` reserved for the app (§1.7.2). */
  readonly id: string;
  /** i18n key of the section header. */
  readonly titleKey: string;
  /** The section body component (its controls; read/write live). */
  readonly component: ComponentType;
  /** Rendering order (ascending). */
  readonly order: number;
}

/**
 * The settings-section registry: a `Registry<SettingsSectionEntry>` with
 * reserved-owner enforcement (mirrors PanelRegistry's contract).
 */
export class SettingsSectionRegistry extends Registry<SettingsSectionEntry> {
  /** Whether non-`core.` owners may register (R9.5: plugin sections). */
  private readonly allowThirdPartyOwners: boolean;

  /**
   * @param allowThirdPartyOwners - whether plugin owners may register
   *        (false until the Phase 9 plugin runtime opens the registry).
   */
  public constructor(allowThirdPartyOwners: boolean = false) {
    super("settingsSections");
    this.allowThirdPartyOwners = allowThirdPartyOwners;
  }

  /**
   * Registers one section, enforcing the id scheme + reserved owner.
   *
   * @param entry - the section registration.
   * @returns this registry (chaining).
   * @throws Error on invalid/duplicate ids or non-`core.` owners.
   */
  public override register(entry: SettingsSectionEntry): this {
    if (!SETTINGS_ID_PATTERN.test(entry.id)) {
      throw new Error(
        `[settingsSections] id "${entry.id}" must follow the owner.name scheme (e.g. core.settings.general)`,
      );
    }
    const owner = entry.id.split(".")[0] ?? "";
    if (owner !== SETTINGS_CORE_OWNER && !this.allowThirdPartyOwners) {
      throw new Error(
        `[settingsSections] owner "${owner}" is not allowed here — "${SETTINGS_CORE_OWNER}." is reserved (plugin sections arrive in Phase 9)`,
      );
    }
    return super.register(entry);
  }

  /**
   * @returns every section, ordered by `order` (the dialog's compose
   *          order — registration order breaks ties).
   */
  public listOrdered(): readonly SettingsSectionEntry[] {
    return [...this.list()].sort((a, b) => a.order - b.order);
  }
}
