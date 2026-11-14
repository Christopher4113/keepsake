# User service plan

Status: implemented in `backend/` (see `backend/README.md`). Secrets (`MONGODB_URI`, `AUTH_SECRET`) are supplied later.

## Scope

The user service owns **who someone is and what role they have**:

- Login (email + password) for the web client
- Who am I (`/auth/me`) and the household care team
- Admin-only user creation
- Issuing the JWT that the web client, the ElevenLabs agent and the memory service all trust

Out of scope: anything touching `memories`, which goes in a separate PR (see `docs/memory-service-plan.md`). Also out of scope: device pairing, preferred name, time-limited caregiver access, an audit trail for user changes, and multiple people per user.

## Decisions

| Area | Decision |
|---|---|
| Stack | Node + TypeScript, Fastify + `fastify-type-provider-zod`, native `mongodb`, `bcryptjs`, `jose`, `vitest` + `mongodb-memory-server` |
| Location | `backend/`, a sibling of the web branch's `client/` |
| Users | `people` (one doc per user: credentials, role, `admin`, `active`) with `person_id` as the foreign key to `households` (one doc per person: `timezone`). Unique `user_id` and `email`. |
| Login | Email + password, checked with `bcryptjs`. Emails are lowercased. Errors are generic ("Email or password is incorrect."). |
| Token | HS256 JWT signed with the shared `AUTH_SECRET`. Payload `{user_id, name, role, person_id}`, the same as `client/lib/auth.ts`. Expires in 7 days, the same as the client cookie. |
| Web client | The login server action calls `POST /auth/login` and stores the returned token in `keepsake_session` as it does today. `requireSession` keeps verifying locally. Next calls our APIs server to server with `Authorization: Bearer`, so the browser needs no CORS. |
| Revocation | API requests load the caller's `people` doc by `user_id` (indexed) and reject it if it's missing or `active: false`. `admin` comes from the DB, not the token. |
| Agent | `/talk` reads Margaret's session token on the server and passes it to ElevenLabs as the dynamic variable `secret__keepsake_token`. The webhook tools send `Authorization: Bearer {{secret__keepsake_token}}`. The agent runs as role `person`. |
| User creation | `POST /users` is for family admins only. `person_id` is forced to the admin's own household. Roles allowed: `family`, `caregiver`. |
| Care team | `GET /care-team` returns the caller's household only: `{user_id, name, role, relation, shift}`, with no email or credentials. Any role can call it. |
| Person profile | `timezone` on the person's doc (Margaret and Harold: `America/Toronto`) |
| Caregiver shift | Display label only |
| Client changes | Not in this PR. The README ships a typed contract and a ready-to-paste `client/lib/userService.ts` for the web owner. |
| Public URL | Local with a tunnel during the build, then deploy once before 3:30 as a backup |

## Database prerequisite (branch `db-people-households`, lands on `main` first)

`main` (PR #1) had a `households` doc with an embedded `members[]`. The web branch had a flat `people` collection. The decision was both, joined by a foreign key:

- `households`: `{person_id (unique), timezone}`, for household-level settings only.
- `people`: `{user_id (unique), name, email (unique), password_hash, role, person_id → households, admin?, active, relation?, shift?}`. Membership lives only here.
- `seed.py`: demo logins `<user_id>@keepsake.test` / `keepsake`, and Harold and Sam as the second household. Memories stay without `kind`.

## Endpoints

| Endpoint | Auth | Request → response |
|---|---|---|
| `GET /health` | none | → `{ok: true, mongo: "up"}` |
| `POST /auth/login` | none | `{email, password}` → `{token, user: {user_id, name, role, person_id}}`. 401 with a generic message on failure. |
| `GET /auth/me` | Bearer | → `{user_id, name, role, admin, person: {person_id, name, timezone}}` |
| `GET /care-team` | Bearer | → `[{user_id, name, role, relation?, shift?}]` for the caller's `person_id` |
| `POST /users` | Bearer, family + admin | `{name, email, password, role, relation?, shift?}` → the created user (no hash). 409 on a duplicate email. `user_id` is a slug from the name plus a suffix if needed. |

Errors use one shape: `{error: {code, message}}`.

## Layout

```
backend/
  package.json  tsconfig.json  .env.example
  src/
    server.ts          buildApp() + listen
    config.ts          zod-parsed env: MONGODB_URI, MONGODB_DB, AUTH_SECRET, PORT
    db.ts              Mongo client, typed `people` collection
    auth/tokens.ts     sign / verify (jose, HS256, same payload as client)
    auth/hooks.ts      requireAuth (verify + load active user), requireAdmin
    routes/auth.ts     /auth/login, /auth/me
    routes/users.ts    /care-team, POST /users
  test/
    auth.test.ts       login ok/bad, token shape matches client, me
    users.test.ts      care-team is household-only (Harold never in Margaret's), admin-only create, person_id forced, deactivated user rejected
  README.md            run steps, curl examples, client contract + userService.ts snippet
```

## Build order

1. DB prerequisite PR on `main`: web's `db/` without `kind`, plus `timezone`.
2. Scaffold `backend/`: config, Mongo connection, `/health`.
3. Tokens and hooks, with tests including "the token verifies with the client's `jose` code".
4. `/auth/login` and `/auth/me`.
5. `/care-team` and `POST /users`, with leakage and admin tests.
6. README contract for the web owner and the agent owner.

## Notes

- The Voyage key and Atlas password are in plain text in the planning Google doc. Rotate them after the hackathon. `.env` is never committed.
- Login has no rate limiting. That's fine for a demo, and the note is kept here.
- `client/lib/vectorstore.ts` queries Atlas from Next. The memory service plan should move that behind the memory service.
