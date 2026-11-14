import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { connect } from "./db.js";

const config = loadConfig();
const { client, db } = await connect(config.MONGODB_URI, config.MONGODB_DB);
const app = await buildApp({ db, config, logger: { level: "info" } });

const shutdown = async () => {
  await app.close();
  await client.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
