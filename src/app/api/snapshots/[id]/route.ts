import { getSnapshotJson } from "@/db/repo";
import { guard, parseId } from "../../_lib/guard";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(req, {}, async () => {
    const { id } = await ctx.params;
    const snapshotId = parseId(id, "snapshot id");
    const json = await getSnapshotJson(snapshotId);
    return new Response(json, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="creekos-snapshot-${snapshotId}.json"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
