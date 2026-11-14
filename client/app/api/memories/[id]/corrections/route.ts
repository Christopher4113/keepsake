import { body, flag, route, savedStatus } from "@/lib/api";
import { correctMemory } from "@/lib/writes";

// POST /api/memories/:id/corrections: family replaces a verified memory with new text.
// The old memory is kept as superseded. 201 when saved, 200 when it needs confirmation first.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req);
  const input = { text: b.text as string, confirm: flag(b.confirm), confirm_supersedes: b.confirm_supersedes as string | undefined };
  return route((s) => correctMemory(s, id, input), savedStatus);
}
