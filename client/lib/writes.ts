import { ObjectId, type ClientSession, type Document } from "mongodb";
import type { Session } from "./auth";
import { getClient, getDb } from "./db";
import type { ErrorCode } from "./http";
import { SCHEMA_VERSION, actor, audit, type Scope } from "./memories";
import { readableScopes } from "./recall";
import { embed, rerank } from "./voyage";

// The memory write path: add, correct, review (confirm/deny), forget, and the review queue.
// HTTP contract: docs/api-writes.yaml. The /api/memories and /api/reviews routes and the dashboard
// server actions both call these functions, so every surface gets the same rules.

// Q1 is open (rerank cutoff vs an LLM), so the supersede decision lives behind classify() alone.
// TODO(Track B, Emily): replace this placeholder with the real supersede method when merging the
// classifier work. classify() is the only function that needs to change; callers rely on its return
// shape. With 0.75, nothing is ever proposed: on keepsake_test the demo physio change scored 0.648
// against "Physio visit is every Tuesday at 2pm", and the dinner change scored 0.569 against the old
// dinner but also 0.548 against "Anna calls every evening around 7". Rerank alone can't separate
// "replaces" from "same topic". Check against tests/scenarios/write_path.json.
export const SUPERSEDE_MIN_SCORE = Number(process.env.SUPERSEDE_MIN_SCORE ?? 0.75);
const CANDIDATE_LIMIT = 10;

// Thrown for a request the caller got wrong; routes turn it into { error: { code, message } }.
export class WriteError extends Error {
  constructor(public code: ErrorCode, message: string) { super(message); }
}

// R21: on a stale or missing confirm, the 409 body is a fresh needs-confirmation payload, not the error shape.
export class ConfirmMismatch extends Error {
  constructor(public payload: NeedsConfirmation) { super("Confirmation no longer matches"); }
}

type Role = Session["role"];
type From = { name: string; role: Role };
export type Candidate = { memory_id: string; text?: string; author_name?: string | null; created_at?: string | null; supersedes: boolean; rerank_score: number | null };
export type OldMemory = { memory_id: string; text: string; author_name: string; created_at: string };
export type NeedsConfirmation = { needs_confirmation: true; old: OldMemory };
export type SavedWrite = {
  saved: true; needs_confirmation: false; needs_family_review: boolean;
  memory_id: string; status: string; scope: Scope; from: From;
  proposed_supersedes?: string | null; supersedes?: string | null; audit_action: "write" | "approve" | "verify";
  message?: string | null; candidates: Candidate[];
};
export type WriteResult = NeedsConfirmation | SavedWrite;

export type MemoryInput = { text: string; scope?: string; confirm?: boolean; confirm_supersedes?: string };

const memories = async () => (await getDb()).collection("memories");
const iso = (d?: Date | null) => (d ? d.toISOString() : null);
// Display names for a household. Memories written before migration 006 have no source.name (A15).
type Names = Map<string, string>;
async function householdNames(person_id: string): Promise<Names> {
  const h = await (await getDb()).collection("households").findOne({ person_id }, { projection: { members: 1 } });
  return new Map((h?.members ?? []).map((m: { user_id: string; name: string }) => [m.user_id, m.name]));
}
const authorName = (m: Document, names: Names) =>
  (m.source?.name as string | undefined) ?? names.get(m.source?.user_id) ?? (m.source?.user_id as string);
const from = (s: Session): From => ({ name: s.name, role: s.role });
const isFamily = (s: Session) => s.role === "family";

function requireRole(s: Session, roles: Role[], message: string) {
  if (!roles.includes(s.role)) throw new WriteError("forbidden", message);
}

function cleanText(text: unknown) {
  const t = typeof text === "string" ? text.trim().slice(0, 1000) : "";
  if (!t) throw new WriteError("bad_request", "text is required");
  return t;
}

function parseId(id: unknown, what = "Memory") {
  if (typeof id !== "string" || !ObjectId.isValid(id)) throw new WriteError("not_found", `${what} not found`);
  return new ObjectId(id);
}

const oldOf = (m: Document, names: Names): OldMemory => ({
  memory_id: m._id.toString(), text: m.text, author_name: authorName(m, names), created_at: m.created_at.toISOString(),
});

