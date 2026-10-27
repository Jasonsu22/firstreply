"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { merchantUsers } from "@/db/schema";
import { checkPassword, demoConsoleOpen, endMerchantSession, startMerchantSession } from "@/lib/merchant-session";

const DEMO_OWNER_EMAIL = "owner@trailhead.test";

// Wrong-password throttle per IP. In memory: fine for the single hackathon instance.
const failures = new Map<string, number[]>();

export type SignInState = { error?: string; email?: string };

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const recent = (failures.get(ip) ?? []).filter((t) => Date.now() - t < 10 * 60_000);
  if (recent.length >= 8) return { error: "Too many attempts. Please wait a few minutes.", email };

  const userId = email && password ? await checkPassword(email, password) : undefined;
  if (!userId) {
    failures.set(ip, [...recent, Date.now()]);
    return { error: "That email and password don't match.", email };
  }
  await startMerchantSession(userId);
  redirect("/console");
}

/** One-click entry to the demo store's console, only when DEMO_CONSOLE_OPEN=true. */
export async function demoSignIn() {
  if (!demoConsoleOpen()) redirect("/console/login");
  const [user] = await db.select({ id: merchantUsers.id }).from(merchantUsers).where(eq(merchantUsers.email, DEMO_OWNER_EMAIL));
  if (!user) redirect("/console/login");
  await startMerchantSession(user.id);
  redirect("/console");
}

export async function signOut() {
  await endMerchantSession();
  redirect("/console/login");
}
