import { ObjectId } from "mongodb";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";

// The voice client posts what the agent said after a recall. It sends the whole answer so far, so retries are idempotent.
// Contract: docs/api-reads.yaml.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return apiError("unauthorized", "Sign in required");
  if (s.role !== "person") return apiError("forbidden", "Only the person can use the voice agent");

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) return apiError("not_found", "Turn not found");
  const body = await req.json().catch(() => ({}));
  const answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 4000) : "";
  if (!answer) return apiError("bad_request", "answer is required");

  // Only the person who asked can answer their own turn; anything else looks missing, so turn ids can't be probed.
  const { matchedCount } = await (await getDb()).collection("turns").updateOne(
    { _id: new ObjectId(id), user_id: s.user_id, person_id: s.person_id },
    { $set: { answer } },
  );
  if (!matchedCount) return apiError("not_found", "Turn not found");
  return Response.json({ saved: true });
}
