import { NextResponse } from "next/server";
import { relocateAssets } from "@/lib/serverAssets";

/**
 * `POST /api/assets/relocate` — moves/copies referenced assets into a
 * project's sidecar (فاز M1 — A.2.1's Save-As hook).
 *
 * Body: `{ from: <previous project path | "inbox" | null>,
 *          to: <new project .icb path>, hashes: string[] }`.
 * Inbox files MOVE (the first Save As); a previous sidecar's files COPY
 * (a later Save As — the old project keeps working). Already-present
 * targets and genuinely missing sources are reported, never fatal.
 */
export const dynamic = "force-dynamic";

interface RelocateRequest {
  readonly from?: unknown;
  readonly to?: unknown;
  readonly hashes?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: RelocateRequest;
  try {
    body = (await request.json()) as RelocateRequest;
  } catch {
    return NextResponse.json(
      { ok: false, code: "bad-payload", error: "the body must be JSON" },
      { status: 400 },
    );
  }
  const to = typeof body.to === "string" ? body.to : "";
  const from =
    body.from === null || body.from === undefined || body.from === "inbox"
      ? null
      : typeof body.from === "string"
        ? body.from
        : "";
  const hashes = Array.isArray(body.hashes)
    ? body.hashes.filter((hash): hash is string => typeof hash === "string")
    : [];
  if (to.length === 0 || (from !== null && from.length === 0)) {
    return NextResponse.json(
      { ok: false, code: "bad-payload", error: "from/to must be paths" },
      { status: 400 },
    );
  }
  const result = await relocateAssets(to, hashes, from);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, code: result.code, error: result.message },
      { status: result.code === "outside-roots" ? 400 : 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    moved: result.moved,
    copied: result.copied,
    missing: result.missing,
  });
}