// One transaction per multi-document change (R3, D7).
async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const client = await getClient();
  return client.withSession((session) => session.withTransaction(() => fn(session)));
}

type Classified = {
  names: Names;
  embedding: number[];
  proposed: Document | null;
  candidates: { doc: Document; supersedes: boolean; rerank_score: number | null }[];
};

// Finds verified memories this one might replace (R19, all scopes) and decides supersedes per candidate (A14).
// The embedding is reused for the insert, so a memory is never stored without one when Voyage is up (R7).
export async function classify(text: string, person_id: string): Promise<Classified> {
  const names = await householdNames(person_id);
  let embedding: number[];
  try {
    [embedding] = await embed([text], "document");
  } catch (e) {
    // No vector, no comparison. Save anyway: setup-vectors.mjs backfills, and family still reviews caregiver notes.
    console.warn("classify: embed failed, saving without candidates:", (e as Error).message);
    return { names, embedding: [], proposed: null, candidates: [] };
  }

  const hits = await (await memories()).aggregate([
    { $vectorSearch: { index: "memory_vec", path: "embedding", queryVector: embedding, numCandidates: 100, limit: CANDIDATE_LIMIT, filter: { person_id, status: "verified" } } },
    { $project: { embedding: 0 } },
  ]).toArray();
  if (!hits.length) return { names, embedding, proposed: null, candidates: [] };

  try {
    const ranked = await rerank(text, hits.map((h) => h.text), CANDIDATE_LIMIT);
    const candidates = ranked.map((r) => ({ doc: hits[r.index], supersedes: r.relevance_score >= SUPERSEDE_MIN_SCORE, rerank_score: r.relevance_score }));
    return { names, embedding, proposed: candidates.find((c) => c.supersedes)?.doc ?? null, candidates };
  } catch (e) {
    // Without rerank there's no supersede signal: list candidates for family, propose nothing.
    console.warn("classify: rerank failed, proposing nothing:", (e as Error).message);
    return { names, embedding, proposed: null, candidates: hits.map((doc) => ({ doc, supersedes: false, rerank_score: null })) };
  }
}

const candidateOut = (c: Classified["candidates"][number], names: Names): Candidate => ({
  memory_id: c.doc._id.toString(), text: c.doc.text, author_name: authorName(c.doc, names), created_at: iso(c.doc.created_at),
  supersedes: c.supersedes, rerank_score: c.rerank_score,
});

// What the writer may see about the classification: only memories in their readable scopes (A3, R22).
function visibleClassification(s: Session, c: Classified) {
  const scopes = readableScopes(s.role);
  const proposedVisible = c.proposed && scopes.includes(c.proposed.scope);
  return {
    candidates: c.candidates.filter((x) => scopes.includes(x.doc.scope)).map((x) => candidateOut(x, c.names)),
    proposed_supersedes: proposedVisible ? c.proposed!._id.toString() : null,
    message: proposedVisible ? `This will supersede ${c.proposed!.text}` : null,
  };
}

const reviewOf = (c: Classified) => ({
  state: "pending" as const,
  proposed_supersedes: c.proposed?._id ?? null,
  candidates: c.candidates.map((x) => ({ memory_id: x.doc._id, supersedes: x.supersedes, rerank_score: x.rerank_score })),
  decided_by: null, decided_at: null,
});

// Inserts a verified memory that supersedes `old`, inside one transaction. Returns null if `old` stopped being verified.
class OldChanged extends Error {}
async function saveSuperseding(s: Session, text: string, scope: Scope, embedding: number[], old: Document, review?: Document) {
  try {
    return await supersedeInTransaction(s, text, scope, embedding, old, review);
  } catch (e) {
    if (e instanceof OldChanged) return null;
    throw e;
  }
}
async function supersedeInTransaction(s: Session, text: string, scope: Scope, embedding: number[], old: Document, review?: Document) {
  return inTransaction(async (session) => {
    const coll = await memories();
    const flipped = await coll.updateOne({ _id: old._id, person_id: s.person_id, status: "verified" }, { $set: { status: "superseded" } }, { session });
    // Someone else superseded or forgot it since the writer saw it: throwing aborts the transaction.
    if (!flipped.modifiedCount) throw new OldChanged();
    const { insertedId } = await coll.insertOne({
      schema_version: SCHEMA_VERSION, person_id: s.person_id, text, scope, status: "verified", flagged: false,
      source: actor(s), supersedes: old._id, embedding, created_at: new Date(),
      ...(review && { review }),
    }, { session });
    await audit(s, insertedId, "approve", scope, old._id, insertedId, session);
    return insertedId;
  });
}

