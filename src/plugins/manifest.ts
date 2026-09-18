/**
 * Plugin manifest contract + install-time validation (R9.1).
 *
 * A plugin is a folder (`<appData>/plugins/<id>/` or an installable zip
 * carrying the same layout): `manifest.json` + one entry JS + optional
 * assets + per-language i18n dictionaries.
 *
 * Validation is PURE and total: every failure is a Persian sentence the
 * install dialog surfaces verbatim (the spec demands it — AC9.5/AC9.6).
 * Checks:
 * - structural: object shape, required fields, types;
 * - id scheme: `^[a-z][a-z0-9_-]{1,48}$`, NOT the reserved `core.`
 *   owner (§1.7.2), not `core` itself, no colon (i18n namespace
 *   separator), unique against the installed set;
 * - `version`: strict semver (MAJOR.MINOR.PATCH);
 * - `sdkRange`: `>=X.Y.Z <A.B.C` or `^X.Y.Z`-style caret range over
 *   semver — must intersect the host's supported SDK majors;
 * - `permissions`: every entry a known permission id;
 * - `dependencies`: resolvable ids of already-installed plugins (the
 *   host resolves them against its store, newer versions satisfying
 *   `>=` ranges);
 * - `entry`: a JS path inside the package (no `..`, no absolute path,
 *   no leading slash).
 *
 * Layering: plain TypeScript — no React/DOM/Tauri imports.
 */
import type { PermissionId } from "@/plugins/host/PermissionEngine";

/** The manifest of one plugin package. */
export interface PluginManifest {
  /** Unique plugin id (the owner namespace, §1.7.2). */
  readonly id: string;
  /** Human-readable display name (any script; shown in the manager). */
  readonly name: string;
  /** Strict semver version of THIS package. */
  readonly version: string;
  /** Acceptable host-SDK versions (semver range notation). */
  readonly sdkRange: string;
  /** Requested permissions (subset of the known set, R9.4). */
  readonly permissions: readonly PermissionId[];
  /** Ids of plugins this one depends on (`id@>=semver` strings). */
  readonly dependencies: readonly string[];
  /** Entry JS path inside the package (e.g. `entry.js`). */
  readonly entry: string;
  /** Optional icon path inside the package (an SVG/PNG asset). */
  readonly icon?: string;
  /** Optional short description (manager list). */
  readonly description?: string;
}

/** The SDK majors this host supports (shims per major, R9.3). */
export const SUPPORTED_SDK_MAJORS: readonly number[] = [1];

/** An install-time validation failure (a Persian sentence). */
export interface ManifestError {
  /** Field the error blames (diagnostics). */
  readonly field: string;
  /** The Persian message shown in the install dialog. */
  readonly message: string;
}

/** Semver triple. */
interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const ID_PATTERN = /^[a-z][a-z0-9_-]{1,48}$/;

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;

/**
 * Parses a strict semver string.
 *
 * @param raw - the candidate.
 * @returns the triple, or null when malformed.
 */
