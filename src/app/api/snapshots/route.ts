import { NextResponse } from "next/server";
import { createSnapshot, listSnapshots } from "@/db/repo";
import { SnapshotCreateBody } from "@/lib/api-schemas";
import { guard } from "../_lib/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return guard(req, {}, async () => {
    const snapshots = await listSnapshots();
    return NextResponse.json({ snapshots });
  });
}

export async function POST(req: Request): Promise<Response> {
  return guard(req, {}, async () => {
    const body = SnapshotCreateBody.parse(await req.json().catch(() => ({})));
    const payload = await createSnapshot(body.note);
    return NextResponse.json(payload);
  });
}
