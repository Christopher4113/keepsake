import { getDb } from "./db";
import type { Session } from "./auth";
import { readableScopes } from "./recall";
import { isoDate } from "./time";

// The caregiver's shift briefing: every verified memory they may read, grouped by date. No LLM, so nothing is made up.
// Same scope rule as search (readableScopes), so a caregiver only ever sees caregiver-scope memories.

export const COMING_UP_DAYS = 7;
const MAX_ITEMS = 200;

export type BriefingMemory = {
  _id: { toString(): string };
  text: string;
  source: { name?: string; user_id: string };
  event_start?: Date;
  event_end?: Date;
  created_at: Date;
};
export type BriefingItem = { id: string; text: string; author: string | null; event_start: string | null };
export type Briefing = { today: BriefingItem[]; coming_up: BriefingItem[]; other: BriefingItem[] };

// Older memories have no source.name (added in A15), so names fall back to households.members, as recall does.
type Names = Map<string, string>;
const item = (m: BriefingMemory, names: Names): BriefingItem => ({
  id: m._id.toString(),
  text: m.text,
  author: m.source.name ?? names.get(m.source.user_id) ?? null,
  event_start: m.event_start ? m.event_start.toISOString() : null,
});

// Days are compared as "YYYY-MM-DD" strings in the household's timezone, so "today" means today in Toronto.
// Dated memories: today if the day falls in [event_start, event_end ?? event_start], coming up if they start
// within COMING_UP_DAYS, hidden once they've ended, and under "other" if they're further out.
export function groupBriefing(memories: BriefingMemory[], now = new Date(), names: Names = new Map()): Briefing {
  const today = isoDate(now);
  const horizon = isoDate(new Date(now.getTime() + COMING_UP_DAYS * 86_400_000));
  const out: Briefing = { today: [], coming_up: [], other: [] };

  const byStart = (a: BriefingMemory, b: BriefingMemory) => a.event_start!.getTime() - b.event_start!.getTime();
  const dated = memories.filter((m) => m.event_start).sort(byStart);
  const undated = memories.filter((m) => !m.event_start).sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

  for (const m of dated) {
    const start = isoDate(m.event_start!);
    const end = isoDate(m.event_end ?? m.event_start!);
    if (end < today) continue;
    if (start <= today) out.today.push(item(m, names));
    else if (start <= horizon) out.coming_up.push(item(m, names));
    else out.other.push(item(m, names));
  }
  out.other.push(...undated.map((m) => item(m, names)));
  return out;
}

export async function getBriefing(s: Session, now = new Date()): Promise<Briefing> {
  const db = await getDb();
  const [docs, household] = await Promise.all([
    db.collection("memories")
      .find(
        { person_id: s.person_id, scope: { $in: readableScopes(s.role) }, status: "verified" },
        { projection: { text: 1, source: 1, event_start: 1, event_end: 1, created_at: 1 } },
      )
      .limit(MAX_ITEMS)
      .toArray(),
    db.collection("households").findOne({ person_id: s.person_id }, { projection: { members: 1 } }),
  ]);
  const names: Names = new Map((household?.members ?? []).map((m: { user_id: string; name: string }) => [m.user_id, m.name]));
  return groupBriefing(docs as unknown as BriefingMemory[], now, names);
}
