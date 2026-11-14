import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { buildApp } from "../src/app.js";
import { collections, type PersonDoc } from "../src/db.js";

export const SECRET = "test-secret-test-secret-test-secret-123";
// Same hash as db/seed.py: password "keepsake".
export const SEED_HASH = "$2b$10$OwUnGqFauqbAzW8RROu5M.1cVcMbd1ZrVxJvdXg13n74VvWsoys9m";
export const PASSWORD = "keepsake";

// Mirrors the people/households part of db/seed.py, plus one deactivated user.
const people: Omit<PersonDoc, "email" | "password_hash" | "active">[] = [
  { user_id: "margaret", name: "Margaret", role: "person", person_id: "margaret" },
  { user_id: "anna", name: "Anna", role: "family", person_id: "margaret", relation: "daughter", admin: true },
  { user_id: "ravi", name: "Ravi", role: "caregiver", person_id: "margaret", shift: "weekday mornings" },
  { user_id: "harold", name: "Harold", role: "person", person_id: "harold" },
  { user_id: "sam", name: "Sam", role: "family", person_id: "harold", relation: "son", admin: true },
];

export async function setup() {
  const mongod = await MongoMemoryServer.create();
  const client = await new MongoClient(mongod.getUri()).connect();
  const db = client.db("keepsake_test");
  const cols = collections(db);
  await cols.people.createIndex({ user_id: 1 }, { unique: true });
  await cols.people.createIndex({ email: 1 }, { unique: true });
  await cols.households.createIndex({ person_id: 1 }, { unique: true });

  const app = await buildApp({ db, config: { AUTH_SECRET: SECRET, TOKEN_TTL: "7d" } });

  const reset = async () => {
    await cols.people.deleteMany({});
    await cols.households.deleteMany({});
    await cols.households.insertMany([
      { person_id: "margaret", timezone: "America/Toronto" },
      { person_id: "harold", timezone: "America/Toronto" },
    ]);
    await cols.people.insertMany([
      ...people.map((p) => ({ ...p, email: `${p.user_id}@keepsake.test`, password_hash: SEED_HASH, active: true })),
      { user_id: "former", name: "Former", role: "caregiver" as const, person_id: "margaret",
        email: "former@keepsake.test", password_hash: SEED_HASH, active: false },
    ]);
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
