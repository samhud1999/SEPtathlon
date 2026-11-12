import { NextResponse } from "next/server";
import { restoreSnapshot } from "@/db/repo";
import { ConfirmRestore } from "@/lib/api-schemas";
import { guard, parseId } from "../../../_lib/guard";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(req, {}, async () => {
    const { id } = await ctx.params;
    const snapshotId = parseId(id, "snapshot id");
    ConfirmRestore.parse(await req.json());
    const payload = await restoreSnapshot(snapshotId);
    return NextResponse.json(payload);
  });
}
