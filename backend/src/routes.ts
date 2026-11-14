import bcrypt from "bcryptjs";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { MongoServerError, type Db } from "mongodb";
import { z } from "zod";
import { authenticate, requireFamilyAdmin, signSession } from "./auth.js";
import type { Config } from "./config.js";
import { collections, ROLES } from "./db.js";
import { HttpError } from "./errors.js";

type Opts = { db: Db; config: Pick<Config, "AUTH_SECRET" | "TOKEN_TTL"> };

const Email = z.string().trim().toLowerCase().pipe(z.email());
const User = z.object({ user_id: z.string(), name: z.string(), role: z.enum(ROLES), person_id: z.string() });
const TeamMember = User.omit({ person_id: true }).extend({ relation: z.string().optional(), shift: z.string().optional() });
const Health = z.object({ ok: z.boolean(), mongo: z.enum(["up", "down"]) });

const ROLE_ORDER = { person: 0, family: 1, caregiver: 2 } as const;
// Compared against when the email is unknown, so a miss costs the same as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);
// "Mary Ann" -> "mary-ann"
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user";

export const routes: FastifyPluginAsyncZod<Opts> = async (app, { db, config }) => {
  const cols = collections(db);
  const auth = authenticate(cols, config.AUTH_SECRET);

  app.get("/health", { schema: { response: { 200: Health, 503: Health } } }, async (_req, reply) => {
    const up = await db.command({ ping: 1 }).then(() => true, () => false);
    return reply.code(up ? 200 : 503).send({ ok: up, mongo: up ? "up" : "down" });
  });

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
      if (!doc || !ok || !doc.active) throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");

      const user = { user_id: doc.user_id, name: doc.name, role: doc.role, person_id: doc.person_id };
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
      const me = req.user!;
      const [household, person] = await Promise.all([
        cols.households.findOne({ person_id: me.person_id }),
        cols.people.findOne({ person_id: me.person_id, role: "person" }),
      ]);
      return { ...me, person: { person_id: me.person_id, name: person?.name ?? null, timezone: household?.timezone ?? null } };
    },
  );

  // The caller's household only. No emails or credentials leave this endpoint.
  app.get("/care-team", { preHandler: auth, schema: { response: { 200: z.array(TeamMember) } } }, async (req) => {
    const team = await cols.people
      .find({ person_id: req.user!.person_id, active: true }, { projection: { _id: 0, user_id: 1, name: 1, role: 1, relation: 1, shift: 1 } })
      .toArray();
    return team.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
  });

  // Family admins add family members and caregivers to their own household.
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
      const { password, ...fields } = req.body;
      const person_id = req.user!.person_id; // forced: an admin can only add to their own household
      const password_hash = await bcrypt.hash(password, 10);

      // First free user_id wins: ravi, ravi-2, ravi-3... The unique index settles races.
      for (let n = 1; n <= 20; n++) {
        const user_id = n === 1 ? slug(fields.name) : `${slug(fields.name)}-${n}`;
        try {
          await cols.people.insertOne({ ...fields, user_id, person_id, password_hash, admin: false, active: true, created_at: new Date() });
          return reply.code(201).send({ ...fields, user_id, person_id });
        } catch (e) {
          if (!(e instanceof MongoServerError) || e.code !== 11000) throw e;
          if (e.keyPattern?.email) throw new HttpError(409, "email_taken", "That email already has an account.");
        }
      }
      throw new HttpError(409, "user_id_taken", "Couldn't pick a free user id for that name.");
    },
  );
};