export function parseSemVer(raw: string): SemVer | null {
  const match = SEMVER_PATTERN.exec(raw.trim());
  if (match === null) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Compares two semver triples.
 *
 * @returns negative when a < b, 0 when equal, positive when a > b.
 */
export function compareSemVer(a: SemVer, b: SemVer): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** The parsed bounds of one sdkRange clause. */
interface SdkRange {
  /** Lowest acceptable version (inclusive). */
  readonly min: SemVer;
  /** Highest acceptable version (exclusive). */
  readonly maxExclusive: SemVer;
}

const RANGE_LOOSE_PATTERN = /^\s*>=\s*(\S+)\s+<\s*(\S+)\s*$/;
const RANGE_CARET_PATTERN = /^\s*\^\s*(\S+)\s*$/;

/**
 * Parses an sdkRange clause into exclusive bounds.
 *
 * Supported notations:
 * - `>=1.0.0 <2.0.0` (explicit interval);
 * - `^1.2.3` → `>=1.2.3 <2.0.0` (same-major compatibility, the usual
 *   choice; `^0.x.y` pins the minor: `>=0.x.y <0.(x+1).0`).
 *
 * @param raw - the range string from the manifest.
 * @returns the bounds, or null when the notation is unknown.
 */
export function parseSdkRange(raw: string): SdkRange | null {
  const loose = RANGE_LOOSE_PATTERN.exec(raw);
  if (loose !== null) {
    const min = parseSemVer(loose[1] ?? "");
    const max = parseSemVer(loose[2] ?? "");
    if (min === null || max === null) {
      return null;
    }
    return { min, maxExclusive: max };
  }
  const caret = RANGE_CARET_PATTERN.exec(raw);
  if (caret !== null) {
    const base = parseSemVer(caret[1] ?? "");
    if (base === null) {
      return null;
    }
    const maxExclusive: SemVer =
      base.major === 0
        ? { major: 0, minor: base.minor + 1, patch: 0 }
        : { major: base.major + 1, minor: 0, patch: 0 };
    return { min: base, maxExclusive };
  }
  return null;
}

/**
 * Whether the sdkRange intersects ANY host-supported SDK major (the
 * negotiation input, AC9.6).
 *
 * @param raw - the range string.
 * @returns the supported majors the range covers (possibly empty).
 */
export function sdkRangeSupportedMajors(raw: string): number[] {
  const range = parseSdkRange(raw);
  if (range === null) {
    return [];
  }
  return SUPPORTED_SDK_MAJORS.filter(
    (major) =>
      compareSemVer(range.maxExclusive, {
        major,
        minor: 0,
        patch: 0,
      }) > 0 &&
      compareSemVer(range.min, {
        major: major + 1,
        minor: 0,
        patch: 0,
      }) < 0,
  );
}

/** The id+range shape of one dependency clause (`id@>=1.0.0`). */
export interface DependencyClause {
  readonly id: string;
  readonly range: SdkRange | null;
  readonly raw: string;
}

/**
 * Parses one dependency clause.
 *
 * @param raw - the clause (`id` or `id@>=1.0.0 <2.0.0` — the range uses
 *        the same notation as sdkRange).
 * @returns the parsed clause (range null when malformed or absent).
 */
export function parseDependency(raw: string): DependencyClause {
  const at = raw.indexOf("@");
  if (at <= 0) {
    return { id: raw.trim(), range: null, raw };
  }
  const id = raw.slice(0, at).trim();
  const range = parseSdkRange(raw.slice(at + 1));
  return { id, range, raw };
}

/** Context the manifest needs about the already-installed world. */
export interface ManifestValidationContext {
  /** Ids of plugins already installed (uniqueness, AC9.5). */
  readonly installedIds: readonly string[];
  /** Version lookup of installed plugins (dependency resolution). */
  readonly installedVersions: Readonly<Record<string, string>>;
}

/**
 * Validates one plugin manifest at install time (R9.1 — every error a
 * Persian sentence).
 *
 * @param candidate - the parsed JSON of `manifest.json`.
 * @param context - the installed world.
 * @returns every failure found (empty = the manifest is acceptable).
 */
export function validateManifest(
  candidate: unknown,
  context: ManifestValidationContext,
): ManifestError[] {
  const errors: ManifestError[] = [];
  if (typeof candidate !== "object" || candidate === null) {
    return [
      {
        field: "manifest",
        message: "فایل manifest.json باید یک شیء JSON معتبر باشد.",
      },
    ];
  }
  const raw = candidate as Record<string, unknown>;

  // --- id ---
  const id = raw.id;
  if (typeof id !== "string" || ID_PATTERN.test(id) === false) {
    errors.push({
      field: "id",
      message:
        "شناسهٔ افزونه باید با حرف انگلیسی کوچک شروع شود و فقط شامل حروف کوچک، رقم، خط تیره و زیرخط باشد (۲ تا ۴۹ نویسه).",
    });
  } else if (id === "core" || id.startsWith("core.")) {
    errors.push({
      field: "id",
      message:
        "شناسهٔ «core» برای خود برنامه رزرو شده است؛ افزونه باید شناسهٔ متفاوتی داشته باشد.",
    });
  } else if (id.includes(":")) {
    errors.push({
      field: "id",
      message: "شناسهٔ افزونه نباید شامل دونقطه «:» باشد.",
    });
  } else if (context.installedIds.includes(id)) {
    errors.push({
      field: "id",
      message: `افزونه‌ای با شناسهٔ «${id}» از قبل نصب شده است؛ شناسه‌ها باید یکتا باشند.`,
    });
  }

  // --- name ---
  const name = raw.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    errors.push({
      field: "name",
      message: "نام افزونه (name) نباید خالی باشد.",
    });
  }

  // --- version ---
  const version = raw.version;
  if (typeof version !== "string" || parseSemVer(version) === null) {
    errors.push({
      field: "version",
      message: `نسخهٔ افزونه باید در قالب semver معتبر باشد (مثل ۱٫۲٫۰) — مقدار فعلی نامعتبر است.`,
    });
  }

  // --- sdkRange ---
  const sdkRange = raw.sdkRange;
  if (typeof sdkRange !== "string") {
    errors.push({
      field: "sdkRange",
      message:
        "بازهٔ نسخهٔ SDK (sdkRange) باید رشته‌ای در قالب «^۱٫۰٫۰» یا «>=۱٫۰٫۰ <۲٫۰٫۰» باشد.",
    });
  } else if (sdkRangeSupportedMajors(sdkRange).length === 0) {
    const supported = SUPPORTED_SDK_MAJORS.join("، ");
    errors.push({
      field: "sdkRange",
      message: `این افزونه با نسخه‌های SDK پشتیبانی‌شدهٔ برنامه سازگار نیست (نسخه‌های پشتیبانی‌شده: ${supported}).`,
    });
  }

  // --- permissions ---
  const permissions = raw.permissions;
  if (permissions === undefined) {
    // Absent = none requested (valid).
  } else if (!Array.isArray(permissions)) {
    errors.push({
      field: "permissions",
      message: "فهرست مجوزها (permissions) باید آرایه‌ای از رشته‌ها باشد.",
    });
  } else {
    const known = knownPermissionIds();
    for (const permission of permissions) {
      if (typeof permission !== "string" || !known.includes(permission)) {
        errors.push({
          field: "permissions",
          message: `مجوز «${String(permission)}» شناخته نمی‌شود؛ مجوزهای معتبر: ${known.join("، ")}.`,
        });
      }
    }
  }

  // --- dependencies ---
  const dependencies = raw.dependencies;
  if (dependencies === undefined) {
    // Absent = no dependencies (valid).
  } else if (!Array.isArray(dependencies)) {
    errors.push({
      field: "dependencies",
      message: "وابستگی‌ها (dependencies) باید آرایه‌ای از رشته‌ها باشند.",
    });
  } else {
    for (const clause of dependencies) {
      if (typeof clause !== "string") {
        errors.push({
          field: "dependencies",
          message: "هر وابستگی باید رشته‌ای در قالب «شناسه@>=نسخه» باشد.",
        });
        continue;
      }
      const parsed = parseDependency(clause);
      if (parsed.range === null && clause.includes("@")) {
        errors.push({
          field: "dependencies",
          message: `بازهٔ نسخهٔ وابستگی «${clause}» نامعتبر است.`,
        });
      }
      const installedVersion = context.installedVersions[parsed.id];
      if (installedVersion === undefined) {
        errors.push({
          field: "dependencies",
          message: `وابستگی «${parsed.id}» نصب نیست؛ ابتدا آن افزونه را نصب کنید.`,
        });
        continue;
      }
      if (parsed.range !== null) {
        const installed = parseSemVer(installedVersion);
        if (
          installed !== null &&
          (compareSemVer(installed, parsed.range.min) < 0 ||
            compareSemVer(installed, parsed.range.maxExclusive) >= 0)
        ) {
          errors.push({
            field: "dependencies",
            message: `نسخهٔ نصب‌شدهٔ «${parsed.id}» (${installedVersion}) با بازهٔ موردنیاز «${parsed.raw}» سازگار نیست.`,
          });
        }
      }
    }
  }

  // --- entry ---
  const entry = raw.entry;
  if (typeof entry !== "string" || entry.length === 0) {
    errors.push({
      field: "entry",
      message: "مسیر فایل ورودی (entry) الزامی است (مثلاً entry.js).",
    });
  } else if (
    entry.startsWith("/") ||
    entry.includes("..") ||
    /^[a-zA-Z]:[\\/]/.test(entry)
  ) {
    errors.push({
      field: "entry",
      message: "مسیر فایل ورودی (entry) باید نسبی و داخل بستهٔ افزونه باشد.",
    });
  }

  // --- icon (optional) ---
  const icon = raw.icon;
  if (
    icon !== undefined &&
    (typeof icon !== "string" || icon.startsWith("/") || icon.includes(".."))
  ) {
    errors.push({
      field: "icon",
      message: "مسیر نماد (icon) باید نسبی و داخل بستهٔ افزونه باشد.",
    });
  }

  return errors;
}

