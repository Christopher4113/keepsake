import "server-only";
import type { Session } from "./auth";

// Server to server only: the browser never calls the user service, so no CORS.
const base = () => process.env.USER_SERVICE_URL ?? "http://127.0.0.1:4000";

export type Me = Session & { admin: boolean; person: { person_id: string; name: string | null; timezone: string | null } };
export type TeamMember = { user_id: string; name: string; role: Session["role"]; relation?: string; shift?: string };
export type NewUser = { name: string; email: string; password: string; role: "family" | "caregiver"; relation?: string; shift?: string };
export type ServiceError = Error & { status: number; code?: string };

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(base() + path, {
    ...rest,
    cache: "no-store",
    headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }), ...headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(body.error?.message ?? res.statusText), { status: res.status, code: body.error?.code }) as ServiceError;
  }
  return body as T;
}

export const userService = {
  login: (email: string, password: string) =>
    call<{ token: string; user: Session }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: (token: string) => call<Me>("/auth/me", { token }),
  careTeam: (token: string) => call<TeamMember[]>("/care-team", { token }),
  addUser: (token: string, u: NewUser) =>
    call<TeamMember & { email: string; person_id: string }>("/users", { method: "POST", token, body: JSON.stringify(u) }),
};
