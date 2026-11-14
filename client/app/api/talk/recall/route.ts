import { getMemberSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { recall } from "@/lib/recall";

// Client tool "recall": verified memories the agent may state, already filtered to this person's scopes.
// Contract: docs/api-reads.yaml. Post the spoken answer to /api/turns/:turn_id/answer.
export async function POST(req: Request) {
  const s = await getMemberSession();
  if (!s) return apiError("unauthorized", "Sign in required");
  if (s.role !== "person") return apiError("forbidden", "Only the person can use the voice agent");

  const body = await req.json().catch(() => ({}));
  const query = String(body.query ?? "").trim().slice(0, 500);
  if (!query) return apiError("bad_request", "query is required");
  const conversation_id = typeof body.conversation_id === "string" && body.conversation_id ? body.conversation_id.slice(0, 200) : null;

  return Response.json(await recall(s, query, conversation_id));
}
