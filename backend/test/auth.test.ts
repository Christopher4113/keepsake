import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, PASSWORD, SECRET, SEED_HASH, setup } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { t = await setup(); });
beforeEach(async () => { await t.reset(); });
afterAll(async () => { await t.teardown(); });

describe("seed", () => {
  it("demo hash is the password 'keepsake'", async () => {
    expect(await bcrypt.compare(PASSWORD, SEED_HASH)).toBe(true);
  });
});

describe("POST /auth/login", () => {
  it("returns a token and the public user", async () => {
    const res = await t.app.inject({ method: "POST", url: "/auth/login", payload: { email: "Anna@Keepsake.test ", password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toEqual({ user_id: "anna", name: "Anna", role: "family", person_id: "margaret" });
    expect(JSON.stringify(body)).not.toContain("password_hash");
  });

  it("token verifies the way client/lib/auth.ts does it", async () => {
    const token = await t.login("ravi");
    // Copy of the client's getSession(): jwtVerify with TextEncoder(AUTH_SECRET), payload cast to Session.
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    expect(payload).toMatchObject({ user_id: "ravi", name: "Ravi", role: "caregiver", person_id: "margaret" });
    expect(payload.exp! - payload.iat!).toBe(7 * 24 * 60 * 60);
  });

  it.each([
    ["wrong password", { email: "anna@keepsake.test", password: "nope" }],
    ["unknown email", { email: "nobody@keepsake.test", password: PASSWORD }],
    ["deactivated user", { email: "former@keepsake.test", password: PASSWORD }],
  ])("rejects %s with the same generic error", async (_label, payload) => {
    const res = await t.app.inject({ method: "POST", url: "/auth/login", payload });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: "invalid_credentials", message: "Email or password is incorrect." } });
  });

  it("validates the body", async () => {
    const res = await t.app.inject({ method: "POST", url: "/auth/login", payload: { email: "not-an-email" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });
});

describe("GET /auth/me", () => {
  it("returns role, admin flag and the person's household", async () => {
    const res = await t.app.inject({ method: "GET", url: "/auth/me", headers: bearer(await t.login("anna")) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user_id: "anna", name: "Anna", role: "family", person_id: "margaret", admin: true,
      person: { person_id: "margaret", name: "Margaret", timezone: "America/Toronto" },
    });
  });

  it("accepts a token minted by the web client with the shared secret", async () => {
    // What client/lib/auth.ts createSession() signs today.
    const token = await new SignJWT({ user_id: "margaret", name: "Margaret", role: "person", person_id: "margaret" })
      .setProtectedHeader({ alg: "HS256" }).setExpirationTime("7d").sign(new TextEncoder().encode(SECRET));
    const res = await t.app.inject({ method: "GET", url: "/auth/me", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user_id: "margaret", role: "person", admin: false });
  });

  it("uses the database role, not the token's claims", async () => {
    const forged = await new SignJWT({ user_id: "ravi", name: "Ravi", role: "family", person_id: "harold" })
      .setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(SECRET));
    const res = await t.app.inject({ method: "GET", url: "/auth/me", headers: bearer(forged) });
    expect(res.json()).toMatchObject({ role: "caregiver", person_id: "margaret" });
  });

  it.each([
    ["no header", {}],
    ["garbage token", bearer("abc.def.ghi")],
  ])("401s with %s", async (_label, headers) => {
    const res = await t.app.inject({ method: "GET", url: "/auth/me", headers });
    expect(res.statusCode).toBe(401);
  });

  it("401s with a token signed by another secret", async () => {
    const token = await new SignJWT({ user_id: "anna" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h")
      .sign(new TextEncoder().encode("some-other-secret-some-other-secret-1234"));
    const res = await t.app.inject({ method: "GET", url: "/auth/me", headers: bearer(token) });
    expect(res.statusCode).toBe(401);
  });

  it("401s an expired token", async () => {
    const token = await new SignJWT({ user_id: "anna" }).setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(new TextEncoder().encode(SECRET));
    const res = await t.app.inject({ method: "GET", url: "/auth/me", headers: bearer(token) });
    expect(res.statusCode).toBe(401);
  });

  it("401s right away once the user is deactivated", async () => {
    const token = await t.login("ravi");
    await t.cols.people.updateOne({ user_id: "ravi" }, { $set: { active: false } });
    const res = await t.app.inject({ method: "GET", url: "/auth/me", headers: bearer(token) });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /health", () => {
  it("reports mongo up", async () => {
    const res = await t.app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toEqual({ ok: true, mongo: "up" });
  });
});
