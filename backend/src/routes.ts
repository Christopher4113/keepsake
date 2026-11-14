import bcrypt from "bcryptjs";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { MongoServerError, type Db } from "mongodb";
import { z } from "zod";
import { authenticate, requireFamilyAdmin, signSession } from "./auth.js";
import type { Config } from "./config.js";
import { collections, findMembership, ROLES, SCHEMA_VERSION, type Member } from "./db.js";
import { HttpError } from "./errors.js";

type Opts = { db: Db; config: Pick<Config, "AUTH_SECRET" | "TOKEN_TTL"> };

const Email = z.string().trim().toLowerCase().pipe(z.email());
const User = z.object({ user_id: z.string(), name: z.string(), role: z.enum(ROLES), person_id: z.string() });
const TeamMember = User.omit({ person_id: true }).extend({ relation: z.string().optional(), shift: z.string().optional() });
const Health = z.object({ ok: z.boolean(), mongo: z.enum(["up", "down"]) });

const MAX_MEMBERS = 50; // households.members maxItems in db/schema.js
const ROLE_ORDER = { person: 0, family: 1, caregiver: 2 } as const;
// Compared against when the email is unknown, so a miss costs the same as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);
// "Mary Ann" -> "mary-ann"
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user";
const isDuplicate = (e: unknown): e is MongoServerError => e instanceof MongoServerError && e.code === 11000;

export const routes: FastifyPluginAsyncZod<Opts> = async (app, { db, config }) => {
  const cols = collections(db);
  const auth = authenticate(cols, config.AUTH_SECRET);

  app.get("/health", { schema: { response: { 200: Health, 503: Health } } }, async (_req, reply) => {
    const up = await db.command({ ping: 1 }).then(() => true, () => false);
    return reply.code(up ? 200 : 503).send({ ok: up, mongo: up ? "up" : "down" });
  });

  // Credentials from people, role and household from households.members.
  app.post(
    "/auth/login",
    {
      schema: {
        body: z.object({ email: Email, password: z.string().min(1) }),
        response: { 200: z.object({ token: z.string(), user: User }) },
      },
    },
    async (req) => {
      const doc = await cols.people.findOne({ email: req.body.email });
      const ok = await bcrypt.compare(req.body.password, doc?.password_hash ?? DUMMY_HASH);
      if (!doc || !ok) throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");

      const found = await findMembership(cols, doc.user_id);
      if (!found) throw new HttpError(403, "no_household", "This account isn't linked to a household yet.");

      const user = { user_id: doc.user_id, name: found.member.name, role: found.member.role, person_id: found.household.person_id };
      return { token: await signSession(user, config.AUTH_SECRET, config.TOKEN_TTL), user };
    },
  );

  app.get(
    "/auth/me",
    {
      preHandler: auth,
      schema: {
        response: {
          200: User.extend({
            admin: z.boolean(),
            person: z.object({ person_id: z.string(), name: z.string().nullable(), timezone: z.string().nullable() }),
          }),
        },
      },
    },
    async (req) => {
      const { household, ...me } = req.user!;
      const person = household.members.find((m) => m.role === "person");
      return { ...me, person: { person_id: me.person_id, name: person?.name ?? null, timezone: household.timezone ?? null } };
    },
  );

  // The caller's household only. No emails or credentials leave this endpoint.
  app.get("/care-team", { preHandler: auth, schema: { response: { 200: z.array(TeamMember) } } }, async (req) =>
    req.user!.household.members
      .map(({ user_id, name, role, relation, shift }) => ({ user_id, name, role, relation, shift }))
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name)),
  );

  // Family admins add family members and caregivers to their own household:
  // a login in people, then a member entry in the admin's household.
  app.post(
    "/users",
    {
      preHandler: [auth, requireFamilyAdmin],
      schema: {
        body: z.object({
          name: z.string().trim().min(1).max(80),
          email: Email,
          password: z.string().min(8).max(72), // bcrypt ignores bytes past 72
          role: z.enum(["family", "caregiver"]),
          relation: z.string().trim().min(1).max(40).optional(),
          shift: z.string().trim().min(1).max(80).optional(),
        }),
        response: { 201: TeamMember.extend({ email: z.string(), person_id: z.string() }) },
      },
    },
    async (req, reply) => {
      const { password, email, name, role, relation, shift } = req.body;
      const person_id = req.user!.person_id; // forced: an admin can only add to their own household
      const password_hash = await bcrypt.hash(password, 10);

      // First free user_id wins: ravi, ravi-2, ravi-3... The unique index settles races.
      let user_id: string | null = null;
      for (let n = 1; n <= 20 && !user_id; n++) {
        const candidate = n === 1 ? slug(name) : `${slug(name)}-${n}`;
        try {
          await cols.people.insertOne({ schema_version: SCHEMA_VERSION, user_id: candidate, name, email, password_hash });
          user_id = candidate;
        } catch (e) {
          if (!isDuplicate(e)) throw e;
          if (e.keyPattern?.email) throw new HttpError(409, "email_taken", "That email already has an account.");
        }
      }
      if (!user_id) throw new HttpError(409, "user_id_taken", "Couldn't pick a free user id for that name.");

      const member: Member = { user_id, name, role, admin: false, ...(relation && { relation }), ...(shift && { shift }) };
      const pushed = await cols.households
        .updateOne(
          { person_id, [`members.${MAX_MEMBERS - 1}`]: { $exists: false } },
          { $push: { members: member } },
        )
        .catch(async (e) => {
          await cols.people.deleteOne({ user_id }); // no orphan login if the member write fails
          throw e;
        });
      if (pushed.modifiedCount !== 1) {
        await cols.people.deleteOne({ user_id });
        throw new HttpError(409, "household_full", `A household can have at most ${MAX_MEMBERS} members.`);
      }

      return reply.code(201).send({ user_id, name, role, email, person_id, relation, shift });
    },
  );
};
