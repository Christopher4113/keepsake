import type { FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";

// Every error leaves the API as { error: { code, message } }.
export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export const unauthorized = (message = "Sign in required.") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "You don't have access to that.") => new HttpError(403, "forbidden", message);

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const message = err.validation.map((v) => `${v.instancePath || "body"} ${v.message}`).join("; ");
      return reply.code(400).send({ error: { code: "bad_request", message } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: "bad_request", message: (err as Error).message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: "internal", message: "Something went wrong." } });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: "not_found", message: "Not found." } }));
}
