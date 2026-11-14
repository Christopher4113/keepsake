import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Session } from "@/lib/auth";
import { fakeDb } from "./fake-db";

let f: ReturnType<typeof fakeDb>;
vi.mock("@/lib/db", () => ({ getDb: async () => f.db }));
const { groupBriefing, getBriefing } = await import("@/lib/briefing");

// 15:00 UTC = 10:00 in Toronto, Saturday Nov 14.
const NOW = new Date("2026-11-14T15:00:00Z");
const at = (iso: string) => new Date(iso);
const mem = (text: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), text, source: { user_id: "anna", name: "Anna" }, created_at: at("2026-11-01T12:00:00Z"), ...extra,
});
const texts = (xs: { text: string }[]) => xs.map((x) => x.text);

describe("groupBriefing", () => {
  it("puts today's, the next week's and undated memories in their sections, and hides past ones", () => {
    const b = groupBriefing([
      mem("undated old", { created_at: at("2026-10-01T12:00:00Z") }),
      mem("undated new", { created_at: at("2026-11-10T12:00:00Z") }),
      mem("books this morning", { event_start: at("2026-11-14T05:00:00Z") }),        // 00:00 Toronto today
      mem("yesterday", { event_start: at("2026-11-13T15:00:00Z") }),
      mem("in three days", { event_start: at("2026-11-17T15:00:00Z") }),
      mem("in two weeks", { event_start: at("2026-11-28T15:00:00Z") }),
      mem("trip spanning today", { event_start: at("2026-11-12T15:00:00Z"), event_end: at("2026-11-16T15:00:00Z") }),
    ], NOW);
    expect(texts(b.today)).toEqual(["trip spanning today", "books this morning"]);
    expect(texts(b.coming_up)).toEqual(["in three days"]);
    expect(texts(b.other)).toEqual(["in two weeks", "undated new", "undated old"]);
  });

  it("uses Toronto days, not UTC: 03:00 UTC on the 15th is still the 14th", () => {
    const b = groupBriefing([mem("late evening", { event_start: at("2026-11-15T03:00:00Z") })], NOW);
    expect(texts(b.today)).toEqual(["late evening"]);
  });

  it("carries the author's name for the 'from' label", () => {
    expect(groupBriefing([mem("tea")], NOW).other[0].author).toBe("Anna");
  });

  it("falls back to the household member's name when the memory has none", () => {
    const old = mem("tea", { source: { user_id: "anna" } });
    expect(groupBriefing([old], NOW, new Map([["anna", "Anna"]])).other[0].author).toBe("Anna");
  });
});

describe("getBriefing", () => {
  const ravi: Session = { user_id: "ravi", name: "Ravi", role: "caregiver", person_id: "margaret" };
  const doc = (text: string, scope: string, status = "verified", person_id = "margaret") =>
    ({ ...mem(text), person_id, scope, status });

  it("returns only verified memories in the caller's scopes and household", async () => {
    f = fakeDb({ memories: [
      doc("tea with milk", "caregiver"),
      doc("family secret", "family"),
      doc("pending note", "caregiver", "unverified"),
      doc("old routine", "caregiver", "superseded"),
      doc("harold's physio", "caregiver", "verified", "harold"),
    ] });
    const b = await getBriefing(ravi, NOW);
    expect(texts([...b.today, ...b.coming_up, ...b.other])).toEqual(["tea with milk"]);
  });
});
