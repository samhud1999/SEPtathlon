import { NextResponse } from "next/server";
import { deleteBloodMatchup, patchBloodMatchup } from "@/db/repo";
import { BloodPatchBody } from "@/lib/api-schemas";
import { guard, parseId } from "../../../_lib/guard";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(req, {}, async () => {
    const { id } = await ctx.params;
    const matchupId = parseId(id, "matchup id");
    const body = BloodPatchBody.parse(await req.json());
    const payload = await patchBloodMatchup(matchupId, body);
    return NextResponse.json(payload);
  });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(req, {}, async () => {
    const { id } = await ctx.params;
    const matchupId = parseId(id, "matchup id");
    const payload = await deleteBloodMatchup(matchupId);
    return NextResponse.json(payload);
  });
}
