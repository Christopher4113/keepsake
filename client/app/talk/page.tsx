import { requireSession } from "@/lib/auth";
import { LogoutButton } from "../logout-button";

export default async function TalkPage() {
  const me = await requireSession(["person"]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-4">
      <h1 className="text-4xl font-semibold">Hello, {me.name}</h1>
      {/* ElevenLabs voice agent goes here */}
      <LogoutButton />
    </main>
  );
}
