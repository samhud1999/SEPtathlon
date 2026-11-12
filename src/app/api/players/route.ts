import { NextResponse } from "next/server";
import { createPlayer, updatePlayer } from "@/db/repo";
import { PlayerActionBody } from "@/lib/api-schemas";
import { guard } from "../_lib/guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return guard(req, {}, async () => {
    const body = PlayerActionBody.parse(await req.json());
    if (body.action === "create") {
      const payload = await createPlayer({
        name: body.name,
        ...(body.epithet !== undefined ? { epithet: body.epithet } : {}),
      });
      return NextResponse.json(payload);
    }
    const { playerId, action: _action, ...patch } = body;
    const payload = await updatePlayer(playerId, patch);
    return NextResponse.json(payload);
  });
}
