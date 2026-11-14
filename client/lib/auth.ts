import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";

export type Role = "person" | "family" | "caregiver";
// person_id is the household link: Anna and Ravi both carry person_id "margaret".
export type Session = { user_id: string; name: string; role: Role; person_id: string };

const COOKIE = "keepsake_session";
const key = () => new TextEncoder().encode(process.env.AUTH_SECRET);

export async function createSession(s: Session) {
  const token = await new SignJWT(s).setProtectedHeader({ alg: "HS256" }).setExpirationTime("7d").sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 7,
  });
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return payload as unknown as Session;
  } catch {
    return null; // expired or tampered
  }
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export const homeFor = (role: Role) => (role === "person" ? "/talk" : "/dashboard");

// For pages, actions and route handlers: redirects if signed out or the wrong role.
export async function requireSession(roles?: Role[]) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (roles && !roles.includes(s.role)) redirect(homeFor(s.role));
  return s;
}
