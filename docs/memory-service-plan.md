# Memory service plan (parked)

Status: parked. It ships in a separate PR after the user service, which provides the tokens this service trusts (see `docs/user-service-plan.md`).

## Scope

Everything that reads or writes `memories`: search, list, create, verify, correct (versioned), rescope and forget. Per the brief, this service is the only thing that queries `memories` in Atlas.

## Draft endpoints

| Endpoint | Roles | Behaviour |
|---|---|---|
| `POST /search {query, limit}` | all | Voyage embed (`input_type=query`), then `$vectorSearch` on `memory_vec` filtered by `person_id`, role scopes and status, then rerank. Returns `{id, text, scope, status, score}`. Falls back to `$match` plus regex if the index isn't ready. |
| `GET /memories?status=&flagged=` | family, caregiver | Review queue limited to the caller's scopes. |
| `POST /memories/:id/verify` | family | `unverified` → `verified`, clears `flagged`, writes audit. |
| `POST /memories` | person, caregiver | Person: unverified and flagged. Caregiver: caregiver-scope note. |
| correct / rescope / forget | family | Pattern from `db/queries.js`. |

## Role rules

| Role | Reads | Writes |
|---|---|---|
| person | private, family, caregiver | New unverified memories |
| family | family, caregiver | Verify, correct, rescope, forget |
| caregiver | caregiver | Shift notes in caregiver scope |

The scope filter goes inside `$vectorSearch.filter`. `role` and `person_id` come from the token. Anything outside the caller's scope returns 404.

## Open questions (parked from grill round 1)

- Should `/search` return unverified memories tagged with `status` (recommended), or verified only?
- Rerank with `rerank-2.5`? Recommended: yes, behind a flag, falling back to vector order.
- Which scope does a memory the person creates get? Recommended: always `family`, so it reaches the flag queue.
- What does verify do to `expires_at`? Recommended: keep the value by default and let the body override it.
- Test DB: separate `keepsake_test` with its own vector index? Recommended: yes.
- `audit_log` is written directly until the change stream exists.
