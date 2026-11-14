import { ObjectId } from "mongodb";
import { getDb } from "./db";
import { embeddings, memoryStore } from "./vectorstore";
import type { Role, Session } from "./auth";

export type Scope = "private" | "family" | "caregiver";

// Same rules as db/queries.js: which scopes each role may read.
export const SCOPES: Record<Role, Scope[]> = {
  person: ["private", "family", "caregiver"],
  family: ["family", "caregiver"],
  caregiver: ["caregiver"],
};

// Every read and write filters on this, so one household never sees another's memories.
export const visibleTo = (s: Session) => ({ person_id: s.person_id, scope: { $in: SCOPES[s.role] } });

// Required by the memories and audit_log validators.
export const SCHEMA_VERSION = 1;

export const actor =(s: Session) => ({ role: s.role, user_id: s.user_id });

export async function audit(
  s: Session, memory_id: ObjectId, action: string, scope: Scope,
  old_id: ObjectId | null = null, new_id: ObjectId | null = null,
) {
  // person_id + scope let the activity feed apply the same visibility rules; still no memory text here.
  await (await getDb()).collection("audit_log").insertOne({
    schema_version: SCHEMA_VERSION, memory_id, action, actor: actor(s), person_id: s.person_id, scope, old_id, new_id, at: new Date(),
  });
}

export type Recalled = { text: string; scope: Scope; status: string };

// Role-scoped retrieval. The scope filter runs inside $vectorSearch (preFilter), never after it.
export async function recall(s: Session, query: string, k = 5): Promise<Recalled[]> {
  const filter = { person_id: s.person_id, scope: { $in: SCOPES[s.role] }, status: { $in: ["verified", "unverified"] } };
  try {
    const hits = await (await memoryStore()).similaritySearchWithScore(query, k, { preFilter: filter });
    if (hits.length) return hits.map(([d]) => ({ text: d.pageContent, scope: d.metadata.scope, status: d.metadata.status }));
  } catch (e) {
    console.warn("vector search unavailable, using keyword fallback:", (e as Error).message);
  }
  // ponytail: keyword OR-match fallback while the Atlas index builds or embeddings are missing.
  const words = query.toLowerCase().match(/[a-z']{4,}/g) ?? [];
  if (!words.length) return [];
  const rx = new RegExp(words.map((w) => w.replace(/[^a-z']/g, "")).join("|"), "i");
  const docs = await (await getDb()).collection("memories")
    .find({ ...filter, text: rx }, { projection: { text: 1, scope: 1, status: 1 } }).limit(k).toArray();
  return docs.map((d) => ({ text: d.text, scope: d.scope, status: d.status }));
}

// Best effort: a Voyage failure leaves embedding [] (regex fallback still finds it) instead of losing the write.
export async function embed(id: ObjectId, text: string) {
  try {
    const [vec] = await embeddings.embedDocuments([text]);
    await (await getDb()).collection("memories").updateOne({ _id: id }, { $set: { embedding: vec } });
  } catch (e) {
    console.error("embed failed", id.toString(), e);
  }
}
