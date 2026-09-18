"use client";

/**
 * The only user-visible route (`/`): mounts the shared application shell.
 *
 * فاز ۲۸ (quality round): the shell is mounted CLIENT-ONLY. The previous
 * server-rendered markup hydrated with a Radix `useId` tree mismatch (the
 * SSR pass and the client pass disagree on sibling positions inside the
 * toolbar/menu Slot chains — every boot logged a hydration error), and a
 * full-screen canvas editor gains nothing from SSR: Figma-class apps are
 * client applications. The root layout still server-renders `<html>` with
 * `lang="fa" dir="rtl" class="dark"` + the themed `<body>` background, so
 * the first byte is already dark/RTL — no flash, no hydration of the
 * shell at all, and the Tauri desktop entry (`src/main.tsx`) never
 * consulted this route anyway.
 */
import dynamic from "next/dynamic";

/** The shell, loaded client-side (no SSR markup, no hydration). */
const AppShell = dynamic(() => import("@/ui/components/AppShell"), {
  ssr: false,
  loading: () => (
    <div
      className="flex h-dvh w-full items-center justify-center bg-background"
      role="status"
      aria-label="Infinite Canvas Studio"
    >
      <span className="size-3 animate-pulse rounded-full bg-muted-foreground/50" />
    </div>
  ),
});

export default function Page() {
  return <AppShell />;
}
