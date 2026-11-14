import { Embeddings } from "@langchain/core/embeddings";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { getDb } from "./db";

// ponytail: direct Voyage REST call; @langchain/community has a VoyageEmbeddings but its peer deps conflict with core v1.
class VoyageEmbeddings extends Embeddings {
  constructor(private model = "voyage-3.5") { super({}); }

  private async embed(input: string[], input_type: "document" | "query") {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
      body: JSON.stringify({ input, model: this.model, input_type }),
    });
    if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
    const { data } = await res.json();
    return data.map((d: { embedding: number[] }) => d.embedding) as number[][];
  }

  embedDocuments(texts: string[]) { return this.embed(texts, "document"); }
  async embedQuery(text: string) { return (await this.embed([text], "query"))[0]; }
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
