import { route } from "@/lib/api";
import { listReviews } from "@/lib/writes";

// GET /api/reviews: the family review queue, newest first (R23). Contract: docs/api-writes.yaml.
export async function GET() {
  return route(async (s) => ({ reviews: await listReviews(s) }));
}