// POST /api/memories. Family and caregiver; Margaret doesn't add memories in the MVP (A16).
export async function createMemory(s: Session, input: MemoryInput): Promise<WriteResult> {
  requireRole(s, ["family", "caregiver"], "Only family and caregivers can add memories");
  const text = cleanText(input.text);
  // R20: caregivers always write caregiver scope; family picks (default family).
  const scope = (isFamily(s) ? input.scope ?? "family" : "caregiver") as Scope;
  if (!readableScopes(s.role).includes(scope)) throw new WriteError("bad_request", "scope must be family or caregiver");

  const c = await classify(text, s.person_id);
  const coll = await memories();

  // Caregiver: saved unverified for family review, whatever classify found (R15).
  if (!isFamily(s)) {
    const { insertedId } = await coll.insertOne({
      schema_version: SCHEMA_VERSION, person_id: s.person_id, text, scope, status: "unverified", flagged: true,
      source: actor(s), supersedes: null, embedding: c.embedding, created_at: new Date(), review: reviewOf(c),
    });
    await audit(s, insertedId, "write", scope);
    return {
      saved: true, needs_confirmation: false, needs_family_review: true,
      memory_id: insertedId.toString(), status: "unverified", scope, from: from(s), audit_action: "write",
      ...visibleClassification(s, c),
    };
  }

  // Family, would supersede: ask first (A6), then save only if the same memory is still proposed (R21).
  if (c.proposed) {
    const ask: NeedsConfirmation = { needs_confirmation: true, old: oldOf(c.proposed, c.names) };
    if (input.confirm !== true) return ask;
    if (input.confirm_supersedes !== c.proposed._id.toString()) throw new ConfirmMismatch(ask);
    const review = { ...reviewOf(c), state: "approved", decided_by: s.user_id, decided_at: new Date() };
    const id = await saveSuperseding(s, text, scope, c.embedding, c.proposed, review);
    if (!id) throw new ConfirmMismatch(ask);
    return {
      saved: true, needs_confirmation: false, needs_family_review: false,
      memory_id: id.toString(), status: "verified", scope, from: from(s), audit_action: "approve",
      supersedes: c.proposed._id.toString(), ...visibleClassification(s, c),
    };
  }

  // Family, nothing to supersede: trusted, saved verified. A stale confirm has nothing left to confirm.
  const { insertedId } = await coll.insertOne({
    schema_version: SCHEMA_VERSION, person_id: s.person_id, text, scope, status: "verified", flagged: false,
    source: actor(s), supersedes: null, embedding: c.embedding, created_at: new Date(),
  });
  await audit(s, insertedId, "write", scope);
  return {
    saved: true, needs_confirmation: false, needs_family_review: false,
    memory_id: insertedId.toString(), status: "verified", scope, from: from(s), audit_action: "write",
    ...visibleClassification(s, c),
  };
}

// POST /api/memories/:id/corrections. Family replaces a verified memory with new text (A2).
// The old memory is kept as superseded for the audit trail and the trace; the new one inherits its scope (R20).
// A caregiver's correction is just an add: POST /api/memories, which goes to family review.
export async function correctMemory(s: Session, id: string, input: MemoryInput): Promise<WriteResult> {
  requireRole(s, ["family"], "Only family can correct a memory; caregivers add a note for review instead");
  const _id = parseId(id);
  const text = cleanText(input.text);
  const coll = await memories();
  const old = await coll.findOne({ _id, person_id: s.person_id, scope: { $in: readableScopes(s.role) }, status: "verified" }, { projection: { embedding: 0 } });
  if (!old) throw new WriteError("not_found", "Memory not found");

  const ask: NeedsConfirmation = { needs_confirmation: true, old: oldOf(old, await householdNames(s.person_id)) };
  if (input.confirm !== true) return ask;
  if (input.confirm_supersedes !== id) throw new ConfirmMismatch(ask);

  let embedding: number[] = [];
  try {
    [embedding] = await embed([text], "document");
  } catch (e) {
    console.warn("correct: embed failed, saving without embedding:", (e as Error).message);
  }
  const newId = await saveSuperseding(s, text, old.scope, embedding, old);
  if (!newId) throw new ConfirmMismatch(ask);
  return {
    saved: true, needs_confirmation: false, needs_family_review: false,
    memory_id: newId.toString(), status: "verified", scope: old.scope, from: from(s), audit_action: "approve",
    proposed_supersedes: id, supersedes: id, candidates: [],
  };
}

