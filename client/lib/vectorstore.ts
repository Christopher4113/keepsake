import { Embeddings } from "@langchain/core/embeddings";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { getDb } from "./db";
import { embed } from "./voyage";

// LangChain adapter over lib/voyage.ts, kept only until recall moves to a raw $vectorSearch.
class VoyageEmbeddings extends Embeddings {
  constructor() { super({}); }
  embedDocuments(texts: string[]) { return embed(texts, "document"); }
  async embedQuery(text: string) { return (await embed([text], "query"))[0]; }
}

export const embeddings = new VoyageEmbeddings();

// Matches db/schema.js + db/vector_index.json.
export async function memoryStore() {
  const db = await getDb();
  return new MongoDBAtlasVectorSearch(embeddings, {
    collection: db.collection("memories"),
    indexName: "memory_vec",
    textKey: "text",
    embeddingKey: "embedding",
  });
}
