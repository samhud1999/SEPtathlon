import { NextResponse } from "next/server";
import { LoginBody } from "@/lib/api-schemas";
import { adminSetCookie, getAdminPin } from "@/lib/auth";
import { guard, jsonError } from "../_lib/guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return guard(req, { public: true }, async () => {
    const body = LoginBody.parse(await req.json());
    if (body.pin.trim() !== getAdminPin()) {
      return jsonError("Wrong PIN. The Creek denies you.", 401);
    }
    const res = NextResponse.json({ ok: true });
    res.headers.append("Set-Cookie", adminSetCookie());
    return res;
  });
}
