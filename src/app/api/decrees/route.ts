import { NextResponse } from "next/server";
import { castDecree, listDecrees } from "@/db/repo";
import { DecreeCreateBody } from "@/lib/api-schemas";
import { guard } from "../_lib/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return guard(req, {}, async () => {
    const decrees = await listDecrees();
    return NextResponse.json({ decrees });
  });
}

export async function POST(req: Request): Promise<Response> {
  return guard(req, {}, async () => {
    const body = DecreeCreateBody.parse(await req.json());
    const payload = await castDecree(body.playerIds, body.pointsDelta, body.sinTag, body.reason);
    return NextResponse.json(payload);
  });
}