export type ReviewDecision = {
  decision: "confirm" | "deny"; memory_id: string; new_status: string; review_state: string;
  supersedes: string | null; old_status: string | null; audit_action: "approve" | "verify" | "deny";
  decided_by: string; decided_at: string;
};

// POST /api/memories/:id/review. Any family member confirms or denies a pending memory (A12, R3).
export async function reviewMemory(s: Session, id: string, decision: unknown): Promise<ReviewDecision> {
  requireRole(s, ["family"], "Only a family member can confirm or deny a review");
  if (decision !== "confirm" && decision !== "deny") throw new WriteError("bad_request", 'decision must be "confirm" or "deny"');
  const _id = parseId(id);
  const coll = await memories();
  const mem = await coll.findOne({ _id, person_id: s.person_id }, { projection: { review: 1, scope: 1 } });
  if (!mem?.review) throw new WriteError("not_found", "Review not found");
  if (mem.review.state !== "pending") throw new WriteError("conflict", "This review has already been decided");

  const decided_at = new Date();
  const proposed = mem.review.proposed_supersedes as ObjectId | null;

  return inTransaction(async (session) => {
    const pending = { _id, "review.state": "pending" };
    const decidedBy = { "review.decided_by": s.user_id, "review.decided_at": decided_at, flagged: false };

    if (decision === "deny") {
      const r = await coll.updateOne(pending, { $set: { ...decidedBy, status: "retracted", "review.state": "denied" } }, { session });
      if (!r.modifiedCount) throw new WriteError("conflict", "This review has already been decided");
      await audit(s, _id, "deny", mem.scope, null, null, session);
      const old = proposed ? await coll.findOne({ _id: proposed }, { projection: { status: 1 }, session }) : null;
      return result("deny", "retracted", "denied", null, old?.status ?? null, "deny");
    }

    // Confirm: supersede the proposed memory if it's still verified, even if this family member can't read it (R3).
    const old = proposed
      ? await coll.findOneAndUpdate({ _id: proposed, person_id: s.person_id, status: "verified" }, { $set: { status: "superseded" } }, { session })
      : null;
    const supersedes = old?._id ?? null;
    const r = await coll.updateOne(pending, { $set: { ...decidedBy, status: "verified", "review.state": "approved", supersedes } }, { session });
    if (!r.modifiedCount) throw new WriteError("conflict", "This review has already been decided");
    const action = supersedes ? "approve" : "verify";
    await audit(s, _id, action, mem.scope, supersedes, supersedes ? _id : null, session);
    return result("confirm", "verified", "approved", supersedes?.toString() ?? null, supersedes ? "superseded" : null, action);
  });

  function result(d: ReviewDecision["decision"], new_status: string, review_state: string, supersedes: string | null, old_status: string | null, audit_action: ReviewDecision["audit_action"]): ReviewDecision {
    return { decision: d, memory_id: id, new_status, review_state, supersedes, old_status, audit_action, decided_by: s.user_id, decided_at: decided_at.toISOString() };
  }
}

export type ReviewItem = {
  id: string; text: string; status: string; scope: Scope; flagged: boolean; from: From; created_at: string;
  message: string | null; proposed_old: OldMemory | null;
  review: { state: string; proposed_supersedes: string | null; candidates: Candidate[]; decided_by: string | null; decided_at: string | null };
};

