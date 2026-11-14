import bcrypt from "bcryptjs";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { ROLES, type Collections } from "../db.js";
import { HttpError } from "../errors.js";
import { signSession } from "../auth/tokens.js";
import type { makeRequireAuth } from "../auth/hooks.js";

type Opts = { cols: Collections; secret: string; ttl: string; requireAuth: ReturnType<typeof makeRequireAuth> };

export const PublicUser = z.object({
  user_id: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  person_id: z.string(),
});

// Compared against when the email is unknown, so a miss costs the same as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);
const badLogin = () => new HttpError(401, "invalid_credentials", "Email or password is incorrect.");

export const authRoutes: FastifyPluginAsyncZod<Opts> = async (app, { cols, secret, ttl, requireAuth }) => {
  app.post(
    "/auth/login",
    {
      schema: {
        body: z.object({ email: z.string().trim().toLowerCase().pipe(z.email()), password: z.string().min(1) }),
        response: { 200: z.object({ token: z.string(), user: PublicUser }) },
      },
    },
    async (req) => {
      const { email, password } = req.body;
      const doc = await cols.people.findOne({ email });
      const ok = await bcrypt.compare(password, doc?.password_hash ?? DUMMY_HASH);
      if (!doc || !ok || doc.active !== true) throw badLogin();

      const user = { user_id: doc.user_id, name: doc.name, role: doc.role, person_id: doc.person_id };
      return { token: await signSession(user, secret, ttl), user };
    },
  );

  app.get(
    "/auth/me",
    {
      preHandler: requireAuth,
      schema: {
        response: {
          200: PublicUser.extend({
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
        cols.people.findOne({ person_id: me.person_id, role: "person" }, { projection: { name: 1 } }),
      ]);
      return {
        ...me,
        person: { person_id: me.person_id, name: person?.name ?? null, timezone: household?.timezone ?? null },
      };
    },
  );
};
