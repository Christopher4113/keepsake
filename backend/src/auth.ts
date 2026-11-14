import type { FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { findMembership, type Collections, type HouseholdDoc, type Role } from "./db.js";
import { HttpError } from "./errors.js";

// Same payload and signing as client/lib/auth.ts, so the web client keeps verifying
// its keepsake_session cookie locally with the shared AUTH_SECRET.
export type Session = { user_id: string; name: string; role: Role; person_id: string };

// The caller as households sees them now. Role, household and admin are re-read on every
// request, so removing someone from a household or changing their role applies at once.
export type AuthUser = Session & { admin: boolean; household: HouseholdDoc };

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

  const found = await findMembership(cols, user_id);
  if (!found) throw unauthorized("This account no longer has access.");
  const { household, member } = found;
  req.user = { user_id, name: member.name, role: member.role, person_id: household.person_id, admin: member.admin === true, household };
};

export async function requireFamilyAdmin(req: FastifyRequest) {
  if (req.user?.role !== "family" || !req.user.admin) {
    throw new HttpError(403, "forbidden", "Only a family admin can do that.");
  }
}
