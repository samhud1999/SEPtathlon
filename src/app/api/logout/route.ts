import { NextResponse } from "next/server";
import { adminClearCookie } from "@/lib/auth";
import { guard } from "../_lib/guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return guard(req, { public: true }, async () => {
    const res = NextResponse.json({ ok: true });
    res.headers.append("Set-Cookie", adminClearCookie());
    return res;
  });
}
