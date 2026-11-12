import { NextResponse } from "next/server";
import { createBloodMatchup, listBloodMatchups } from "@/db/repo";
import { BloodCreateBody } from "@/lib/api-schemas";
import { guard } from "../../_lib/guard";

export const dynamic = "force-dynamic";

/** Commissioner view — includes unrevealed cards. Never expose to /tv. */
export async function GET(req: Request): Promise<Response> {
  return guard(req, {}, async () => {
    const matchups = await listBloodMatchups();
    return NextResponse.json({ matchups });
  });
}

export async function POST(req: Request): Promise<Response> {
  return guard(req, {}, async () => {
    const body = BloodCreateBody.parse(await req.json());
    const payload = await createBloodMatchup(body);
    return NextResponse.json(payload);
  });
}
