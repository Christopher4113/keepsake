import Link from "next/link";
import type { Session } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { LogoutButton } from "../logout-button";

// Header for the family pages, with the Memories / Trace switch.
export function FamilyShell({ me, active, children }: { me: Session; active: "memories" | "trace"; children: React.ReactNode }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn("rounded-full px-3 py-1.5 text-sm transition-colors", on ? "bg-secondary text-primary" : "text-muted-foreground hover:text-foreground")}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Logo href="/dashboard" />
            <nav className="flex gap-1">
              {tab("/dashboard", "Memories", active === "memories")}
              {tab("/trace", "Trace", active === "trace")}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {me.name} · <span className="capitalize">{me.role}</span>
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
