import type { WithId, Document, ObjectId } from "mongodb";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { SCOPES, visibleTo } from "@/lib/memories";
import { LogoutButton } from "../logout-button";
import { ConfirmButton } from "./confirm-button";
import { addMemory, correctMemory, denyMemory, forgetMemory, saveGuidance, verifyMemory } from "./actions";

const VERBS: Record<string, string> = {
  write: "added", verify: "verified", approve: "approved", deny: "denied",
  correct: "corrected", forget: "forgot", expire: "expired", rescope: "rescoped",
};
const fmt = (d?: Date | null) => d?.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
const btn = "rounded border px-2 py-1 text-sm";
const input = "rounded border px-2 py-1";

export default async function DashboardPage() {
  const me = await requireSession(["family", "caregiver"]);
  const db = await getDb();
  const live = { ...visibleTo(me), status: { $in: ["unverified", "verified"] } };

  const [household, memories, guidance, activity] = await Promise.all([
    db.collection("households").findOne({ person_id: me.person_id }),
    db.collection("memories").find(live, { projection: { embedding: 0 } }).sort({ created_at: -1 }).toArray(),
    db.collection("topic_guidance").find({ person_id: me.person_id }).sort({ topic: 1 }).toArray(),
    db.collection("audit_log").find({ person_id: me.person_id, scope: { $in: SCOPES[me.role] } }).sort({ at: -1 }).limit(20).toArray(),
  ]);

  const team: { user_id: string; name: string; role: string; relation?: string }[] = household?.members ?? [];
  const names = Object.fromEntries(team.map((p) => [p.user_id, p.name]));
  const person = team.find((p) => p.role === "person");
  const review = memories.filter((m) => m.status === "unverified" || m.flagged);
  const verified = memories.filter((m) => !review.includes(m));

  // Texts for review candidates, through the same visibility filter so nothing leaks via a candidate link.
  const candidateIds = review.flatMap((m) => (m.review?.candidates ?? []).map((c: { memory_id: ObjectId }) => c.memory_id));
  const candidates = candidateIds.length
    ? await db.collection("memories").find({ _id: { $in: candidateIds }, ...visibleTo(me) }, { projection: { text: 1 } }).toArray()
    : [];
  const textOf = Object.fromEntries(candidates.map((c) => [c._id.toString(), c.text]));

  const Memory = ({ m }: { m: WithId<Document> }) => {
    const id = m._id.toString();
    const inReview = review.includes(m);
    const replaces = m.review?.proposed_supersedes && textOf[m.review.proposed_supersedes.toString()];
    const related = (m.review?.candidates ?? [])
      .filter((c: { label: string; memory_id: ObjectId }) => c.label === "related" && textOf[c.memory_id.toString()])
      .map((c: { memory_id: ObjectId }) => textOf[c.memory_id.toString()]);

    return (
      <li className="flex flex-col gap-2 rounded border p-3">
        <p>{m.text}</p>
        {replaces && <p className="text-sm">Would replace: <span className="line-through">{replaces}</span></p>}
        {related.map((t: string) => <p key={t} className="text-sm text-zinc-600">Related: {t}</p>)}
        <p className="text-xs text-zinc-500">
          {m.scope} · from {names[m.source.user_id] ?? m.source.user_id} · {fmt(m.created_at)}
          {m.expires_at && <> · expires {fmt(m.expires_at)}</>}
          {m.supersedes && <> · corrected</>}
        </p>
        <div className="flex flex-wrap items-start gap-2">
          {inReview && (
            <>
              <form action={verifyMemory}>
                <input type="hidden" name="id" value={id} />
                <button className={btn}>{replaces ? "Approve and replace" : "Approve"}</button>
              </form>
              <form action={denyMemory}>
                <input type="hidden" name="id" value={id} />
                <button className={btn}>Deny</button>
              </form>
            </>
          )}
          <details>
            <summary className={`${btn} cursor-pointer list-none`}>Correct</summary>
            <form action={correctMemory} className="mt-2 flex gap-2">
              <input type="hidden" name="id" value={id} />
              <input name="text" defaultValue={m.text} required aria-label="Corrected text" className={`${input} w-80`} />
              <button className={btn}>Save</button>
            </form>
          </details>
          <form action={forgetMemory}>
            <input type="hidden" name="id" value={id} />
            <ConfirmButton message="Forget this memory? This can't be undone." className={`${btn} text-red-600`}>Forget</ConfirmButton>
          </form>
        </div>
      </li>
    );
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-4">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{person?.name}&apos;s memory</h1>
          <p className="text-sm text-zinc-500">
            Signed in as {me.name} ({me.role}) · Care circle: {team.map((p) => `${p.name} (${p.relation ?? p.role})`).join(", ")}
          </p>
        </div>
        <LogoutButton />
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Needs review ({review.length})</h2>
        {review.length ? <ul className="flex flex-col gap-2">{review.map((m) => <Memory key={m._id.toString()} m={m} />)}</ul>
          : <p className="text-sm text-zinc-500">Nothing waiting for review.</p>}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Add a memory</h2>
        <form action={addMemory} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">What should {person?.name} remember?
            <input name="text" required className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">Who can see it
            <select name="scope" className={input}>{SCOPES[me.role].map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-sm">Expires (optional)
            <input name="expires_at" type="datetime-local" className={input} />
          </label>
          <button className="rounded bg-foreground px-3 py-1 text-background">Add</button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Verified memories ({verified.length})</h2>
        <ul className="flex flex-col gap-2">{verified.map((m) => <Memory key={m._id.toString()} m={m} />)}</ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Conversation guidance</h2>
        <p className="text-sm text-zinc-500">How the voice agent should handle sensitive topics.</p>
        {guidance.map((g) => me.role === "family" ? (
          <form key={g.topic} action={saveGuidance} className="flex flex-col gap-1">
            <input type="hidden" name="topic" value={g.topic} />
            <label className="text-sm font-medium capitalize" htmlFor={`g-${g.topic}`}>{g.topic}</label>
            <textarea id={`g-${g.topic}`} name="guidance" defaultValue={g.guidance} rows={2} className={input} />
            <button className={`${btn} self-start`}>Save</button>
          </form>
        ) : (
          <div key={g.topic}><p className="text-sm font-medium capitalize">{g.topic}</p><p>{g.guidance}</p></div>
        ))}
        {me.role === "family" && (
          <form action={saveGuidance} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">New topic<input name="topic" required className={input} /></label>
            <label className="flex flex-1 flex-col gap-1 text-sm">Guidance<input name="guidance" required className={input} /></label>
            <button className={btn}>Add topic</button>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Activity</h2>
        {activity.length ? (
          <ul className="text-sm">
            {activity.map((a) => (
              <li key={a._id.toString()}>{fmt(a.at)}: {names[a.actor.user_id] ?? a.actor.user_id} {VERBS[a.action] ?? a.action} a {a.scope} memory</li>
            ))}
          </ul>
        ) : <p className="text-sm text-zinc-500">No changes yet.</p>}
      </section>
    </main>
  );
}
