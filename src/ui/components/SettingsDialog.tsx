"use client";

/**
 * The composed Settings dialog (R8.2): renders the sections FROM the
 * settings-section registry — the dialog itself names NO section, so a
 * late registration (a Phase 9 plugin's) appears with zero dialog edits
 * (AC8.3's seam).
 *
 * Everything the dialog mounts reads/writes LIVE state (the store
 * slices); the persistence subscriber stores each change immediately.
 */
import { useEffect, useState, type ReactElement } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import type { SettingsSectionEntry } from "@/ui/registry/SettingsSectionRegistry";
import { useTranslation } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";

/**
 * @returns the settings dialog (open state from the UI store).
 */
export default function SettingsDialog(): ReactElement {
  const { t } = useTranslation();
  const open = useUiStore((state) => state.settingsDialogOpen);
  const setOpen = useUiStore((state) => state.setSettingsDialogOpen);
  const language = useUiStore((state) => state.language);
  const [sections, setSections] = useState<readonly SettingsSectionEntry[]>([]);

  // Read the sections from the registry (late registrations re-read;
  // the AC8.3 seam: this dialog only consumes the list).
  useEffect(() => {
    const registry = AppContext.getDefault().tryGet(Services.settingsSections);
    if (registry === undefined) {
      return;
    }
    const sync = (): void => {
      setSections(registry.listOrdered());
    };
    sync();
    const unsubscribe = registry.onRegistered(sync);
    return unsubscribe;
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        dir={language === "fa" ? "rtl" : "ltr"}
        className="max-h-[80vh] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.dialogHint")}</DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border/60 px-1">
          {sections.map((section) => {
            const Body = section.component;
            return <Body key={section.id} />;
          })}
          {sections.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              {t("settings.empty")}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
