import { exportDump } from "@/db/repo";
import { guard } from "../_lib/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return guard(req, {}, async () => {
    const dump = await exportDump();
    const stamp = dump.exportedAt.replace(/[:.]/g, "-");
    return new Response(JSON.stringify(dump, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="creekos-export-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
