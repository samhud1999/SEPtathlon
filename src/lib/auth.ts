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
  if (cookie && safeEqual(cookie, adminCookieValue())) return true;
  const headerPin = req.headers.get("x-admin-pin");
  if (headerPin && safeEqual(headerPin, getAdminPin())) return true;
  return false;
}

export function unauthorized(): Response {
  return Response.json({ error: "Unauthorised. The Creek denies you." }, { status: 401 });
}

/**
 * Set-Cookie header value for a successful login. `Secure` follows the actual
 * request protocol (Railway terminates TLS and sends x-forwarded-proto), so
 * local/LAN http testing still gets a working cookie.
 */
export function adminSetCookie(req?: Request): string {
  const forwardedHttps = req?.headers.get("x-forwarded-proto")?.includes("https") ?? false;
  const directHttps = req ? new URL(req.url).protocol === "https:" : false;
  const secure = forwardedHttps || directHttps ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${adminCookieValue()}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax${secure}`;
}

export function adminClearCookie(): string {
  return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
