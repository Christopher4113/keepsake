import { body, route } from "@/lib/api";
import { reviewMemory } from "@/lib/writes";

// POST /api/memories/:id/review {decision: "confirm" | "deny"}: family decides a pending memory.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { decision } = await body(req);
  return route((s) => reviewMemory(s, id, decision));
}
