import { ObjectId } from "mongodb";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

// The voice client posts what the agent said after a recall. It sends the whole answer so far, so retries are idempotent.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "person") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 4000) : "";
  if (!answer) return Response.json({ error: "answer is required" }, { status: 400 });

  // Only the person who asked can answer their own turn; anything else looks missing, so turn ids can't be probed.
  // A turn that used a private memory keeps no answer: the answer could repeat it, and family reads the trace.
  const res = await (await getDb()).collection("turns").updateOne(
    { _id: new ObjectId(id), user_id: s.user_id, person_id: s.person_id, "results.scope": { $ne: "private" } },
    { $set: { answer } },
  );
  if (!res.matchedCount) {
    const own = await (await getDb()).collection("turns").countDocuments({ _id: new ObjectId(id), user_id: s.user_id });
    if (!own) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ saved: false, reason: "private" });
  }
  return Response.json({ saved: true });
}
