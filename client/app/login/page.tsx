"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null);

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <form action={action} className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-3xl font-semibold">Keepsake</h1>
        <label className="flex flex-col gap-1">
          Email
          <input name="email" type="email" autoComplete="email" required className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          Password
          <input name="password" type="password" autoComplete="current-password" required className="rounded border px-3 py-2" />
        </label>
        {error && <p role="alert" className="text-red-600">{error}</p>}
        <button disabled={pending} className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
