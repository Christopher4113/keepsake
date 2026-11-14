import Fastify, { type FastifyServerOptions } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import type { Db } from "mongodb";
import type { Config } from "./config.js";
import { registerErrorHandler } from "./errors.js";
import { routes } from "./routes.js";

type Deps = { db: Db; config: Pick<Config, "AUTH_SECRET" | "TOKEN_TTL">; logger?: FastifyServerOptions["logger"] };

export async function buildApp({ db, config, logger = false }: Deps) {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("user", null);
  registerErrorHandler(app);
  await app.register(routes, { db, config });
  return app;
}
