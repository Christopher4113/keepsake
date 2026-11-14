# User service

Login, who-am-I, care team and adding users for Keepsake. It uses the data model on `main` (see `db/README.md`): `people` holds logins only (`user_id`, `name`, `email`, `password_hash`), and `households.members[]` holds membership and roles (`role`, `admin`, `relation`, `shift`). Memory endpoints live in the memory service (`docs/memory-service-plan.md`).

## Run

From the repo root, fill in `.env` (see `.env.example`). `AUTH_SECRET` must be the **same value** as the web client's.

```sh
mongosh "$MONGODB_URI/$MONGODB_DB" db/schema.js   # collections + indexes
mongosh "$MONGODB_URI/$MONGODB_DB" db/create_vector_index.js
.venv/bin/python db/seed.py                        # demo households and memories (logins in people are kept)
cd backend && npm install && npm run dev           # http://127.0.0.1:4000
npm test                                           # offline, uses mongodb-memory-server
```

Demo logins: `<user_id>@keepsake.test`, password `keepsake`. The users are margaret (person), anna (family admin), ravi (caregiver), and harold and sam (second household).

## Auth model

- `POST /auth/login` returns an HS256 JWT signed with `AUTH_SECRET`. Its payload is `{user_id, name, role, person_id}`, the same as `client/lib/auth.ts`, and it expires in 7 days.
- Every other endpoint needs `Authorization: Bearer <token>`. On each request the service re-reads the caller's membership from `households` (the `whoami` lookup in `db/queries.js`). Removing someone from `members` cuts their access immediately. Role, household and `admin` always come from the database, never from the token.
- The service also accepts tokens the web client signs itself (same secret, same payload).

## Endpoints

All errors look like `{ "error": { "code": "...", "message": "..." } }`.

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/health` | none | `{ok, mongo: "up" \| "down"}` (503 when down) |
| POST | `/auth/login` | none | `{token, user: {user_id, name, role, person_id}}`. 401 `invalid_credentials` |
| GET | `/auth/me` | any | `{user_id, name, role, person_id, admin, person: {person_id, name, timezone}}` |
| GET | `/care-team` | any | `[{user_id, name, role, relation?, shift?}]` for the caller's household only |
| POST | `/users` | family admin | Body `{name, email, password (8–72), role: "family" \| "caregiver", relation?, shift?}`. Returns 201 with the user. 403 if the caller isn't an admin, 409 `email_taken`. Always added to the caller's household. |

```sh
TOKEN=$(curl -s localhost:4000/auth/login -H 'content-type: application/json' \
  -d '{"email":"anna@keepsake.test","password":"keepsake"}' | jq -r .token)
curl -s localhost:4000/auth/me -H "authorization: Bearer $TOKEN"
curl -s localhost:4000/care-team -H "authorization: Bearer $TOKEN"
```

## Using it from the web client (`client/`)

Add `USER_SERVICE_URL=http://127.0.0.1:4000` to `client/.env`. Calls go server to server (server actions and server components), so the browser never talks to this service and no CORS is needed.

`client/lib/userService.ts`:

```ts
import "server-only";
import type { Session } from "./auth";

const base = () => process.env.USER_SERVICE_URL ?? "http://127.0.0.1:4000";

export type Me = Session & { admin: boolean; person: { person_id: string; name: string | null; timezone: string | null } };
export type TeamMember = { user_id: string; name: string; role: Session["role"]; relation?: string; shift?: string };

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(base() + path, {
    ...rest,
    cache: "no-store",
    headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }), ...headers },
  });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error?.message ?? res.statusText), { status: res.status, code: body.error?.code });
  return body as T;
}

export const userService = {
  login: (email: string, password: string) =>
    call<{ token: string; user: Session }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: (token: string) => call<Me>("/auth/me", { token }),
  careTeam: (token: string) => call<TeamMember[]>("/care-team", { token }),
  addUser: (token: string, u: { name: string; email: string; password: string; role: "family" | "caregiver"; relation?: string; shift?: string }) =>
    call<TeamMember & { email: string; person_id: string }>("/users", { method: "POST", token, body: JSON.stringify(u) }),
};
```

Login action (`client/app/login/actions.ts`): replace the Mongo and bcrypt lookup with the service, and store **its** token in the cookie:

```ts
try {
  const { token, user } = await userService.login(email, password);
  await setSessionCookie(token);           // same cookie options as createSession(), just set the given token
  redirect(homeFor(user.role));
} catch (e) {
  if ((e as { status?: number }).status === 401) return "Email or password is incorrect.";
  throw e;
}
```

To pass the token to other calls, add a `getToken()` next to `getSession()` that returns the raw `keepsake_session` cookie value. The dashboard's care circle then becomes `await userService.careTeam(await getToken())` instead of reading `household.members` directly.

## Voice agent (ElevenLabs)

In the web client, the voice agent runs as Margaret through her login. `/api/talk/session` gets an ElevenLabs signed URL for a `person` session, and the agent's tools call `/api/talk/recall` and `/api/talk/remember`, which read the same `keepsake_session` cookie. So the agent needs no separate login. When those routes call a backend service, they forward the cookie token as `Authorization: Bearer`.

If the agent later calls this API directly through ElevenLabs webhook tools, pass the token as the `secret__keepsake_token` dynamic variable and send `Authorization: Bearer {{secret__keepsake_token}}`. `secret__` variables are never shown to the LLM.

## Data model notes

- Login checks the password against `people`, then finds the household with `members.user_id`. A login with no household gets 403 `no_household`.
- `POST /users` writes a login to `people` (with `schema_version`), then pushes a member onto the admin's household. If the push fails, for example because the household already has 50 members, the login is deleted again.
- `/auth/me` returns `person.timezone` from `households.timezone`. It is `null` until the seed sets it.
