import { TZ } from "@/lib/time";

// Trace times are shown in the household's timezone, wherever the viewer is.
export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });

export const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ, dateStyle: "medium" });

export const score = (n: number | null) => (n == null ? "–" : n.toFixed(2));

export const DEGRADED: Record<string, string> = {
  embed_error: "Couldn't read the question (Voyage embed failed), so nothing was recalled",
  rerank_timeout: "Rerank timed out; memories were ordered by vector score",
  rerank_error: "Rerank failed; memories were ordered by vector score",
  regex: "Vector index unavailable; matched by keywords",
};
