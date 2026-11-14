import { route } from "@/lib/api";
import { forgetMemory } from "@/lib/writes";

// DELETE /api/memories/:id: family forgets a memory. Contract: docs/api-writes.yaml.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return route((s) => forgetMemory(s, id));
}
