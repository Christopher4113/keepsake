import { Document } from "@langchain/core/documents";
import { Embeddings } from "@langchain/core/embeddings";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import type { Collection, Db, Document as MongoDoc } from "mongodb";
import { embed, EMBED_TIMEOUT_MS, type InputType } from "./voyage";

// R16 / A7. LangChain's own default is 10 * k (200 at this limit); recall was calibrated at 100.
export const NUM_CANDIDATES = 100;
export const VECTOR_LIMIT = 20;

const INDEX_NAME = "memory_vec";
const EMBEDDING_KEY = "embedding";

// LangChain adapter over lib/voyage.ts. input_type stays document on write and query on recall (R12).
// The LangChain caller is not used: recall fails fast, and writes retry in withRetry.
class VoyageEmbeddings extends Embeddings {
  constructor(private readonly timeoutMs = EMBED_TIMEOUT_MS) { super({}); }
  embedDocuments(texts: string[]) { return embed(texts, "document", this.timeoutMs); }
  async embedQuery(text: string) { return (await embed([text], "query", this.timeoutMs))[0]; }
}

const embeddings = new VoyageEmbeddings();

export function embedTexts(texts: string[], input_type: InputType, timeoutMs = EMBED_TIMEOUT_MS) {
  const model = timeoutMs === EMBED_TIMEOUT_MS ? embeddings : new VoyageEmbeddings(timeoutMs);
  if (input_type === "query") return Promise.all(texts.map((text) => model.embedQuery(text)));
  return model.embedDocuments(texts);
}

type AtlasFilter = Parameters<MongoDBAtlasVectorSearch["similaritySearchVectorWithScore"]>[2];

// Same pre-filter, index, and candidate count the raw aggregation used.
class MemoryVectorStore extends MongoDBAtlasVectorSearch {
  constructor(private readonly memories: Collection) {
    super(embeddings, {
      collection: memories,
      indexName: INDEX_NAME,
      textKey: "text",
      embeddingKey: EMBEDDING_KEY,
    });
  }

  override async similaritySearchVectorWithScore(query: number[], k: number, filter?: AtlasFilter) {
    const pipeline = [
      { $vectorSearch: {
        index: INDEX_NAME,
        path: EMBEDDING_KEY,
        queryVector: query,
        numCandidates: NUM_CANDIDATES,
        limit: k,
        ...(filter?.preFilter && { filter: filter.preFilter }),
      } },
      { $set: { score: { $meta: "vectorSearchScore" } } },
      { $project: { [EMBEDDING_KEY]: 0 } },
    ];
    const rows = await this.memories.aggregate<MongoDoc>(pipeline).toArray();
    return rows.map((result) => {
      const { score, text, ...metadata } = result;
      return [new Document({ pageContent: text ?? "", metadata }), score as number] as [Document, number];
    });
  }
}

export function memoryStore(db: Db) {
  return new MemoryVectorStore(db.collection("memories"));
}

// Full memory document, embedding removed, plus the vector search score.
export async function searchMemories(db: Db, vector: number[], k: number, preFilter: MongoDoc) {
  const hits = await memoryStore(db).similaritySearchVectorWithScore(vector, k, { preFilter });
  return hits.map(([doc, score]) => ({
    doc: { ...doc.metadata, text: doc.pageContent } as MongoDoc,
    score,
  }));
}
