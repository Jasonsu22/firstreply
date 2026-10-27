import { MessageSquareReply } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { LoginForm } from "@/components/console/login-form";
import { demoConsoleOpen, getMerchantSession } from "@/lib/merchant-session";

async function Form() {
  await connection();
  if (await getMerchantSession()) redirect("/console");
  return <LoginForm demoOpen={demoConsoleOpen()} />;
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6 flex items-center gap-2">
          <MessageSquareReply className="size-6 text-emerald-700 dark:text-emerald-400" />
          <div>
            <h1 className="font-semibold">FirstReply console</h1>
            <p className="text-sm text-zinc-500">Sign in to see your store&apos;s cases.</p>
          </div>
        </div>
        <Suspense fallback={<div className="h-48" />}>
          <Form />
        </Suspense>
      </div>
    </main>
  );
}
