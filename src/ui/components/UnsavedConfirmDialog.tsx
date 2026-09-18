"use client";

/**
 * Unsaved-changes confirm dialog (R4.5): guards the New/Open flows AND
 * the window close. When the document is dirty, the Persian dialog
 * offers «ذخیره و ادامه» (save, then proceed), «بدون ذخیره ادامه بده»
 * (discard, proceed) and «انصراف» (stay).
 *
 * Every flow is bus-driven (one funnel, consistent layering): the guard
 * emits `ui:unsaved-confirm-requested` with the action (`new`, `open`,
 * `close`); the decision flows back through `ui:unsaved-confirm-resolved`
 * where the composition root runs new/open actions and the close guard
 * finishes the close.
 */
import { useEffect, useState, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
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
import type { UnsavedConfirmRequestedEvent } from "@/core/events/EventBus";

/** The unsaved-changes confirmation dialog (event-driven visibility). */
export default function UnsavedConfirmDialog(): ReactNode {
  const { t } = useTranslation();
  const language = useUiStore((state) => state.language);
  const [action, setAction] = useState<
    UnsavedConfirmRequestedEvent["action"] | "close" | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const install = (): void => {
      const bus = AppContext.getDefault().tryGet(Services.eventBus);
      if (bus !== undefined) {
        unsubscribe = bus.on(
          "ui:unsaved-confirm-requested",
          ({ action: requested }) => {
            if (!cancelled) {
              setAction(requested);
            }
          },
        );
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

  /** Applies one decision for the currently open variant. */
  const decide = (decision: "save" | "discard" | "cancel"): void => {
    const current = action;
    setAction(null);
    if (current !== null) {
      AppContext.getDefault()
        .tryGet(Services.eventBus)
        ?.emit("ui:unsaved-confirm-resolved", { action: current, decision });
    }
  };

  const isClose = action === "close";
  return (
    <Dialog
      open={action !== null}
      onOpenChange={(next) => (next ? undefined : decide("cancel"))}
    >
      <DialogContent
        dir={language === "fa" ? "rtl" : "ltr"}
        className="max-w-md"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4" aria-hidden="true" />
            {isClose ? t("unsaved.closeTitle") : t("unsaved.title")}
          </DialogTitle>
          <DialogDescription className="pt-1 text-xs leading-relaxed">
            {isClose ? t("unsaved.closeBody") : t("unsaved.body")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => decide("cancel")}>
            {t("unsaved.cancel")}
          </Button>
          <Button variant="destructive" onClick={() => decide("discard")}>
            {t("unsaved.discard")}
          </Button>
          <Button onClick={() => decide("save")}>{t("unsaved.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
