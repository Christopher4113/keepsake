# Database

1. `mongosh "$MONGODB_URI/keepsake" db/schema.js` creates collections, validation, TTL and indexes.
2. Create the Atlas Vector Search index from `vector_index.json` (Atlas UI, Search, JSON editor). 1024 dims matches Voyage `voyage-3.5`.
3. `mongosh "$MONGODB_URI/keepsake" db/seed.js` resets demo data. Embeddings start empty; the backend fills them.

Env lives in `client/.env`. Demo logins: `<user_id>@keepsake.test` (margaret, anna, ravi, harold, sam), password `keepsake`.

`queries.js` holds reference versions of role-scoped retrieval, correction and forget.

Memory fields: `kind` is routine, event, fact or preference. `scope` is private, family or caregiver. `status` is unverified, verified, superseded or retracted.

Role read rules: person reads private, family and caregiver. Family reads family and caregiver. Caregiver reads caregiver only.
