import bcrypt from "bcryptjs";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { MongoServerError } from "mongodb";
import { z } from "zod";
import { ROLES, type Collections, type PersonDoc } from "../db.js";
import { HttpError } from "../errors.js";
import { requireFamilyAdmin, type makeRequireAuth } from "../auth/hooks.js";

type Opts = { cols: Collections; requireAuth: ReturnType<typeof makeRequireAuth> };

const TeamMember = z.object({
  user_id: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  relation: z.string().optional(),
  shift: z.string().optional(),
});

const ROLE_ORDER = { person: 0, family: 1, caregiver: 2 } as const;

// "Mary Ann" -> "mary-ann"
const slug = (name: string) =>
  name.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toLowerCase().replace(/[\s_-]+/g, "-") || "user";

export const userRoutes: FastifyPluginAsyncZod<Opts> = async (app, { cols, requireAuth }) => {
  // The caller's household only. No emails or credentials leave this endpoint.
  app.get(
    "/care-team",
    { preHandler: requireAuth, schema: { response: { 200: z.array(TeamMember) } } },
    async (req) => {
      const team = await cols.people
        .find(
          { person_id: req.user!.person_id, active: true },
          { projection: { _id: 0, user_id: 1, name: 1, role: 1, relation: 1, shift: 1 } },
        )
        .toArray();
      return team.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
    },
  );

  // Family admins add family members and caregivers to their own household.
  app.post(
    "/users",
    {
      preHandler: [requireAuth, requireFamilyAdmin],
      schema: {
        body: z.object({
          name: z.string().trim().min(1).max(80),
          email: z.string().trim().toLowerCase().pipe(z.email()),
          password: z.string().min(8).max(72), // bcrypt ignores bytes past 72
          role: z.enum(["family", "caregiver"]),
          relation: z.string().trim().min(1).max(40).optional(),
          shift: z.string().trim().min(1).max(80).optional(),
        }),
        response: { 201: TeamMember.extend({ email: z.string(), person_id: z.string() }) },
      },
    },
    async (req, reply) => {
      const { name, email, password, role, relation, shift } = req.body;
      const base = slug(name);
      const password_hash = await bcrypt.hash(password, 10);

      // Pick the first free user_id: anna, anna-2, anna-3... The unique index settles races.
      for (let n = 1; n <= 20; n++) {
        const user_id = n === 1 ? base : `${base}-${n}`;
        const doc: PersonDoc = {
          user_id, name, email, password_hash, role,
          person_id: req.user!.person_id, // forced: an admin can only add to their own household
          admin: false, active: true, created_at: new Date(),
          ...(relation && { relation }),
          ...(shift && { shift }),
        };
        try {
          await cols.people.insertOne(doc);
          return reply.code(201).send({ user_id, name, role, email, person_id: doc.person_id, relation, shift });
        } catch (e) {
          if (!(e instanceof MongoServerError) || e.code !== 11000) throw e;
          if (e.keyPattern?.email) throw new HttpError(409, "email_taken", "That email already has an account.");
          // user_id taken: try the next suffix
        }
      }
      throw new HttpError(409, "user_id_taken", "Couldn't pick a free user id for that name.");
    },
  );
};
