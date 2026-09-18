import { NextResponse } from "next/server";
import { ASSET_ROUTE_MAX_BYTES } from "@/lib/serverAssets";
import { defaultBridgeConfig } from "@/lib/serverFs";
import { inboxDirFor } from "@/persistence/assetPaths";

/**
 * `GET /api/assets` — availability probe of the sidecar AssetStore
 * (فاز M1), mirroring `/api/fs`'s posture: the client store uses it to
 * discover the inbox home and the upload ceiling.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    inbox: inboxDirFor(defaultBridgeConfig().roots[0] ?? process.cwd()),
    maxBytes: ASSET_ROUTE_MAX_BYTES,
  });
}
