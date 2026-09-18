"use client";

/**
 * Core settings-section registration (R8.2): the six first-party
 * sections registered onto the app's `SettingsSectionRegistry` (the
 * About section joined in v1.48.5). A registration IS the seam
 * (idempotent — StrictMode safe).
 */
import type { AppContext } from "@/AppContext";
import { Services } from "@/App";
import {
  AppearanceSettingsSection,
  CanvasSettingsSection,
  GeneralSettingsSection,
  StorageSettingsSection,
  TextSettingsSection,
} from "@/ui/settings/sections";
import { AboutSettingsSection } from "@/ui/settings/aboutSection";

/**
 * Registers the core settings sections (idempotent).
 *
 * @param context - the booted application context.
 */
export function ensureSettingsRegistered(context: AppContext): void {
  const registry = context.get(Services.settingsSections);
  const sections = [
    {
      id: "core.settings.general",
      titleKey: "settings.section.general",
      component: GeneralSettingsSection,
      order: 10,
    },
    {
      id: "core.settings.appearance",
      titleKey: "settings.section.appearance",
      component: AppearanceSettingsSection,
      order: 20,
    },
    {
      id: "core.settings.text",
      titleKey: "settings.section.text",
      component: TextSettingsSection,
      order: 30,
    },
    {
      id: "core.settings.canvas",
      titleKey: "settings.section.canvas",
      component: CanvasSettingsSection,
      order: 40,
    },
    {
      id: "core.settings.storage",
      titleKey: "settings.section.storage",
      component: StorageSettingsSection,
      order: 50,
    },
    // v1.48.5: the public-repository hand-off (version / author /
    // licence / the GitHub link through the R3B.3 confirmation flow).
    {
      id: "core.settings.about",
      titleKey: "settings.section.about",
      component: AboutSettingsSection,
      order: 60,
    },
  ];
  for (const section of sections) {
    if (!registry.has(section.id)) {
      registry.register(section);
    }
  }
}
