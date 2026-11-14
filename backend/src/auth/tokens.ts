import { SignJWT, jwtVerify } from "jose";
import type { Role } from "../db.js";

// Same shape and signing as client/lib/auth.ts (web branch), so the Next app can keep
// verifying keepsake_session locally with its own jose code.
export type Session = { user_id: string; name: string; role: Role; person_id: string };

const key = (secret: string) => new TextEncoder().encode(secret);

export function signSession(s: Session, secret: string, ttl: string) {
  const { user_id, name, role, person_id } = s; // never leak extra fields into the token
  return new SignJWT({ user_id, name, role, person_id })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user_id)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(key(secret));
}

export async function verifySession(token: string, secret: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    if (typeof payload.user_id !== "string") return null;
    return payload as unknown as Session;
  } catch {
    return null; // expired, tampered or malformed
  }
}
