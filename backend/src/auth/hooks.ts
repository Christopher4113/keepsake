import type { FastifyReply, FastifyRequest } from "fastify";
import type { Collections, Role } from "../db.js";
import { forbidden, unauthorized } from "../errors.js";
import { verifySession } from "./tokens.js";

// The caller as the database sees them right now. Role, household and admin come from
// `people`, not the token, so removing someone or changing their role applies at once.
export type AuthUser = { user_id: string; name: string; role: Role; person_id: string; admin: boolean };

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export function makeRequireAuth(cols: Collections, secret: string) {
  return async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) throw unauthorized();

    const session = await verifySession(token, secret);
    if (!session) throw unauthorized("Session expired or invalid. Sign in again.");

    const doc = await cols.people.findOne(
      { user_id: session.user_id, active: true },
      { projection: { _id: 0, user_id: 1, name: 1, role: 1, person_id: 1, admin: 1 } },
    );
    if (!doc) throw unauthorized("This account no longer has access.");

    req.user = { ...doc, admin: doc.admin === true };
  };
}

export async function requireFamilyAdmin(req: FastifyRequest) {
  if (!req.user) throw unauthorized();
  if (req.user.role !== "family" || !req.user.admin) throw forbidden("Only a family admin can do that.");
}
