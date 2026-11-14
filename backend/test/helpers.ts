import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { buildApp } from "../src/app.js";
import { collections, type HouseholdDoc } from "../src/db.js";

export const SECRET = "test-secret-test-secret-test-secret-123";
// Demo password "keepsake" (same hash as the web branch's demo logins).
export const SEED_HASH = "$2b$10$OwUnGqFauqbAzW8RROu5M.1cVcMbd1ZrVxJvdXg13n74VvWsoys9m";
export const PASSWORD = "keepsake";

// Mirrors db/schema.js on main: people is auth only, households.members owns roles.
const households: HouseholdDoc[] = [
  {
    schema_version: 1, person_id: "margaret", timezone: "America/Toronto",
    members: [
      { user_id: "margaret", name: "Margaret", role: "person" },
      { user_id: "anna", name: "Anna", role: "family", relation: "daughter", admin: true },
      { user_id: "ravi", name: "Ravi", role: "caregiver", shift: "weekday mornings" },
    ],
  },
  {
    schema_version: 1, person_id: "harold",
    members: [
      { user_id: "harold", name: "Harold", role: "person" },
      { user_id: "sam", name: "Sam", role: "family", relation: "son", admin: true },
    ],
  },
];
// "former" has a login but no household: their access was removed.
const logins = ["margaret", "anna", "ravi", "harold", "sam", "former"];

export async function setup() {
  const mongod = await MongoMemoryServer.create();
  const client = await new MongoClient(mongod.getUri()).connect();
  const db = client.db("keepsake_test");
  const cols = collections(db);
  await cols.people.createIndex({ user_id: 1 }, { unique: true });
  await cols.people.createIndex({ email: 1 }, { unique: true });
  await cols.households.createIndex({ person_id: 1 }, { unique: true });
  await cols.households.createIndex({ "members.user_id": 1 }, { unique: true });

  const app = await buildApp({ db, config: { AUTH_SECRET: SECRET, TOKEN_TTL: "7d" } });

  const reset = async () => {
    await cols.people.deleteMany({});
    await cols.households.deleteMany({});
    await cols.households.insertMany(households.map((h) => structuredClone(h)));
    await cols.people.insertMany(logins.map((u) => ({
      schema_version: 1, user_id: u, name: u[0].toUpperCase() + u.slice(1), email: `${u}@keepsake.test`, password_hash: SEED_HASH,
    })));
  };

  const login = async (user_id: string, password = PASSWORD) => {
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email: `${user_id}@keepsake.test`, password } });
    return res.json().token as string;
  };

  const teardown = async () => {
    await app.close();
    await client.close();
    await mongod.stop();
  };

  return { app, cols, reset, login, teardown };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
