"use client";

/**
 * Transient notice toasts (R6.6): listens for `ui:notice` events on the
 * app bus (raised by the rich-text editor service and future producers)
 * and stacks auto-dismissing pills bottom-centre, above the status bar.
 * The text is resolved through i18n; an unknown key renders verbatim (a
 * graceful degradation for producer typos).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { useTranslation, type TranslationKey } from "@/ui/i18n";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import { cn } from "@/lib/utils";

/** How long a toast stays on screen (ms). */
const TOAST_LIFETIME_MS = 4200;

/** One live toast entry. */
interface ToastEntry {
  /** Unique id (event order). */
  readonly id: number;
  /** Resolved text. */
  readonly text: string;
  /** Severity → icon + accent. */
  readonly severity: "info" | "error";
}

/** Monotonic id source for toasts. */
let nextToastId = 0;

/**
 * Substitutes `{name}` slots with the provided values (R3B.8 toasts carry
 * replacement counts; unknown slots stay verbatim).
 *
 * @param text - the translated template.
 * @param values - the placeholder values, or undefined.
 * @returns the interpolated text.
 */
function interpolate(
  text: string,
  values?: Readonly<Record<string, string>>,
): string {
  if (values === undefined) {
    return text;
  }
  return text.replace(
    /\{(\w+)\}/g,
    (slot, name: string) => values[name] ?? slot,
  );
}

/**
 * @returns the toast stack (empty most of the time).
 */
export default function NoticeToasts(): ReactNode {
  const { t, language } = useTranslation();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const bus = AppContext.getDefault().tryGet(Services.eventBus);
    if (bus === undefined) {
      return;
    }
    const unsubscribe = bus.on(
      "ui:notice",
      ({ messageKey, severity, values }) => {
        const text = interpolate(t(messageKey as TranslationKey), values);
        const id = nextToastId;
        nextToastId += 1;
        setToasts((previous) => [
          ...previous.slice(-2),
          { id, text, severity },
        ]);
        const timer = window.setTimeout(() => {
          setToasts((previous) => previous.filter((toast) => toast.id !== id));
        }, TOAST_LIFETIME_MS);
        timers.current.push(timer);
      },
    );
    return () => {
      unsubscribe();
      for (const timer of timers.current) {
        window.clearTimeout(timer);
      }
      timers.current = [];
    };
    // The translator is stable; language switches re-resolve on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      dir={language === "fa" ? "rtl" : "ltr"}
      aria-live="polite"
      className="pointer-events-none fixed bottom-14 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-1.5"
    >
      {toasts.map((toast) => {
        const Icon = toast.severity === "error" ? AlertTriangle : Info;
        return (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "flex max-w-[min(92vw,32rem)] items-center gap-2 rounded-xl border px-3 py-2",
              "text-[13px] shadow-2xl shadow-black/40 backdrop-blur-xl",
              "animate-[panel-pop-in_0.2s_cubic-bezier(0.22,1,0.36,1)_both]",
              toast.severity === "error"
                ? "border-destructive/40 bg-destructive/10 text-foreground"
                : "border-border/60 bg-background/90 text-foreground",
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0",
                toast.severity === "error"
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            />
            <span className="text-foreground/90">{toast.text}</span>
          </div>
        );
      })}
    </div>
  );
}
