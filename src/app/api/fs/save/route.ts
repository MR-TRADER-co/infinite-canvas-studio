import { NextResponse } from "next/server";
import {
  bridgeHttpStatus,
  saveBridgeFile,
  type BridgeFailure,
} from "@/lib/serverFs";

/**
 * `POST /api/fs/save` — writes an `.icb` project payload to a user-typed
 * absolute path through the local filesystem bridge (see `src/lib/serverFs`
 * for the guard policy: allow-listed roots, `.icb` magic, size cap).
 *
 * Request body: `{ "path": string, "contents": string }`.
 * Responses: `200 {ok, path, bytes}` or `4xx/5xx {ok: false, error, message}`.
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
  const { path, contents } = readBody(body);
  if (typeof path !== "string" || typeof contents !== "string") {
    return failure(
      {
        ok: false,
        code: "bad-payload",
        message: "path and contents must be strings",
      },
      400,
    );
  }
  const result = await saveBridgeFile(path, contents);
  if (!result.ok) {
    return failure(result, bridgeHttpStatus(result.code));
  }
  return NextResponse.json({
    ok: true,
    path: result.path,
    bytes: result.bytes,
  });
}

/**
 * Narrows the parsed request body into its two expected fields.
 *
 * @param body - the JSON-parsed request body.
 * @returns the `path` and `contents` fields (possibly undefined).
 */
function readBody(body: unknown): { path?: unknown; contents?: unknown } {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    return { path: record.path, contents: record.contents };
  }
  return {};
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
