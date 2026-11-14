import { getSession, type Session } from "./auth";
import { apiError } from "./http";
import { ConfirmMismatch, WriteError } from "./writes";

// Runs a route body for a signed-in caller and maps write-path errors to HTTP (docs/api-writes.yaml).
export async function route<T>(fn: (s: Session) => Promise<T>, statusOf: (result: T) => number = () => 200) {
  const s = await getSession();
  if (!s) return apiError("unauthorized", "Sign in required");
  try {
    const result = await fn(s);
    return Response.json(result, { status: statusOf(result) });
  } catch (e) {
    if (e instanceof WriteError) return apiError(e.code, e.message);
    // R21: a stale confirm gets a fresh needs-confirmation payload, not the error shape.
    if (e instanceof ConfirmMismatch) return Response.json(e.payload, { status: 409 });
    throw e;
  }
}

// JSON body, or {} when it's missing or malformed (the write functions validate fields).
export const body = async (req: Request) => (await req.json().catch(() => ({}))) as Record<string, unknown>;

// 201 when a write saved something, 200 when it only asked for confirmation.
export const savedStatus = (r: object) => ("saved" in r ? 201 : 200);

// Accepts true or "true", for clients that post forms.
export const flag = (v: unknown) => v === true || v === "true";
