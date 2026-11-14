import type { FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import type { Collections, Role } from "./db.js";
import { HttpError } from "./errors.js";

// Same payload and signing as client/lib/auth.ts, so the web client keeps verifying
// its keepsake_session cookie locally with the shared AUTH_SECRET.
export type Session = { user_id: string; name: string; role: Role; person_id: string };

// The caller as the database sees them now. Role, household and admin come from
// `people`, not the token, so deactivating someone or changing a role applies at once.
export type AuthUser = Session & { admin: boolean };

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

const key = (secret: string) => new TextEncoder().encode(secret);

export const signSession = ({ user_id, name, role, person_id }: Session, secret: string, ttl: string) =>
  new SignJWT({ user_id, name, role, person_id })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user_id)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(key(secret));

const unauthorized = (message: string) => new HttpError(401, "unauthorized", message);

export const authenticate = (cols: Collections, secret: string) => async (req: FastifyRequest) => {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw unauthorized("Sign in required.");

  const user_id = await jwtVerify(token, key(secret), { algorithms: ["HS256"] }).then(
    ({ payload }) => payload.user_id,
    () => null,
  );
  if (typeof user_id !== "string") throw unauthorized("Session expired or invalid. Sign in again.");

  const doc = await cols.people.findOne(
    { user_id, active: true },
    { projection: { _id: 0, user_id: 1, name: 1, role: 1, person_id: 1, admin: 1 } },
  );
  if (!doc) throw unauthorized("This account no longer has access.");
  req.user = { ...doc, admin: doc.admin === true };
};

export async function requireFamilyAdmin(req: FastifyRequest) {
  if (req.user?.role !== "family" || !req.user.admin) {
    throw new HttpError(403, "forbidden", "Only a family admin can do that.");
  }
}
