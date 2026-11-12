import { NextResponse } from "next/server";
import { getStateVersion } from "@/db/repo";

export const dynamic = "force-dynamic";

/** Railway healthcheck — touches the database so a dead DB fails the check. */
export async function GET(): Promise<Response> {
  try {
    const version = await getStateVersion();
    return NextResponse.json({ ok: true, version });
  } catch (err) {
    console.error("[creekos] healthz failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
