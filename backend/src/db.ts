import type { Collection, Db } from "mongodb";

export const ROLES = ["person", "family", "caregiver"] as const;
export type Role = (typeof ROLES)[number];

// db/schema.js: people.person_id is the foreign key to households.person_id.
export type PersonDoc = {
  user_id: string;
  name: string;
  email: string; // lowercased
  password_hash: string; // bcrypt
  role: Role;
  person_id: string;
  admin?: boolean;
  active: boolean;
  relation?: string;
  shift?: string;
  created_at?: Date;
};

export type HouseholdDoc = { person_id: string; timezone: string };

export type Collections = ReturnType<typeof collections>;

export const collections = (db: Db) => ({
  people: db.collection<PersonDoc>("people"),
  households: db.collection<HouseholdDoc>("households"),
});
