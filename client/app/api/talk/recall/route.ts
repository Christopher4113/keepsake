import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { recall } from "@/lib/memories";

// Client tool "recall": what the agent may say, already filtered to this person's scopes.
export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "person") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const query = String((await req.json().catch(() => ({}))).query ?? "").trim().slice(0, 500);
  if (!query) return Response.json({ error: "query is required" }, { status: 400 });

  const [memories, guidance] = await Promise.all([
    recall(s, query),
    (await getDb()).collection("topic_guidance")
      .find({ person_id: s.person_id }, { projection: { _id: 0, topic: 1, guidance: 1 } }).toArray(),
  ]);
  return Response.json({ memories, guidance });
}
