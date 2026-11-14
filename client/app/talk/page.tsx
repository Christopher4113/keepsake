import { requireSession } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { LogoutButton } from "../logout-button";
import { Voice } from "./voice";

// ponytail: server clock decides the greeting; fine while the demo runs in one timezone.
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

export default async function TalkPage() {
  const me = await requireSession(["person"]);

  return (
    <div
      className="flex min-h-full flex-1 flex-col"
      style={{ background: "radial-gradient(110% 70% at 50% 0%, #f4d3db 0%, #f8e6e8 38%, #fdfaf7 80%)" }}
    >
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo href="/talk" />
        <LogoutButton className="text-base" />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-10 px-4 pb-16 text-center">
        <h1 className="font-serif text-5xl leading-tight sm:text-6xl">
          {greeting()},<br /><em className="text-primary">{me.name}.</em>
        </h1>
        <Voice />
      </main>
    </div>
  );
}
