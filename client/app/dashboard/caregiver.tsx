import type { Session } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { visibleTo } from "@/lib/memories";
import { LogoutButton } from "../logout-button";
import { addMemory } from "./actions";

const STATUS: Record<string, string> = {
  unverified: "Waiting for family",
  verified: "Verified by family",
  superseded: "Updated by family",
  retracted: "Not used",
};
const fmt = (d?: Date | null) => d?.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
const input = "rounded border px-2 py-1";

// Caregivers only add notes. They see what they themselves sent and whether family has checked it, nothing else.
export async function CaregiverView({ me, personName }: { me: Session; personName?: string }) {
  const notes = await (await getDb()).collection("memories")
    .find({ ...visibleTo(me), "source.user_id": me.user_id }, { projection: { text: 1, status: 1, created_at: 1, expires_at: 1 } })
    .sort({ created_at: -1 }).limit(20).toArray();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-4">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Care notes for {personName}</h1>
          <p className="text-sm text-zinc-500">Signed in as {me.name} (caregiver)</p>
        </div>
        <LogoutButton />
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Add a note</h2>
        <p className="text-sm text-zinc-500">Family checks each note before Keepsake treats it as fact.</p>
        <form action={addMemory} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">What should {personName} know?
            <textarea name="text" required rows={3} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">Expires (optional)
            <input name="expires_at" type="datetime-local" className={`${input} self-start`} />
          </label>
          <button className="self-start rounded bg-foreground px-3 py-1 text-background">Add note</button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Your recent notes</h2>
        {notes.length ? (
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <li key={n._id.toString()} className="rounded border p-3">
                <p>{n.text}</p>
                <p className="text-xs text-zinc-500">
                  {STATUS[n.status] ?? n.status} · {fmt(n.created_at)}
                  {n.expires_at && <> · expires {fmt(n.expires_at)}</>}
                </p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-zinc-500">You haven&apos;t added any notes yet.</p>}
      </section>
    </main>
  );
}
