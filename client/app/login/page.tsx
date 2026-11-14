"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "./actions";

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null);

  return (
    <main
      className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12"
      style={{ background: "radial-gradient(90% 70% at 50% 0%, #f4d3db 0%, #f8e6e8 40%, #fdfaf7 85%)" }}
    >
      <Logo />
      <Card className="w-full max-w-sm gap-6 rounded-2xl border-0 shadow-[0_24px_60px_-30px_rgba(80,40,50,0.35)]">
        <CardHeader className="text-center">
          <CardTitle className="font-serif text-4xl font-normal">Welcome <em className="text-primary">back</em></CardTitle>
          <CardDescription>Sign in to your family&apos;s Keepsake.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={action} className="flex flex-col gap-5">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required className="h-11" aria-invalid={!!error || undefined} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-11" aria-invalid={!!error || undefined} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button disabled={pending} className="h-11 rounded-full text-[15px]">
              {pending ? <><Loader2 className="animate-spin" /> Signing in…</> : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Button asChild variant="link" className="text-muted-foreground">
        <Link href="/"><ArrowLeft /> Back to Keepsake</Link>
      </Button>
    </main>
  );
}
