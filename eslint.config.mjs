import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Relaxed defaults for the GENERATED scaffold (shadcn/ui components and
    // scaffold hooks) — not project-authored code, kept on upstream defaults.
    files: ["src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/purity": "off",
      "react-compiler/react-compiler": "off",
      "react/no-unescaped-entities": "off",
      "react/display-name": "off",
      "react/prop-types": "off",
      "@next/next/no-img-element": "off",
    },
  },
  {
    // Plugin UI: icons are tiny bundled SVGs fetched as public assets —
    // next/image optimisation is meaningless for them (and the one
    // intentional <img> warning is gone by turning the rule off here).
    files: [
      "src/ui/components/plugins/**/*.{ts,tsx}",
      "src/ui/components/panels/PluginManagerPanel.tsx",
    ],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  {
    // Strict rules for Infinite Canvas Studio source (CLAUDE.md §1.5).
    // `src/components/ui/**` is the generated shadcn scaffold and stays on
    // the relaxed defaults above; everything we author is held to the bar.
    files: [
      "src/core/**/*.{ts,tsx}",
      "src/rendering/**/*.{ts,tsx}",
      "src/interaction/**/*.{ts,tsx}",
      "src/text/**/*.{ts,tsx}",
      "src/ui/**/*.{ts,tsx}",
      "src/persistence/**/*.{ts,tsx}",
      "src/platform/**/*.{ts,tsx}",
      "src/App.ts",
      "src/AppContext.ts",
      "src/Logger.ts",
      "src/main.tsx",
      "src/app/**/*.{ts,tsx}",
      "tests/**/*.ts",
      "vite.config.ts",
      "vitest.config.ts",
    ],
    rules: {
      // TypeScript — `any` is forbidden (CLAUDE.md §1.5).
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/prefer-as-const": "error",
      // React hooks rules (R0.9).
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // General strictness.
      "prefer-const": "error",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "object-shorthand": "error",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "next-env.d.ts",
      "examples/**",
      "skills/**",
      "download/**",
      "mini-services/**",
      "agent-ctx/**",
      "upload/**",
      ".qa/**",
      "src-tauri/**",
      "phase-changed/**",
      // فاز M2: the VENDORED ffmpeg.wasm core (GPL third-party asset,
      // shipped verbatim — never linted).
      "public/ffmpeg/**",
    ],
  },
];

export default eslintConfig;
