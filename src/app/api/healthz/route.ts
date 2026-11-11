// Stub — replaced by the api agent with a DB-touching version (Task 4).
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, version: 0 });
}
