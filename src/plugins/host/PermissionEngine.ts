/**
 * Permission engine (R9.4): manifest-declared, user-consented,
 * runtime-enforced.
 *
 * The flow: a plugin's manifest declares permissions → the install
 * dialog lists each one in PLAIN PERSIAN with what it actually grants
 * → the user consents (or the install aborts) → the granted set feeds
 * the bridge, which checks EVERY SDK call that needs a permission
 * (fail-closed typed errors, AC9.4).
 *
 * Permission set (the spec's five + the pack-14 `scene` seam):
 * - `storage`      — namespaced persistence (KV + own SQLite tables);
 * - `network`      — EXTERNAL fetch only (the app core stays offline);
 * - `projectRead`  — read the plugin's own project-file section;
 * - `projectWrite` — write the plugin's own project-file section;
 * - `datahub`      — the Phase 10 data-hub surface (declared now,
 *   granted now, used later — a future surface does not turn into a
 *   permission retro-shock);
 * - `scene`        — pack-Phase-14: create REAL core objects (text
 *   boxes / auto-layout frames), own plugin links and camera flights
 *   through the tightly-validated `app.scene` surface. The dailynotes
 *   plugin is the reference consumer — its notes are NORMAL text
 *   objects that survive the uninstall (AC14.6).
 *
 * Layering: plain TypeScript — no React/DOM imports.
 */
import type { BridgeRpcError } from "@/plugins/protocol";

/** Every permission id the host understands. */
export type PermissionId =
  | "storage"
  | "network"
  | "projectRead"
  | "projectWrite"
  | "datahub"
  | "scene";

/** The full permission set (validation + the consent dialog). */
export const PERMISSION_IDS: readonly PermissionId[] = [
  "storage",
  "network",
  "projectRead",
  "projectWrite",
  "datahub",
  "scene",
];

/** Plain-Persian description of one permission (the consent dialog). */
export interface PermissionDescription {
  readonly id: PermissionId;
  /** Short Persian title. */
  readonly title: string;
  /** What granting it actually means, in plain language. */
  readonly detail: string;
}

/** The consent dialog's copy for every permission (R9.4). */
export const PERMISSION_DESCRIPTIONS: readonly PermissionDescription[] = [
  {
    id: "storage",
    title: "ذخیره‌سازی اختصاصی",
    detail:
      "افزونه می‌تواند داده‌های خود را در فضای جداگانهٔ خودش ذخیره و بخواند (شامل جدول‌های SQLite مخصوص خودش).",
  },
  {
    id: "network",
    title: "دسترسی به اینترنت",
    detail:
      "افزونه می‌تواند به نشانی‌های بیرونی درخواست بفرستد. خودِ برنامه آفلاین می‌ماند؛ این دسترسی فقط برای همین افزونه است.",
  },
  {
    id: "projectRead",
    title: "خواندن بخش پروژه",
    detail:
      "افزونه می‌تواند بخش اختصاصی خودش را از فایل پروژه بخواند (فقط داده‌های خودش، نه کل پروژه).",
  },
  {
    id: "projectWrite",
    title: "نوشتن در بخش پروژه",
    detail:
      "افزونه می‌تواند بخش اختصاصی خودش را در فایل پروژه ذخیره کند (فقط داده‌های خودش، نه کل پروژه).",
  },
  {
    id: "datahub",
    title: "مرکز داده (فاز ۱۰)",
    detail:
      "افزونه می‌تواند قرارداد دادهٔ خود را ثبت کند یا قراردادهای افزونه‌های دیگر (مثل تقویم و برنامه‌ریز) را بخواند و دنبال کند.",
  },
  {
    id: "scene",
    title: "ساخت در بوم",
    detail:
      "افزونه می‌تواند یادداشت متن و قاب واقعی روی بوم بسازد، پیوند میان اشیاء ثبت کند و دوربین را روی یک شیء پرواز دهد (فقط از طریق سطح کنترل‌شدهٔ بوم؛ ساختار پروژه دست‌نخورده می‌ماند).",
  },
];

/** Maps SDK bridge methods to the permission they require. */
const METHOD_PERMISSIONS: Readonly<Record<string, PermissionId>> = {
  "app.storage.get": "storage",
  "app.storage.set": "storage",
  "app.storage.delete": "storage",
  "app.storage.sql": "storage",
  "app.network.fetch": "network",
  "app.project.read": "projectRead",
  "app.project.write": "projectWrite",
  "app.datahub.provide": "datahub",
  "app.datahub.query": "datahub",
  "app.datahub.subscribe": "datahub",
  "app.datahub.unsubscribe": "datahub",
  "app.datahub.publish": "datahub",
  "app.scene.insertText": "scene",
  "app.scene.insertFrame": "scene",
  "app.scene.addLink": "scene",
  "app.scene.listLinks": "scene",
  "app.scene.removeLinksByOwner": "scene",
  "app.scene.focusObject": "scene",
  "app.scene.notifyInfo": "scene",
};

/**
 * The engine: a per-plugin granted-permission set with fail-closed
 * checks.
 */
export class PermissionEngine {
  private readonly granted: Set<PermissionId>;

  /**
   * @param permissions - the consented permission set (validated
   *        manifest permissions ∩ what the user agreed to).
   */
  public constructor(permissions: readonly PermissionId[]) {
    this.granted = new Set(
      permissions.filter((permission) =>
        (PERMISSION_IDS as readonly string[]).includes(permission),
      ),
    );
  }

  /**
   * @param permission - the permission id.
   * @returns whether it was granted.
   */
  public has(permission: PermissionId): boolean {
    return this.granted.has(permission);
  }

  /**
   * @returns the granted set (the manager's permission chips).
   */
  public list(): readonly PermissionId[] {
    return [...this.granted];
  }

  /**
   * Which permission a bridge method requires (null = none).
   *
   * @param method - the dotted bridge method path.
   * @returns the required permission, or null when the method is
   *          permission-free.
   */
  public static permissionForMethod(method: string): PermissionId | null {
    return METHOD_PERMISSIONS[method] ?? null;
  }

  /**
   * Fail-closed runtime check the bridge calls before dispatching an
   * SDK method (AC9.4: a typed error, never a silent pass).
   *
   * @param method - the dotted bridge method path.
   * @returns null when allowed; otherwise the typed error payload to
   *          answer with.
   */
  public checkMethod(
    method: string,
  ): { code: "permission-denied"; message: string } | null {
    const required = PermissionEngine.permissionForMethod(method);
    if (required === null || this.granted.has(required)) {
      return null;
    }
    const description = PERMISSION_DESCRIPTIONS.find(
      (candidate) => candidate.id === required,
    );
    return {
      code: "permission-denied",
      message:
        `برای این کار مجوز «${description?.title ?? required}» لازم است ` +
        `که به این افزونه داده نشده است.`,
    };
  }
}

/**
 * Narrows an error to the typed bridge shape (the SDK surface's
 * `BridgeRpcError` re-export helper).
 *
 * @param error - anything thrown.
 * @returns the typed error when it is one.
 */
export function asBridgeRpcError(error: unknown): BridgeRpcError | null {
  return error instanceof Error && error.name === "BridgeRpcError"
    ? (error as BridgeRpcError)
    : null;
}
