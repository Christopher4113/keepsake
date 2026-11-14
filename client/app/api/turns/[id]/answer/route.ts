import { ObjectId } from "mongodb";
import { after } from "next/server";
import { getMemberSession } from "@/lib/auth";
import { traceAnswer } from "@/lib/tracing";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";

const ANSWER_SETTLE_MS = 4000;

// The voice client posts what the agent said after a recall. It sends the whole answer so far, so retries are idempotent.
// Contract: docs/api-reads.yaml.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getMemberSession();
  if (!s) return apiError("unauthorized", "Sign in required");
  if (s.role !== "person") return apiError("forbidden", "Only the person can use the voice agent");

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) return apiError("not_found", "Turn not found");
  const body = await req.json().catch(() => ({}));
  const answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 4000) : "";
  if (!answer) return apiError("bad_request", "answer is required");

  // Only the person who asked can answer their own turn; anything else looks missing, so turn ids can't be probed.
  const turns = (await getDb()).collection("turns");
  const _id = new ObjectId(id);
  const { matchedCount } = await turns.updateOne({ _id, user_id: s.user_id, person_id: s.person_id }, { $set: { answer } });
  if (!matchedCount) return apiError("not_found", "Turn not found");

  // The answer grows as the agent streams, and LangSmith takes one post per run. So wait for it to settle and let only
  // the call whose answer is still the latest trace it.
  after(async () => {
    await new Promise((r) => setTimeout(r, ANSWER_SETTLE_MS));
    const t = await turns.findOne({ _id }, { projection: { question: 1, conversation_id: 1, person_id: 1, at: 1, results: 1, answer: 1 } });
    if (!t || t.answer !== answer) return;
    await traceAnswer({
      turnId: id, question: t.question, conversationId: t.conversation_id ?? null, person_id: t.person_id, at: t.at, answer,
      memories: (t.results ?? []).map((r: { text: string; status: string; author_name: string | null }) => ({ text: r.text, status: r.status, source: r.author_name })),
    });
  });
  return Response.json({ saved: true });
}
