// Picks MIN_RERANK_SCORE from the seed data: in-knowledge questions must clear it, out-of-knowledge ones must not.
// Read-only: calls search() directly, so no turns are written.
// Run from client/: npx tsx --env-file=.env scripts/calibrate-recall.mts
// On Voyage's free tier (3 requests/min) set CALIBRATE_DELAY_MS=40000: each question makes two calls.
import { search } from "../lib/recall";
import { SCOPES } from "../lib/memories";

// expect: a substring of the memory that should answer it, or null if nothing verified should.
const CASES: { q: string; expect: string | null }[] = [
  { q: "When does Ravi come?", expect: "Ravi visits on weekday mornings at 10" },
  { q: "Where are my reading glasses?", expect: "kitchen windowsill" },
  { q: "How do I like my tea?", expect: "morning tea" },
  { q: "When does Anna call me?", expect: "Anna calls every evening" },
  { q: "When is physio?", expect: "Physio visit" },
  { q: "What night does the garbage go out?", expect: "Garbage and recycling" },
  { q: "Where is the spare key?", expect: "blue bowl" },
  { q: "Where's my phone charger?", expect: "phone charger" },
  { q: "What are my grandchildren called?", expect: "Leo and Maya" },
  { q: "Who's bringing dinner?", expect: "bringing dinner" },
  { q: "Where do I live?", expect: "14 Elm Street" },
  { q: "When is Leo's party?", expect: "birthday party" },
  { q: "What's the weather like today?", expect: null },
  { q: "Who won the hockey game last night?", expect: null },
  { q: "What's my doctor's phone number?", expect: null },
  { q: "What is the capital of France?", expect: null },
  { q: "When is my sister Ruth visiting?", expect: null }, // only an unverified memory exists
  { q: "Which cardigan is my favourite?", expect: null }, // only an unverified memory exists
];

const fmt = (n: number | null | undefined) => (n == null ? "  -  " : n.toFixed(3));
const hits: number[] = [];
const misses: number[] = [];

const delay = Number(process.env.CALIBRATE_DELAY_MS ?? 0);
for (const [i, { q, expect }] of CASES.entries()) {
  if (i && delay) await new Promise((r) => setTimeout(r, delay));
  const { candidates, degraded } = await search("margaret", SCOPES.person, q);
  const top = candidates[0];
  if (expect) {
    const match = candidates.find((c) => c.text.includes(expect));
    const ok = match === top;
    if (match?.rerank_score != null) hits.push(match.rerank_score);
    console.log(`${ok ? "IN " : "IN!"} ${fmt(match?.rerank_score)}  ${q}  ->  ${match ? match.text : "NOT IN TOP 5"}${ok ? "" : `  (top: ${top?.text})`}${degraded ? ` [${degraded}]` : ""}`);
  } else {
    if (top?.rerank_score != null) misses.push(top.rerank_score);
    console.log(`OUT ${fmt(top?.rerank_score)}  ${q}  ->  ${top?.text ?? "(none)"}${degraded ? ` [${degraded}]` : ""}`);
  }
}

if (!hits.length || !misses.length) {
  console.log("\nnot enough reranked results to calibrate (rate limited or index not ready?)");
  process.exit(1);
}
const lo = Math.min(...hits);
const hi = Math.max(...misses);
console.log(`\nlowest in-knowledge score ${fmt(lo)}, highest out-of-knowledge score ${fmt(hi)}`);
console.log(lo > hi ? `clean gap: pick MIN_RERANK_SCORE around ${fmt((lo + hi) / 2)}` : "no clean gap: some questions will be wrong either way; look at the overlaps above");
process.exit(0);
