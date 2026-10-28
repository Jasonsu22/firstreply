import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { merchantUsers } from "@/db/schema";
import { DEMO_OWNER_EMAIL, demoResetAllowed } from "@/lib/demo/seed-store";
import { demoConsoleOpen, startMerchantSession } from "@/lib/merchant-session";

const ALLOWED_NEXT = new Set(["/console", "/console/impact", "/console/cases", "/console/approvals", "/console/disputes", "/console/policies"]);

/**
 * Demo / local only: sign in as the Trailhead owner and redirect into the console.
 * Same gate as demo reset (local, or DEMO_CONSOLE_OPEN / DEMO_RESET_ENABLED).
 */
export async function GET(request: Request) {
  if (!demoResetAllowed() && !demoConsoleOpen()) {
    return NextResponse.redirect(new URL("/console/login", request.url));
  }
  const url = new URL(request.url);
  const next = url.searchParams.get("next") ?? "/console";
  const dest = ALLOWED_NEXT.has(next) ? next : "/console";

  const [user] = await db.select({ id: merchantUsers.id }).from(merchantUsers).where(eq(merchantUsers.email, DEMO_OWNER_EMAIL));
  if (!user) return NextResponse.redirect(new URL("/console/login", request.url));

  await startMerchantSession(user.id);
  return NextResponse.redirect(new URL(dest, request.url));
}
