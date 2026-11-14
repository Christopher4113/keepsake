import { z } from "zod";

const Env = z.object({
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default("keepsake"),
  // Must match the web client's AUTH_SECRET: both sign and verify the same session JWT.
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars (openssl rand -base64 32)"),
  TOKEN_TTL: z.string().default("7d"), // same lifetime as the client's keepsake_session cookie
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("127.0.0.1"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment (see .env.example):\n${issues}`);
  }
  return parsed.data;
}
