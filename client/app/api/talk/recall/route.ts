import { getSession } from "@/lib/auth";
import { recall } from "@/lib/recall";

// Client tool "recall": verified memories the agent may state, already filtered to this person's scopes.
// Returns { turn_id, memories[{ text, status, added_on, source:{ role, name } }] }; post the spoken answer to /api/turns/:turn_id/answer.
export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "person") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const query = String(body.query ?? "").trim().slice(0, 500);
  if (!query) return Response.json({ error: "query is required" }, { status: 400 });
  const conversation_id = typeof body.conversation_id === "string" && body.conversation_id ? body.conversation_id.slice(0, 200) : null;

  return Response.json(await recall(s, query, conversation_id));
}
