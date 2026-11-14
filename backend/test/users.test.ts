import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, setup } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { t = await setup(); });
beforeEach(async () => { await t.reset(); });
afterAll(async () => { await t.teardown(); });

const newUser = { name: "Mary Ann", email: "Mary@Keepsake.test", password: "longenough", role: "caregiver", shift: "weekends" };

describe("GET /care-team", () => {
  it.each(["margaret", "anna", "ravi"])("%s sees Margaret's household only, without credentials", async (who) => {
    const res = await t.app.inject({ method: "GET", url: "/care-team", headers: bearer(await t.login(who)) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { user_id: "margaret", name: "Margaret", role: "person" },
      { user_id: "anna", name: "Anna", role: "family", relation: "daughter" },
      { user_id: "ravi", name: "Ravi", role: "caregiver", shift: "weekday mornings" },
    ]);
  });

  it("never returns another household (leakage)", async () => {
    const res = await t.app.inject({ method: "GET", url: "/care-team", headers: bearer(await t.login("sam")) });
    const ids = res.json().map((m: { user_id: string }) => m.user_id);
    expect(ids.sort()).toEqual(["harold", "sam"]);
  });

  it("requires a token", async () => {
    expect((await t.app.inject({ method: "GET", url: "/care-team" })).statusCode).toBe(401);
  });
});

describe("POST /users", () => {
  it("lets a family admin add a caregiver to their own household, who can then log in", async () => {
    const res = await t.app.inject({ method: "POST", url: "/users", headers: bearer(await t.login("anna")), payload: newUser });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      user_id: "mary-ann", name: "Mary Ann", role: "caregiver", email: "mary@keepsake.test", person_id: "margaret", shift: "weekends",
    });

    const login = await t.app.inject({ method: "POST", url: "/auth/login", payload: { email: "mary@keepsake.test", password: "longenough" } });
    expect(login.json().user).toMatchObject({ user_id: "mary-ann", role: "caregiver", person_id: "margaret" });
  });

  it("forces person_id to the admin's household even if the body says otherwise", async () => {
    const res = await t.app.inject({
      method: "POST", url: "/users", headers: bearer(await t.login("sam")),
      payload: { ...newUser, person_id: "margaret", admin: true },
    });
    expect(res.statusCode).toBe(201);
    const login = await t.cols.people.findOne({ email: "mary@keepsake.test" });
    expect(login).toMatchObject({ schema_version: 1, user_id: "mary-ann" });
    expect(login).not.toHaveProperty("role");
    const harold = await t.cols.households.findOne({ person_id: "harold" });
    expect(harold!.members.at(-1)).toEqual({ user_id: "mary-ann", name: "Mary Ann", role: "caregiver", admin: false, shift: "weekends" });
    const margaret = await t.cols.households.findOne({ person_id: "margaret" });
    expect(margaret!.members.map((m) => m.user_id)).not.toContain("mary-ann");
  });

  it.each(["margaret", "ravi"])("forbids non-admin %s", async (who) => {
    const res = await t.app.inject({ method: "POST", url: "/users", headers: bearer(await t.login(who)), payload: newUser });
    expect(res.statusCode).toBe(403);
  });

  it("forbids a family member without the admin flag", async () => {
    const anna = await t.login("anna");
    const created = await t.app.inject({
      method: "POST", url: "/users", headers: bearer(anna),
      payload: { ...newUser, name: "Brother", email: "brother@keepsake.test", role: "family", relation: "son" },
    });
    expect(created.statusCode).toBe(201);

    const res = await t.app.inject({ method: "POST", url: "/users", headers: bearer(await t.login("brother", "longenough")), payload: newUser });
    expect(res.statusCode).toBe(403);
  });

  it("does not allow creating a person or an admin", async () => {
    const res = await t.app.inject({ method: "POST", url: "/users", headers: bearer(await t.login("anna")), payload: { ...newUser, role: "person" } });
    expect(res.statusCode).toBe(400);
  });

  it("409s on a taken email", async () => {
    const res = await t.app.inject({
      method: "POST", url: "/users", headers: bearer(await t.login("anna")), payload: { ...newUser, email: "ravi@keepsake.test" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("email_taken");
  });

  it("leaves no orphan login when the household is full", async () => {
    await t.cols.households.updateOne({ person_id: "margaret" }, {
      $push: { members: { $each: Array.from({ length: 47 }, (_, i) => ({ user_id: `filler-${i}`, name: "F", role: "caregiver" as const })) } },
    });
    const res = await t.app.inject({ method: "POST", url: "/users", headers: bearer(await t.login("anna")), payload: newUser });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("household_full");
    expect(await t.cols.people.findOne({ email: "mary@keepsake.test" })).toBeNull();
  });

  it("suffixes the user_id when the name is taken", async () => {
    const res = await t.app.inject({
      method: "POST", url: "/users", headers: bearer(await t.login("anna")), payload: { ...newUser, name: "Ravi", email: "ravi2@keepsake.test" },
    });
    expect(res.json().user_id).toBe("ravi-2");
  });
});
