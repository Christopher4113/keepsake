// Creates the Atlas vector index from db/vector_index.json if missing, then embeds memories with no embedding.
// Run from client/: node --env-file=.env scripts/setup-vectors.mjs
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";

const index = JSON.parse(readFileSync(new URL("../../db/vector_index.json", import.meta.url)));
const client = await new MongoClient(process.env.MONGODB_URI).connect();
const memories = client.db(process.env.MONGODB_DB ?? "keepsake").collection("memories");

const existing = await memories.listSearchIndexes(index.name).toArray();
if (existing.length) console.log(`index ${index.name}: ${existing[0].status}`);
else {
  await memories.createSearchIndex({ name: index.name, type: index.type, definition: index.definition });
  console.log(`index ${index.name}: created (builds in about a minute)`);
}

const todo = await memories.find({ $or: [{ embedding: { $size: 0 } }, { embedding: { $exists: false } }] }, { projection: { text: 1 } }).toArray();
for (let i = 0; i < todo.length; i += 64) {
  const batch = todo.slice(i, i + 64);
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
    body: JSON.stringify({ input: batch.map((d) => d.text), model: "voyage-3.5", input_type: "document" }),
  });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  const { data } = await res.json();
  await memories.bulkWrite(batch.map((d, j) => ({ updateOne: { filter: { _id: d._id }, update: { $set: { embedding: data[j].embedding } } } })));
}
console.log(`embedded ${todo.length} memories`);
await client.close();
