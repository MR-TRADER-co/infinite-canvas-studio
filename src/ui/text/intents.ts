"use client";

/**
 * UI-intent emitters (R3B.3/R3B.8): small helpers that let React components
 * ask the app shell to open text-related surfaces (link dialog, find panel,
 * open-link confirmation) through the typed event bus — the same channel
 * the editor's own Ctrl+K / Ctrl+F shortcuts arrive on, so both entry
 * points converge on one handler.
 */
import { AppContext } from "@/AppContext";
import { Services } from "@/App";

/**
 * Asks the shell to open the link dialog (Ctrl+K / toolbar button).
 */
export function requestLinkDialog(): void {
  AppContext.getDefault()
    .tryGet(Services.eventBus)
    ?.emit("ui:link-dialog-requested", { fromSelection: true });
}

/**
 * Asks the shell to open the Find & Replace panel (Ctrl+F / status bar).
 */
export function requestFindPanel(): void {
  AppContext.getDefault()
    .tryGet(Services.eventBus)
    ?.emit("ui:find-requested", { source: "canvas" });
}

/**
 * Asks the shell to show the open-link confirmation (R3B.3: opening a
 * URL always requires an explicit Persian confirmation first).
 *
 * @param url - the URL to open on confirmation.
 */
export function requestOpenLinkConfirmation(url: string): void {
  AppContext.getDefault()
    .tryGet(Services.eventBus)
    ?.emit("ui:open-link-confirmation", { url });
}
