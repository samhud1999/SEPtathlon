import { NextResponse } from "next/server";
import { generateBloodRound } from "@/db/repo";
import { BloodGenerateBody } from "@/lib/api-schemas";
import { guard } from "../../_lib/guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return guard(req, {}, async () => {
    const body = BloodGenerateBody.parse(await req.json());
    const payload = await generateBloodRound(body.roundNumber);
    return NextResponse.json(payload);
  });
}
