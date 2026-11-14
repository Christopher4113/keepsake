import { MongoClient } from "mongodb";

// One client per process; reused across hot reloads in dev.
const g = globalThis as unknown as { mongo?: Promise<MongoClient> };
g.mongo ??= new MongoClient(process.env.MONGODB_URI!).connect();

export const getDb = async () => (await g.mongo!).db(process.env.MONGODB_DB ?? "keepsake");

// For multi-document writes: (await getClient()).withSession((session) => session.withTransaction(...)).
export const getClient = () => g.mongo!;
