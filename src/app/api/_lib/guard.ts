import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { RepoError } from "@/db/repo";
import { isAdminRequest, unauthorized } from "@/lib/auth";

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Wrap a route handler: optional admin gate + uniform error mapping
 * (RepoError → its status, Zod → 400, bad JSON → 400, unknown → 500).
 */
export async function guard(
  req: Request,
  opts: { public?: boolean },
  fn: () => Promise<Response>,
): Promise<Response> {
  if (!opts.public && !isAdminRequest(req)) return unauthorized();
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RepoError) return jsonError(err.message, err.status);
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      return jsonError(
        issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request",
        400,
      );
    }
    if (err instanceof SyntaxError) return jsonError("Invalid JSON body", 400);
    console.error("[creekos] unhandled route error:", err);
    return jsonError("The Creek has flooded (internal error)", 500);
  }
}

/** Parse the numeric event/entity id segment; throws a 400-shaped RepoError. */
export function parseId(raw: string, what = "id"): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) throw new RepoError(`Invalid ${what}`, 400);
  return n;
}
