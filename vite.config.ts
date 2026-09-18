import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * Vite configuration for the Tauri desktop shell.
 *
 * The Next.js preview (port 3000) and this Vite dev server (port 5173, used
 * by `bun run tauri:dev`) mount the SAME React components from `src/` — only
 * the entry differs (`src/app/page.tsx` vs `index.html` → `src/main.tsx`).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri expects a fixed port; fail loudly if it is taken.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Rust toolchain output should not trigger frontend reloads.
      ignored: ['**/src-tauri/**'],
    },
  },
  // Inline (empty) PostCSS config: prevents Vite from auto-loading the
  // project's postcss.config.mjs (owned by the Next.js shell). Tailwind is
  // handled by @tailwindcss/vite above.
  css: {
    postcss: {
      plugins: [],
    },
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
  },
});
