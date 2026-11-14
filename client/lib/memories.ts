import { ObjectId } from "mongodb";
import { getDb } from "./db";
import { embed as voyageEmbed } from "./voyage";
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

// Best effort: a Voyage failure leaves embedding [] instead of losing the write. scripts/setup-vectors.mjs backfills it.
export async function embed(id: ObjectId, text: string) {
  try {
    const [vec] = await voyageEmbed([text], "document");
    await (await getDb()).collection("memories").updateOne({ _id: id }, { $set: { embedding: vec } });
  } catch (e) {
    console.error("embed failed", id.toString(), e);
  }
}
