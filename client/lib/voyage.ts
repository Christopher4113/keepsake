// Voyage AI client: embeddings for storage and search, rerank for ordering search hits.
// One documented constant set (R12): voyage-3.5, 1024 dims, cosine; input_type document on write, query on recall.

export const EMBED_MODEL = "voyage-3.5";
export const RERANK_MODEL = "rerank-2.5";

// Recall runs inside a live voice turn, so callers fail fast instead of retrying.
export const EMBED_TIMEOUT_MS = 3000;
export const RERANK_TIMEOUT_MS = 2000;

export type InputType = "document" | "query";
export type Reranked = { index: number; relevance_score: number };

// kind "timeout": we aborted. "http": Voyage answered with a non-2xx status (429, 5xx, or a 4xx bug/bad key).
// "network": the request never got an answer.
export class VoyageError extends Error {
  constructor(public kind: "timeout" | "http" | "network", message: string, public status?: number) {
    super(message);
    this.name = "VoyageError";
  }
}

async function call<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://api.voyageai.com/v1/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new VoyageError("timeout", `Voyage ${path} timed out after ${timeoutMs}ms`);
    }
    throw new VoyageError("network", `Voyage ${path} failed: ${err.message}`);
  }
  if (!res.ok) throw new VoyageError("http", `Voyage ${path} ${res.status}: ${await res.text()}`, res.status);
  return res.json() as Promise<T>;
}

// Returns one 1024-dim vector per input text, in input order.
export async function embed(texts: string[], input_type: InputType, timeoutMs = EMBED_TIMEOUT_MS): Promise<number[][]> {
  const { data } = await call<{ data: { index: number; embedding: number[] }[] }>(
    "embeddings", { input: texts, model: EMBED_MODEL, input_type }, timeoutMs,
  );
  return data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// Scores each doc against the query; returns the top_k, best first. index points into docs.
export async function rerank(query: string, docs: string[], top_k: number, timeoutMs = RERANK_TIMEOUT_MS): Promise<Reranked[]> {
  if (!docs.length) return [];
  const { data } = await call<{ data: Reranked[] }>(
    "rerank", { query, documents: docs, model: RERANK_MODEL, top_k: Math.min(top_k, docs.length) }, timeoutMs,
  );
  return data;
}
