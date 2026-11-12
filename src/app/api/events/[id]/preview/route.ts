import { NextResponse } from "next/server";
import { previewScores } from "@/db/repo";
import { PreviewBody } from "@/lib/api-schemas";
import { guard, parseId } from "../../../_lib/guard";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(req, {}, async () => {
    const { id } = await ctx.params;
    const eventId = parseId(id, "event id");
    const body = PreviewBody.parse(await req.json());
    const standings = await previewScores(eventId, body.results);
    return NextResponse.json({ standings });
  });
}
