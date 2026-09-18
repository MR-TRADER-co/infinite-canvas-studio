import { NextResponse } from "next/server";
import { readAsset } from "@/lib/serverAssets";

/**
 * `GET /api/assets/read?hash=<sha256>&project=<icb path>&mime=<type>` —
 * loads one asset from the scope chain [sidecar(project), inbox]
 * (فاز M1).
 *
 * The response is content-hashed → served with immutable caching (the
 * browser HTTP cache + the renderer's PosterBitmapCache mean zoom/pan
 * never re-decode). `probe=1` answers existence as JSON instead of the
 * bytes. The content type is sniffed from the payload's magic bytes
 * (poster JPEGs) unless a `mime` override is supplied.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse | Response> {
  const url = new URL(request.url);
  const hash = url.searchParams.get("hash") ?? "";
  const project = url.searchParams.get("project");
  const mime = url.searchParams.get("mime") ?? undefined;
  const probe = url.searchParams.get("probe");
  const result = await readAsset(hash, project, mime);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, code: result.code, error: result.message },
      { status: result.code === "not-found" ? 404 : 400 },
    );
  }
  if (probe === "1") {
    return NextResponse.json({ ok: true, hash });
  }
  return new Response(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Length": String(result.bytes.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
