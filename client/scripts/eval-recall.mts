// LangSmith experiment over tests/scenarios/read_path.json: runs the real search + cutoff as each user and scores
// the memory rules (must_include, must_exclude, expect_empty). Read-only: no turns are written.
// Run from client/: npx tsx --env-file=.env scripts/eval-recall.mts
// On Voyage's free tier (3 requests/min) set EVAL_DELAY_MS=40000: each case makes two calls.
import { readFileSync } from "node:fs";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { getDb } from "../lib/db";
import { applyCutoff, readableScopes, search, MIN_RERANK_SCORE } from "../lib/recall";
import type { Role } from "../lib/auth";

type Case = {
  id: string; as: string; query: string; note?: string; setup?: unknown;
  must_include?: string[]; must_exclude?: string[]; expect_empty?: boolean; expect_status?: Record<string, string>;
};

const DATASET = "keepsake-read-path";
const delay = Number(process.env.EVAL_DELAY_MS ?? 0);
const { cases } = JSON.parse(readFileSync(new URL("../../tests/scenarios/read_path.json", import.meta.url), "utf8")) as { cases: Case[] };

const db = await getDb();
const keyed = await db.collection("memories").find({ key: { $exists: true } }, { projection: { key: 1 } }).toArray();
const keyOf = new Map(keyed.map((d) => [d._id.toString(), d.key as string]));
const known = new Set(keyed.map((d) => d.key as string));
const households = await db.collection("households").find({}, { projection: { person_id: 1, members: 1 } }).toArray();
const memberOf = (user_id: string) => {
  for (const h of households) {
    const m = (h.members as { user_id: string; role: Role }[]).find((x) => x.user_id === user_id);
    if (m) return { role: m.role, person_id: h.person_id as string };
  }
  return null;
};

// Cases the current data or decisions can't test are reported, not scored as failures.
function skipReason(c: Case): string | null {
  if (c.setup) return "needs a setup step (no harness for writes yet)";
  if (c.expect_status) return "expects unverified results; recall returns verified only now";
  if (!memberOf(c.as)) return `${c.as} has no household`;
  const missing = (c.must_include ?? []).find((k) => !known.has(k));
  if (missing) return `memory "${missing}" isn't in the current seed`;
  if (!c.must_include?.length && c.must_exclude?.length && c.must_exclude.every((k) => !known.has(k)))
    return `none of [${c.must_exclude.join(", ")}] are in the current seed`;
  return null;
}
const runnable = cases.filter((c) => !skipReason(c));
for (const c of cases) { const why = skipReason(c); if (why) console.log(`skip ${c.id}: ${why}`); }

// Dataset in LangSmith: one example per runnable case, keyed by the scenario id.
const client = new Client();
const dataset = (await client.hasDataset({ datasetName: DATASET }))
  ? await client.readDataset({ datasetName: DATASET })
  : await client.createDataset(DATASET, { description: "Keepsake read-path scenarios (tests/scenarios/read_path.json)" });
const have = new Set<string>();
for await (const ex of client.listExamples({ datasetId: dataset.id })) have.add(String(ex.metadata?.id));
const fresh = runnable.filter((c) => !have.has(c.id));
if (fresh.length) {
  await client.createExamples(fresh.map((c) => ({
    dataset_id: dataset.id,
    inputs: { as: c.as, query: c.query },
    outputs: { must_include: c.must_include ?? [], must_exclude: c.must_exclude ?? [], expect_empty: !!c.expect_empty },
    metadata: { id: c.id, note: c.note ?? null },
  })));
}

let first = true;
async function target(inputs: { as: string; query: string }) {
  if (!first && delay) await new Promise((r) => setTimeout(r, delay));
  first = false;
  const who = memberOf(inputs.as)!;
  const { candidates, degraded } = await search(who.person_id, readableScopes(who.role), inputs.query);
  const kept = applyCutoff(candidates);
  return { keys: kept.map((c) => keyOf.get(c._id.toString()) ?? `(${c.text})`), texts: kept.map((c) => c.text), degraded };
}

// One pass/fail per case, with every broken rule in the comment.
function rules({ outputs, referenceOutputs }: { outputs: Record<string, any>; referenceOutputs?: Record<string, any> }) {
  const keys: string[] = outputs.keys ?? [];
  const ref = referenceOutputs ?? {};
  const problems = [
    ...(ref.must_include ?? []).filter((k: string) => !keys.includes(k)).map((k: string) => `missing ${k}`),
    ...(ref.must_exclude ?? []).filter((k: string) => keys.includes(k)).map((k: string) => `leaked ${k}`),
    ...(ref.expect_empty && keys.length ? [`expected nothing, got ${keys.join(", ")}`] : []),
  ];
  return { key: "passes_rules", score: problems.length ? 0 : 1, comment: problems.join("; ") || "ok" };
}
// Rate limits or timeouts make search fall back; worth seeing separately from rule failures.
const searchHealthy = ({ outputs }: { outputs: Record<string, any> }) =>
  ({ key: "search_not_degraded", score: outputs.degraded ? 0 : 1, comment: outputs.degraded ?? "ok" });

const results = await evaluate(target, {
  data: dataset.name,
  evaluators: [rules, searchHealthy],
  experimentPrefix: "recall-rules",
  maxConcurrency: 1,
  metadata: { min_rerank_score: MIN_RERANK_SCORE },
  client,
});

let pass = 0;
for (const row of results.results) {
  const r = Object.fromEntries(row.evaluationResults.results.map((e) => [e.key, e]));
  const ok = r.passes_rules?.score === 1;
  if (ok) pass++;
  const deg = r.search_not_degraded?.score === 0 ? ` [degraded: ${r.search_not_degraded.comment}]` : "";
  console.log(`${ok ? "PASS" : "FAIL"} ${String(row.example.metadata?.id).padEnd(36)} ${r.passes_rules?.comment}${deg}`);
}
console.log(`\n${pass}/${results.results.length} passed. Experiment: ${results.experimentName}`);
process.exit(0);
