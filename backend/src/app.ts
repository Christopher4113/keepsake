import Fastify, { type FastifyServerOptions } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import type { Db } from "mongodb";
import { z } from "zod";
import type { Config } from "./config.js";
import { collections } from "./db.js";
import { registerErrorHandler } from "./errors.js";
import { makeRequireAuth } from "./auth/hooks.js";
import { authRoutes } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";

type Deps = { db: Db; config: Pick<Config, "AUTH_SECRET" | "TOKEN_TTL">; logger?: FastifyServerOptions["logger"] };

export async function buildApp({ db, config, logger = false }: Deps) {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("user", null);
  registerErrorHandler(app);

  const cols = collections(db);
  const requireAuth = makeRequireAuth(cols, config.AUTH_SECRET);

  const Health = z.object({ ok: z.boolean(), mongo: z.enum(["up", "down"]) });
  app.get(
    "/health",
    { schema: { response: { 200: Health, 503: Health } } },
    async (_req, reply) => {
      const up = await db.command({ ping: 1 }).then(() => true, () => false);
      return reply.code(up ? 200 : 503).send({ ok: up, mongo: up ? "up" : "down" });
    },
  );

  await app.register(authRoutes, { cols, secret: config.AUTH_SECRET, ttl: config.TOKEN_TTL, requireAuth });
  await app.register(userRoutes, { cols, requireAuth });
  return app;
}
