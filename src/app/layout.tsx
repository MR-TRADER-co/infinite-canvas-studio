import type { Metadata } from "next";
import "./globals.css";

/**
 * Root layout of the Next.js preview shell.
 *
 * The product defaults are applied here so the very first byte of SSR markup
 * is already RTL, Persian and dark (matching the Zustand UI-store defaults):
 * no hydration flash, no network fonts — Vazirmatn is bundled locally and
 * wired up via `src/ui/theme/fonts.css` (imported from globals.css).
 */
export const metadata: Metadata = {
  title: "Infinite Canvas Studio",
  description:
    "استودیو بوم بی‌نهایت — بوم نقاشی آفلاین با پشتیبانی کامل فارسی و راست‌به‌چپ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground font-sans">
        {children}
      </body>
    </html>
  );
}
