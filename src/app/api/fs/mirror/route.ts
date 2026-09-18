import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

/**
 * `POST /api/fs/mirror` — the one-way Markdown mirror (R13.1, AC13.2):
 * writes a FOLDER of `.md` files (the MarkdownExporter output) under
 * `<project>.icb.md/` next to the saved project file.
 *
 * The mirror is strictly ONE-WAY: this route only WRITES; editing a
 * mirror file never feeds back into the app (the `.icb` stays the source
 * of truth — the settings notice documents this).
 *
 * Request body: `{ "path": string, "files": [{path, content}] }` — the
 * folder path plus the per-file set (paths are relative, `.md` only).
 * Responses: `200 {ok, path, files}` or `4xx/5xx {ok: false, error}`.
 */

/** Allow-listed roots (the save bridge's own policy). */
function allowedRoots(): readonly string[] {
  return [tmpdir(), homedir(), process.cwd()]
    .map((root) => resolve(root))
    .filter((root, index, all) => all.indexOf(root) === index);
}

/** POST handler — see the module doc. */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad-payload" },
      { status: 400 },
    );
  }
  const record = body as Record<string, unknown>;
  const folderPath = record.path;
  const files = record.files;
  if (
    typeof folderPath !== "string" ||
    folderPath === "" ||
    !Array.isArray(files) ||
    files.length === 0 ||
    files.length > 5000
  ) {
    return NextResponse.json(
      { ok: false, error: "bad-payload" },
      { status: 400 },
    );
  }

  // Guard the folder path with the save bridge's ROOT policy (allow-
  // listed roots only — never an arbitrary write).
  const canonical = resolve(folderPath);
  const insideRoot = allowedRoots().some(
    (root) => canonical === root || canonical.startsWith(root + "/"),
  );
  if (!insideRoot) {
    return NextResponse.json(
      { ok: false, error: "outside-roots" },
      { status: 403 },
    );
  }

  // Validate every entry: a relative `.md` path with string content.
  const entries: Array<{ path: string; content: string }> = [];
  for (const raw of files) {
    const entry = raw as Record<string, unknown>;
    if (
      typeof entry.path !== "string" ||
      typeof entry.content !== "string" ||
      entry.path === "" ||
      entry.path.includes("..") ||
      entry.path.startsWith("/") ||
      !entry.path.endsWith(".md") ||
      entry.content.length > 2_000_000
    ) {
      return NextResponse.json(
        { ok: false, error: "bad-file" },
        { status: 400 },
      );
    }
    entries.push({ path: entry.path, content: entry.content });
  }

  try {
    for (const entry of entries) {
      const target = join(canonical, entry.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.content, "utf8");
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "write-failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    path: canonical,
    files: entries.length,
  });
}
