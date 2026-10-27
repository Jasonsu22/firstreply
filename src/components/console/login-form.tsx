"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState } from "react";
import { demoSignIn, signIn, type SignInState } from "@/app/console/actions";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 dark:border-zinc-700 dark:bg-zinc-950";

export function LoginForm({ demoOpen }: { demoOpen: boolean }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input name="email" type="email" required autoComplete="username" defaultValue={state.email} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input name="password" type="password" required autoComplete="current-password" className={input} />
        </label>
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">{state.error}</p>}
        <button disabled={pending} className="flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 font-medium text-white hover:bg-emerald-800 disabled:opacity-60">
          {pending && <LoaderCircle className="size-4 animate-spin" />} Sign in
        </button>
      </form>
      {demoOpen && (
        <form action={demoSignIn} className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <button className="rounded-lg border border-zinc-300 px-4 py-2.5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
            Open the demo store&apos;s console
          </button>
          <p className="text-center text-xs text-zinc-500">Trailhead Supply Co. · PayPal sandbox, no real money</p>
        </form>
      )}
    </div>
  );
}
