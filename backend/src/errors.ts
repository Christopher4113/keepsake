import type { FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";

// Every error leaves the API as { error: { code, message } }.
export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    const send = (status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });

    if (err instanceof HttpError) return send(err.statusCode, err.code, err.message);
    if (hasZodFastifySchemaValidationErrors(err)) {
      return send(400, "bad_request", err.validation.map((v) => `${v.instancePath || "body"} ${v.message}`).join("; "));
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) return send(status, "bad_request", (err as Error).message); // e.g. malformed JSON
    req.log.error(err);
    return send(500, "internal", "Something went wrong.");
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: "not_found", message: "Not found." } }));
}
