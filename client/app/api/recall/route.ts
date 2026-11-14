import { after } from "next/server";
import { getMemberSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { recall } from "@/lib/recall";

// The one search API. Margaret's voice agent (client tool "recall"), caregivers and family all call this.
// Any household member may search; what they get back is limited by role inside recall() (readableScopes),
// so the role check is part of the database filter, not just a gate in front of it.
// Contract: docs/api-reads.yaml. Post the answer to /api/turns/:turn_id/answer.
export async function POST(req: Request) {
  const s = await getMemberSession();
  if (!s) return apiError("unauthorized", "Sign in required");

  const body = await req.json().catch(() => ({}));
  const query = String(body.query ?? "").trim().slice(0, 500);
  if (!query) return apiError("bad_request", "query is required");
  const conversation_id = typeof body.conversation_id === "string" && body.conversation_id ? body.conversation_id.slice(0, 200) : null;

  const { trace, ...result } = await recall(s, query, conversation_id);
  after(trace); // LangSmith, after the agent already has its answer
  return Response.json(result);
}
