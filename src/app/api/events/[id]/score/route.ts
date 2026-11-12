import { NextResponse } from "next/server";
import { upsertScores } from "@/db/repo";
import { ScoreBody } from "@/lib/api-schemas";
import { guard, parseId } from "../../../_lib/guard";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(req, {}, async () => {
    const { id } = await ctx.params;
    const eventId = parseId(id, "event id");
    const body = ScoreBody.parse(await req.json());
    const payload = await upsertScores(eventId, body.results, { quiet: body.quiet ?? false });
    return NextResponse.json(payload);
  });
}
