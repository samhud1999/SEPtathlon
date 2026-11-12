import { createHash, timingSafeEqual } from "node:crypto";
import { ADMIN_COOKIE } from "./constants";

export function getAdminPin(): string {
  const pin = process.env.ADMIN_PIN?.trim();
  return pin && pin.length > 0 ? pin : "2026";
}

/** Value stored in the `creekos_admin` cookie. */
export function adminCookieValue(): string {
  return createHash("sha256").update(`creekos|${getAdminPin()}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function cookieFromHeader(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Cookie `creekos_admin` (browser) or `x-admin-pin` header (scripts). */
export function isAdminRequest(req: Request): boolean {
  const cookie = cookieFromHeader(req.headers.get("cookie"), ADMIN_COOKIE);
  if (isValidAdminCookie(cookie)) return true;
  const headerPin = req.headers.get("x-admin-pin");
  if (headerPin && safeEqual(headerPin, getAdminPin())) return true;
  return false;
}

export function unauthorized(): Response {
  return Response.json({ error: "Unauthorised. The Creek denies you." }, { status: 401 });
}

/**
 * Effective request protocol. x-forwarded-proto can be a comma list after
 * multiple hops; the CLIENT's protocol is the first token (a substring match
 * would mark an http client as https and the browser would then reject the
 * Secure cookie — an invisible login loop).
 */
export function isHttpsRequest(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]?.trim().toLowerCase() === "https";
  return new URL(req.url).protocol === "https:";
}

/**
 * Set-Cookie header value for a successful login. `Secure` follows the
 * request's effective protocol: Railway terminates TLS and sends
 * x-forwarded-proto=https, so production cookies are Secure there, while
 * local/LAN http testing still gets a working cookie. Deliberate trade for
 * party-grade auth: an http deployment gets a cookie that works instead of a
 * silent login loop (see README's word of warning).
 */
export function adminSetCookie(req: Request): string {
  const secure = isHttpsRequest(req) ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${adminCookieValue()}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax${secure}`;
}

/** Constant-time check of a cookie value — use anywhere the gate is checked. */
export function isValidAdminCookie(value: string | null | undefined): boolean {
  return value != null && safeEqual(value, adminCookieValue());
}

export function adminClearCookie(): string {
  return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
