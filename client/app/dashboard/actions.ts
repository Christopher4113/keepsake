"use server";

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { SCHEMA_VERSION, SCOPES, actor, audit, embed, visibleTo, type Scope } from "@/lib/memories";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// Loads a live memory only if this user may see it; anything else acts as "not found".
// Reviewing and editing are family-only: caregivers can add notes but never change one.
async function loadVisible(form: FormData) {
  const s = await requireSession(["family"]);
  const id = str(form, "id");
  if (!ObjectId.isValid(id)) throw new Error("Bad memory id");
  const _id = new ObjectId(id);
  const db = await getDb();
  const mem = await db.collection("memories").findOne({
    _id, ...visibleTo(s), status: { $in: ["unverified", "verified"] },
  });
  if (!mem) throw new Error("Memory not found");
  return { s, db, mem, _id };
}

// Family additions are trusted. Caregiver notes are always caregiver scope and wait in
// family's review queue; until then the agent treats them as unverified.
export async function addMemory(form: FormData) {
  const s = await requireSession(["family", "caregiver"]);
  const caregiver = s.role === "caregiver";
  const text = str(form, "text");
  const scope = (caregiver ? "caregiver" : str(form, "scope")) as Scope;
  const expires = str(form, "expires_at");
  if (!text || !SCOPES[s.role].includes(scope)) throw new Error("Invalid memory");

  const db = await getDb();
  const { insertedId } = await db.collection("memories").insertOne({
    schema_version: SCHEMA_VERSION, person_id: s.person_id, text, scope,
    status: caregiver ? "unverified" : "verified", flagged: caregiver, source: actor(s),
    supersedes: null, expires_at: expires ? new Date(expires) : null,
    embedding: [], created_at: new Date(),
    ...(caregiver && { review: { state: "pending", proposed_supersedes: null, candidates: [], decided_by: null, decided_at: null } }),
  });
  await audit(s, insertedId, "write", scope);
  await embed(insertedId, text);
  revalidatePath("/dashboard");
}

// Approve a flagged memory. If review proposed replacing an older one, that one is superseded.
export async function verifyMemory(form: FormData) {
  const { s, db, mem, _id } = await loadVisible(form);
  const memories = db.collection("memories");
  const set: Record<string, unknown> = { status: "verified", flagged: false };

  // Only replace a memory this user can see; otherwise approve without superseding.
  const proposed = mem.review?.proposed_supersedes as ObjectId | null | undefined;
  const old = proposed ? await memories.findOne({ _id: proposed, ...visibleTo(s), status: "verified" }) : null;
  if (old) set.supersedes = old._id;
  if (mem.review) Object.assign(set, { "review.state": "approved", "review.decided_by": s.user_id, "review.decided_at": new Date() });

  await memories.updateOne({ _id }, { $set: set });
  if (old) await memories.updateOne({ _id: old._id }, { $set: { status: "superseded" } });
  await audit(s, _id, mem.review ? "approve" : "verify", mem.scope, old?._id ?? null, old ? _id : null);
  revalidatePath("/dashboard");
}

// Deny: keep the record but retract it so retrieval ignores it.
export async function denyMemory(form: FormData) {
  const { s, db, mem, _id } = await loadVisible(form);
  await db.collection("memories").updateOne({ _id }, { $set: {
    status: "retracted", flagged: false,
    "review.state": "denied", "review.decided_by": s.user_id, "review.decided_at": new Date(),
  } });
  await audit(s, _id, "deny", mem.scope);
  revalidatePath("/dashboard");
}

// Versioned correction: the new doc points at the old one, which drops out of retrieval.
export async function correctMemory(form: FormData) {
  const { s, db, mem, _id } = await loadVisible(form);
  const text = str(form, "text");
  if (!text) throw new Error("Correction needs text");

  const { _id: _old, embedding: _e, demo_tag: _t, key: _k, note: _n, review: _r, ...rest } = mem;
  const { insertedId } = await db.collection("memories").insertOne({
    ...rest, schema_version: SCHEMA_VERSION, text, status: "verified", supersedes: _id, flagged: false,
    source: actor(s), embedding: [], created_at: new Date(),
  });
  await db.collection("memories").updateOne({ _id }, { $set: { status: "superseded" } });
  await audit(s, insertedId, "correct", mem.scope, _id, insertedId);
  await embed(insertedId, text);
  revalidatePath("/dashboard");
}

// Forget: content and embedding are deleted; only a content-free audit row stays.
export async function forgetMemory(form: FormData) {
  const { s, db, mem, _id } = await loadVisible(form);
  await db.collection("memories").deleteOne({ _id });
  await audit(s, _id, "forget", mem.scope, _id, null);
  revalidatePath("/dashboard");
}

export async function saveGuidance(form: FormData) {
  const s = await requireSession(["family"]);
  const topic = str(form, "topic").toLowerCase();
  const guidance = str(form, "guidance");
  if (!topic || !guidance) throw new Error("Topic and guidance are required");

  await (await getDb()).collection("topic_guidance").updateOne(
    { person_id: s.person_id, topic },
    { $set: { guidance, set_by: s.user_id, updated_at: new Date() }, $setOnInsert: { related_memory_ids: [] } },
    { upsert: true },
  );
  revalidatePath("/dashboard");
}
