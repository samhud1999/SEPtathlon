import { NextResponse } from "next/server";
import { setEventStatus } from "@/db/repo";
import { EventStatusBody } from "@/lib/api-schemas";
import { guard, parseId } from "../../../_lib/guard";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(req, {}, async () => {
    const { id } = await ctx.params;
    const eventId = parseId(id, "event id");
    const body = EventStatusBody.parse(await req.json());
    const payload = await setEventStatus(eventId, body.status);
    return NextResponse.json(payload);
  });
}