// GET /api/reviews (R23). Every pending memory, newest first, with the proposed old memory and candidates looked up.
export async function listReviews(s: Session): Promise<ReviewItem[]> {
  requireRole(s, ["family"], "Only family can see the review queue");
  const coll = await memories();
  const [pending, names] = await Promise.all([
    coll.find({ person_id: s.person_id, "review.state": "pending" }, { projection: { embedding: 0 } }).sort({ created_at: -1 }).toArray(),
    householdNames(s.person_id),
  ]);

  const ids = pending.flatMap((m) => (m.review.candidates ?? []).map((c: { memory_id: ObjectId }) => c.memory_id));
  const lookups = ids.length
    ? await coll.find({ _id: { $in: ids }, scope: { $in: readableScopes(s.role) } }, { projection: { text: 1, source: 1, created_at: 1 } }).toArray()
    : [];
  const byId = new Map(lookups.map((d) => [d._id.toString(), d]));

  return pending.map((m) => {
    const proposedDoc = m.review.proposed_supersedes ? byId.get(m.review.proposed_supersedes.toString()) : undefined;
    return {
      id: m._id.toString(), text: m.text, status: m.status, scope: m.scope, flagged: !!m.flagged,
      from: { name: authorName(m, names), role: m.source.role }, created_at: m.created_at.toISOString(),
      message: proposedDoc ? `This will supersede ${proposedDoc.text}` : null,
      proposed_old: proposedDoc ? oldOf(proposedDoc, names) : null,
      review: {
        state: m.review.state,
        proposed_supersedes: m.review.proposed_supersedes?.toString() ?? null,
        candidates: (m.review.candidates ?? []).map((c: { memory_id: ObjectId; supersedes: boolean; rerank_score: number | null }) => {
          const d = byId.get(c.memory_id.toString());
          return { memory_id: c.memory_id.toString(), ...(d && { text: d.text, author_name: authorName(d, names), created_at: iso(d.created_at) }), supersedes: c.supersedes, rerank_score: c.rerank_score ?? null };
        }),
        decided_by: m.review.decided_by ?? null,
        decided_at: iso(m.review.decided_at),
      },
    };
  });
}

export type MemoryItem = { id: string; text: string; status: string; scope: Scope; flagged: boolean; from: From; created_at: string; supersedes: string | null };

// GET /api/memories. Live memories (unverified and verified) the caller can read, newest first.
// A caregiver sees only their own notes, as on their dashboard.
export async function listMemories(s: Session, status?: string): Promise<MemoryItem[]> {
  requireRole(s, ["family", "caregiver"], "Only family and caregivers can list memories");
  const statuses = status ? [status] : ["unverified", "verified"];
  if (!statuses.every((x) => ["unverified", "verified", "superseded", "retracted"].includes(x))) throw new WriteError("bad_request", "unknown status");
  const names = await householdNames(s.person_id);
  const docs = await (await memories()).find({
    person_id: s.person_id, scope: { $in: readableScopes(s.role) }, status: { $in: statuses },
    ...(isFamily(s) ? {} : { "source.user_id": s.user_id }),
  }, { projection: { embedding: 0, review: 0 } }).sort({ created_at: -1 }).limit(200).toArray();
  return docs.map((m) => ({
    id: m._id.toString(), text: m.text, status: m.status, scope: m.scope, flagged: !!m.flagged,
    from: { name: authorName(m, names), role: m.source.role }, created_at: m.created_at.toISOString(), supersedes: m.supersedes?.toString() ?? null,
  }));
}

// DELETE /api/memories/:id. Family forgets a memory: the document and its embedding are deleted,
// and only a content-free audit row stays.
export async function forgetMemory(s: Session, id: string) {
  requireRole(s, ["family"], "Only family can forget a memory");
  const _id = parseId(id);
  const coll = await memories();
  const mem = await coll.findOne({ _id, person_id: s.person_id, scope: { $in: readableScopes(s.role) } }, { projection: { scope: 1 } });
  if (!mem) throw new WriteError("not_found", "Memory not found");
  await inTransaction(async (session) => {
    await coll.deleteOne({ _id }, { session });
    await audit(s, _id, "forget", mem.scope, _id, null, session);
  });
  return { forgotten: true, memory_id: id };
}
