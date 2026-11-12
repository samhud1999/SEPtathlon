import { NextResponse } from "next/server";
import { restoreDump } from "@/db/repo";
import { RestoreBody } from "@/lib/api-schemas";
import { guard } from "../_lib/guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return guard(req, {}, async () => {
    const body = RestoreBody.parse(await req.json());
    const payload = await restoreDump(body.dump);
    return NextResponse.json(payload);
  });
}
