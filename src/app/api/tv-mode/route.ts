import { NextResponse } from "next/server";
import { setTvMode } from "@/db/repo";
import { TvModeBody } from "@/lib/api-schemas";
import { guard } from "../_lib/guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return guard(req, {}, async () => {
    const body = TvModeBody.parse(await req.json());
    const payload = await setTvMode(body.mode);
    return NextResponse.json(payload);
  });
}
