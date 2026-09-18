import { NextResponse } from "next/server";
import { writeAsset } from "@/lib/serverAssets";

/**
 * `POST /api/assets/write?hash=<sha256>&project=<icb path>` — writes one
 * asset into the requested scope (فاز M1).
 *
 * The raw bytes ride the request body (`application/octet-stream`); the
 * server re-hashes them with node:crypto and REFUSES a mismatch, stores
 * the file under its hash name, and dedupes identical imports (ACM1.4).
 * A missing `project` targets the media inbox (unsaved projects).
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const hash = url.searchParams.get("hash") ?? "";
  const project = url.searchParams.get("project");
  const bytes = Buffer.from(await request.arrayBuffer());
  const result = await writeAsset(hash, bytes, project);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, code: result.code, error: result.message },
      { status: assetStatus(result.code) },
    );
  }
  return NextResponse.json({
    ok: true,
    hash: result.hash,
    path: result.path,
    dedupe: result.dedupe,
  });
}

/**
 * @param code - the failure code.
 * @returns the HTTP status for the failure family.
 */
function assetStatus(code: string): number {
  switch (code) {
    case "bad-hash":
      return 400;
    case "too-large":
    case "hash-mismatch":
      return 413;
    case "outside-roots":
      return 400;
    default:
      return 500;
  }
}
