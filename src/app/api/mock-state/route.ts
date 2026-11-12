import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { guard } from "../_lib/guard";

export const dynamic = "force-dynamic";

/** Dev aid: serves the normative fixture so /tv?mock=1 renders without data. */
export async function GET(req: Request): Promise<Response> {
  return guard(req, { public: true }, async () => {
    const json = await readFile(join(process.cwd(), "fixtures", "sample-state.json"), "utf8");
    return new Response(json, {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  });
}
