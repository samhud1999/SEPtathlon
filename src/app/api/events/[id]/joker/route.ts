import { NextResponse } from "next/server";
import { getStatePayload, setJoker } from "@/db/repo";
import { JokerBody } from "@/lib/api-schemas";
import { guard, jsonError, parseId } from "../../../_lib/guard";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(req, {}, async () => {
    const { id } = await ctx.params;
    const eventId = parseId(id, "event id");
    const body = JokerBody.parse(await req.json());

    if (body.active) {
      const payload = await setJoker(body.playerId, eventId, body.force ?? false);
      return NextResponse.json(payload);
    }

    // Deactivating: only clears if the joker currently sits on THIS event.
    const current = await getStatePayload();
    const player = current.players.find((p) => p.id === body.playerId);
    if (!player) return jsonError(`Player ${body.playerId} not found`, 404);
    if (player.jokerEventId === eventId) {
      const payload = await setJoker(body.playerId, null, false);
      return NextResponse.json(payload);
    }
    return NextResponse.json(current);
  });
}