/**
 * Normalises a validated manifest into the typed contract.
 *
 * @param candidate - the validated JSON object.
 * @returns the typed manifest (missing optionals defaulted).
 */
export function normaliseManifest(candidate: unknown): PluginManifest {
  const raw = candidate as Record<string, unknown>;
  return {
    id: String(raw.id),
    name: String(raw.name),
    version: String(raw.version),
    sdkRange: String(raw.sdkRange),
    permissions: Array.isArray(raw.permissions)
      ? (raw.permissions as PermissionId[])
      : [],
    dependencies: Array.isArray(raw.dependencies)
      ? (raw.dependencies as string[])
      : [],
    entry: String(raw.entry),
    icon: typeof raw.icon === "string" ? raw.icon : undefined,
    description:
      typeof raw.description === "string" ? raw.description : undefined,
  };
}

/**
 * Local copy of the known permission ids (avoids a runtime import cycle:
 * PermissionEngine imports this module's types).
 *
 * @returns the permission ids the host understands.
 */
function knownPermissionIds(): string[] {
  // Pack-14: the `scene` seam (REAL core objects + own links + camera
  // flights) joins the valid set — mirrors PermissionEngine exactly.
  return [
    "storage",
    "network",
    "projectRead",
    "projectWrite",
    "datahub",
    "scene",
  ];
}
