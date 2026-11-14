import { after } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { SCHEMA_VERSION, actor, audit, embed } from "@/lib/memories";

// Client tool "remember": what the person says becomes an unverified memory for family to review.
// Private wishes are hers alone, so they skip review and stay invisible to family and caregivers.
export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "person") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").trim().slice(0, 1000);
  const isPrivate = body.private === true;
  if (!text) return Response.json({ error: "text is required" }, { status: 400 });

  const scope = isPrivate ? "private" : "family";
  const { insertedId } = await (await getDb()).collection("memories").insertOne({
    schema_version: SCHEMA_VERSION, person_id: s.person_id, text, scope,
    status: isPrivate ? "verified" : "unverified", flagged: !isPrivate,
    source: actor(s), supersedes: null, expires_at: null, embedding: [], created_at: new Date(),
    ...(isPrivate ? {} : { review: { state: "pending", proposed_supersedes: null, candidates: [], decided_by: null, decided_at: null } }),
  });
  await audit(s, insertedId, "write", scope);
  after(() => embed(insertedId, text)); // keep the voice reply fast

  return Response.json({ saved: true, needs_family_review: !isPrivate });
}
