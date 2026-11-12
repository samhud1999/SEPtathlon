import { NextResponse } from "next/server";
import { getStatePayload, getStateVersion } from "@/db/repo";
import { guard } from "../_lib/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return guard(req, { public: true }, async () => {
    const version = await getStateVersion();
    const etag = `W/"v${version}"`;
    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": "no-store" },
      });
    }
    const payload = await getStatePayload();
    return NextResponse.json(payload, {
      headers: { ETag: etag, "Cache-Control": "no-store" },
    });
  });
}
