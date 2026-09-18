import { NextResponse } from "next/server";
import {
  bridgeHttpStatus,
  loadBridgeFile,
  type BridgeFailure,
} from "@/lib/serverFs";

/**
 * `POST /api/fs/load` — reads an `.icb` project file from a user-typed
 * absolute path through the local filesystem bridge (see `src/lib/serverFs`
 * for the guard policy: allow-listed roots, `.icb` magic, size cap).
 *
 * Request body: `{ "path": string }`.
 * Responses: `200 {ok, path, contents, bytes, modifiedAt}` or
 * `4xx/5xx {ok: false, error, message}` (`not-found` → 404).
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(
      {
        ok: false,
        code: "bad-payload",
        message: "the request body is not JSON",
      },
      400,
    );
  }
  const path =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).path
      : undefined;
  if (typeof path !== "string") {
    return failure(
      { ok: false, code: "bad-payload", message: "path must be a string" },
      400,
    );
  }
  const result = await loadBridgeFile(path);
  if (!result.ok) {
    return failure(result, bridgeHttpStatus(result.code));
  }
  return NextResponse.json({
    ok: true,
    path: result.path,
    contents: result.contents,
    bytes: result.bytes,
    modifiedAt: result.modifiedAt,
  });
}

/**
 * Serialises a bridge failure with its HTTP status.
 *
 * @param failure - the typed bridge failure.
 * @param status - the HTTP status for the failure family.
 * @returns the JSON error response.
 */
function failure(failure: BridgeFailure, status: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: failure.code, message: failure.message },
    { status },
  );
}
