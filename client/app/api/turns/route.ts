import { getMemberSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { canViewTrace, listTurns } from "@/lib/turns";

// The trace list, newest first. Family only (D-A2). Contract: docs/api-reads.yaml.
export async function GET(req: Request) {
  const s = await getMemberSession();
  if (!s) return apiError("unauthorized", "Sign in required");
  if (!canViewTrace(s)) return apiError("forbidden", "Only family can view the trace");

  const params = new URL(req.url).searchParams;
  const limit = params.has("limit") ? Number(params.get("limit")) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return apiError("bad_request", "limit must be 1-100");
  const before = params.has("before") ? new Date(params.get("before")!) : undefined;
  if (before && Number.isNaN(before.getTime())) return apiError("bad_request", "before must be a date-time");

  return Response.json({ turns: await listTurns(s, { limit, before }) });
}
