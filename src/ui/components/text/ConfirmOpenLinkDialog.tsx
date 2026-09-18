"use client";

/**
 * Open-link confirmation (R3B.3): every external open FIRST shows this
 * Persian confirmation naming the URL, then delegates to the OS default
 * browser via `openExternalLink` (Tauri opener plugin / window.open). The
 * app itself never performs network calls — this is the only hand-off.
 *
 * Tagged `data-text-format-ui` so opening it from the link bubble never
 * commits a live text edit session.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Globe } from "lucide-react";
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
import { Services } from "@/App";
import { openExternalLink } from "@/platform/tauri/opener";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";

/**
 * The confirmation dialog (mounted app-wide; visibility is event-driven).
 *
 * @returns the dialog.
 */
export default function ConfirmOpenLinkDialog(): ReactNode {
  const { t } = useTranslation();
  const language = useUiStore((state) => state.language);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const bus = AppContext.getDefault().tryGet(Services.eventBus);
    return bus?.on("ui:open-link-confirmation", ({ url: requested }) => {
      setUrl(requested);
    });
  }, []);

  const confirm = (): void => {
    const target = url;
    setUrl(null);
    if (target !== null) {
      void openExternalLink(target);
    }
  };

  return (
    <Dialog
      open={url !== null}
      onOpenChange={(next) => (next ? undefined : setUrl(null))}
    >
      <DialogContent
        dir={language === "fa" ? "rtl" : "ltr"}
        data-text-format-ui
        className="max-w-md"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="size-4" aria-hidden="true" />
            {t("link.confirmTitle")}
          </DialogTitle>
          <DialogDescription className="pt-1 text-xs leading-relaxed">
            {t("link.confirmBody")}
          </DialogDescription>
        </DialogHeader>
        <p
          dir="ltr"
          className="mx-1 truncate rounded-lg border border-border/60 bg-muted/50 px-3 py-2 font-mono text-xs"
        >
          {url ?? ""}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setUrl(null)}>
            {t("link.confirmCancel")}
          </Button>
          <Button onClick={confirm} autoFocus>
            {t("link.confirmOpen")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
