import { MongoClient } from "mongodb";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const client = await new MongoClient(config.MONGODB_URI, { appName: "keepsake-user-service" }).connect();
const app = await buildApp({ db: client.db(config.MONGODB_DB), config, logger: true });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.close();
    await client.close();
    process.exit(0);
  });
}

await app.listen({ port: config.PORT, host: config.HOST });
