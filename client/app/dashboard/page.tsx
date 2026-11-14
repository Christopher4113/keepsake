import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { LogoutButton } from "../logout-button";

export default async function DashboardPage() {
  const me = await requireSession(["family", "caregiver"]);
  const team = await (await getDb()).collection("people")
    .find({ person_id: me.person_id }, { projection: { _id: 0, name: 1, role: 1, relation: 1 } })
    .toArray();
  const person = team.find((p) => p.role === "person");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{person?.name}&apos;s memory</h1>
          <p className="text-sm text-zinc-500">Signed in as {me.name} ({me.role})</p>
        </div>
        <LogoutButton />
      </header>
      <section>
        <h2 className="font-medium">Care circle</h2>
        <ul className="text-sm">
          {team.map((p) => (
            <li key={p.name}>{p.name}: {p.relation ?? p.role}</li>
          ))}
        </ul>
      </section>
      {/* review queue, memories, guidance, activity go here */}
    </main>
  );
}
