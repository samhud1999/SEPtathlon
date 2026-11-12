import type { Metadata } from "next";
import { cookies } from "next/headers";
import { isValidAdminCookie } from "@/lib/auth";
import { ADMIN_COOKIE } from "@/lib/constants";
import AdminApp from "./AdminApp";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CreekOS — Commissioner",
  description: "The Commissioner's Wand: mobile admin portal for the SEPtathlon.",
};

/**
 * Server-side auth gate: a valid `creekos_admin` cookie renders the portal,
 * anything else drops to the PIN form (auto-submitting `?pin=` if present).
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(ADMIN_COOKIE)?.value ?? null;
  if (isValidAdminCookie(cookie)) {
    return <AdminApp />;
  }

  const params = await searchParams;
  const raw = params["pin"];
  const pin = typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? null) : null;
  return <LoginForm pinFromUrl={pin} />;
}
