/// <reference types="vite/client" />
/**
 * Desktop shell entry (Vite + Tauri).
 *
 * The Next.js preview shell (src/app/page.tsx) mounts the very same
 * <AppShell /> component; this entry is used by `vite` when running
 * `bun run tauri:dev` / `bun run tauri:build` on a desktop machine.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Application } from "@/App";
import AppShell from "@/ui/components/AppShell";
import "@/app/globals.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Missing #root element — check index.html");
}

void Application.boot().then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <AppShell />
    </StrictMode>,
  );
});
