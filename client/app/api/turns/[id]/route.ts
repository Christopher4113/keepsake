import { getMemberSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { canViewTrace, getTurn } from "@/lib/turns";

// One turn with every memory the agent was given. Family only (D-A2). Contract: docs/api-reads.yaml.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getMemberSession();
  if (!s) return apiError("unauthorized", "Sign in required");
  if (!canViewTrace(s)) return apiError("forbidden", "Only family can view the trace");

  const turn = await getTurn(s, (await ctx.params).id);
  return turn ? Response.json(turn) : apiError("not_found", "Turn not found");
}
