import { NextResponse } from "next/server";
import { defaultBridgeConfig } from "@/lib/serverFs";

/**
 * `GET /api/fs` — availability probe of the local filesystem bridge.
 *
 * The save/load dialogs call this first to decide whether the typed-address
 * flow can run in the web shell (it can when the app is served from the same
 * machine the user addresses). The response advertises the allow-listed
 * roots so the UI can hint at valid addresses.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const config = defaultBridgeConfig();
  return NextResponse.json({
    ok: true,
    roots: config.roots,
    maxBytes: config.maxBytes,
  });
}
