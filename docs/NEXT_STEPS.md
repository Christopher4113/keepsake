# Next steps

Items deferred from the MVP. See also the "Out of scope" section of `docs/specs/SPEC-memory.md`.

- Margaret adding memories by voice (`remember` tool / `POST /api/talk/remember`). Out of the MVP (A16). The ElevenLabs agent gets `recall` only.
- Leakage test.
- A `kind` field on memories.
- Live push notifications (change streams).
- An LLM classifier, if Q1 lands on rerank-only.
- related/unrelated labels.
- Time-series turns, and a retention rule for `turns` (no TTL today).
- Caregiver trace access: show a caregiver a turn only when every result is caregiver scope (D-A2).
- A `timezone` on households, used by `client/lib/time.ts` instead of America/Toronto (D-A5).
- Remove `@langchain/core` and `@langchain/mongodb` from `client/package.json`; recall no longer uses them.
