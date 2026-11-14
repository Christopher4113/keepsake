import type { Collection, Db } from "mongodb";

export const ROLES = ["person", "family", "caregiver"] as const;
export type Role = (typeof ROLES)[number];

// Matches db/schema.js. Keep in step with SCHEMA_VERSION in db/seed.py.
export const SCHEMA_VERSION = 1;

// people is auth only: who you are and how you log in.
export type PersonDoc = {
  schema_version: number;
  user_id: string;
  name?: string;
  email: string; // lowercased
  password_hash: string; // bcrypt
};

// households owns membership and roles: one doc per person, members embedded.
// Removing someone from members removes their access.
export type Member = {
  user_id: string;
  name: string;
  role: Role;
  admin?: boolean; // family only: may add users
  relation?: string;
  shift?: string; // display label only
};

export type HouseholdDoc = {
  schema_version: number;
  person_id: string;
  members: Member[];
  timezone?: string; // IANA, optional until db/seed.py sets it
};

export type Collections = ReturnType<typeof collections>;

export const collections = (db: Db) => ({
  people: db.collection<PersonDoc>("people"),
  households: db.collection<HouseholdDoc>("households"),
});

// user_id -> household + membership, the same lookup as whoami() in db/queries.js.
export async function findMembership(cols: Collections, user_id: string) {
  const household = await cols.households.findOne({ "members.user_id": user_id });
  const member = household?.members.find((m) => m.user_id === user_id);
  return household && member ? { household, member } : null;
}
