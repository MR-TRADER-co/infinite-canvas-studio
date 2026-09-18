"use client";

/**
 * Recovery dialog (R4.6/AC4.4): mounted app-wide; when the composition
 * root detects an autosave snapshot NEWER than the last disk save on
 * boot, the Persian «بازیابی آخرین تغییرات؟» dialog offers the restore
 * («بازیابی») or a fresh start («شروع تازه» — clears the slot so the
 * discarded work is not re-offered).
 *
 * The dialog only DECIDES — the composition root owns the actual restore
 * (scene swap, history reset, id reseeding) through the
 * `project:recovery-decided` event, keeping the layering intact.
 */
import { useEffect, useState, type ReactNode } from "react";
import { History } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";
import { formatInteger, toPersianDigits } from "@/ui/i18n/numbers";
import type { RecoveryOfferedEvent } from "@/core/events/EventBus";

/**
 * Formats the snapshot time as a short local timestamp (Persian digits
 * when the setting is on).
 *
 * @param timestamp - epoch milliseconds.
 * @param persianDigits - whether to render ۰–۹.
 * @returns the formatted time (HH:MM).
 */
function formatSnapshotTime(timestamp: number, persianDigits: boolean): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const text = `${hours}:${minutes}`;
  return persianDigits ? toPersianDigits(text) : text;
}

/** The recovery dialog (event-driven visibility). */
export default function RecoveryDialog(): ReactNode {
  const { t } = useTranslation();
  const language = useUiStore((state) => state.language);
  const persianDigits = useUiStore((state) => state.persianDigits);
  const [offer, setOffer] = useState<RecoveryOfferedEvent | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const install = (): void => {
      const bus = AppContext.getDefault().tryGet(Services.eventBus);
      if (bus !== undefined) {
        unsubscribe = bus.on("project:recovery-offered", (payload) => {
          if (!cancelled) {
            setOffer(payload);
          }
        });
      }
    };
    install();
    if (unsubscribe === undefined) {
      void Application.boot().then(() => {
        if (!cancelled) {
          install();
        }
      });
    }
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  /** Sends the decision to the composition root and closes. */
  const decide = (restore: boolean): void => {
    const bus = AppContext.getDefault().tryGet(Services.eventBus);
    setOffer(null);
    bus?.emit("project:recovery-decided", { restore });
  };

  return (
    <Dialog
      open={offer !== null}
      onOpenChange={(next) => (next ? undefined : decide(false))}
    >
      <DialogContent
        dir={language === "fa" ? "rtl" : "ltr"}
        className="max-w-md"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" aria-hidden="true" />
            {t("recovery.title")}
          </DialogTitle>
          <DialogDescription className="pt-1 text-xs leading-relaxed">
            {t("recovery.body")
              .replace(
                "{count}",
                formatInteger(offer?.objectCount ?? 0, {
                  language,
                  persianDigits,
                }),
              )
              .replace(
                "{time}",
                formatSnapshotTime(offer?.savedAt ?? 0, persianDigits),
              )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => decide(false)}>
            {t("recovery.discard")}
          </Button>
          <Button onClick={() => decide(true)}>{t("recovery.restore")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
