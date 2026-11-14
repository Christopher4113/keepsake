// Adds the turns collection: one doc per recall, so the trace can show what the agent saw and said.
// Safe to rerun: creates the collection if missing, otherwise refreshes the validator.
// Run with: mongosh "$MONGODB_URI/$MONGODB_DB" db/migrations/005_turns.js

const NUM = { bsonType: ["double", "int", "long", "null"] };

const TURNS_VALIDATOR = {
  $jsonSchema: {
    bsonType: "object",
    required: ["schema_version", "person_id", "user_id", "at", "question", "results", "min_rerank_score"],
    properties: {
      schema_version:  { bsonType: ["int", "long"], minimum: 1 },
      person_id:       { bsonType: "string" },
      user_id:         { bsonType: "string" },
      conversation_id: { bsonType: ["string", "null"] },
      at:              { bsonType: "date" },
      question:        { bsonType: "string" },
      // Snapshot of what the agent was given, at question time.
      results: {
        bsonType: "array",
        maxItems: 5,
        items: {
          bsonType: "object",
          required: ["memory_id", "scope", "status", "author_role", "created_at"],
          properties: {
            memory_id:    { bsonType: "objectId" },
            text:         { bsonType: "string" },
            status:       { enum: ["unverified", "verified", "superseded", "retracted"] },
            scope:        { enum: ["family", "caregiver"] },  // A17: no private scope
            author_name:  { bsonType: ["string", "null"] },
            author_role:  { enum: ["person", "family", "caregiver"] },
            created_at:   { bsonType: "date" },
            vector_score: NUM,
            rerank_score: NUM
          }
        }
      },
      // Best rerank score seen, even if the cutoff dropped it: explains an empty answer.
      top_rerank_score: NUM,
      min_rerank_score: { bsonType: ["double", "int", "long"] },
      degraded:         { enum: [null, "embed_error", "rerank_timeout", "rerank_error", "regex"] },
      answer:           { bsonType: ["string", "null"] }
    }
  }
};

if (!db.getCollectionNames().includes("turns")) {
  db.createCollection("turns", { validator: TURNS_VALIDATOR, validationAction: "error" });
  print("created turns");
} else {
  db.runCommand({ collMod: "turns", validator: TURNS_VALIDATOR, validationAction: "error" });
  print("turns validator refreshed");
}

// Trace list: a person's turns, newest first.
db.turns.createIndex({ person_id: 1, at: -1 });
printjson(db.turns.getIndexes().map(i => i.name));
