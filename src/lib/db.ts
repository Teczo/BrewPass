import { Db, MongoClient } from "mongodb";

import { requireEnv } from "@/lib/env";

/**
 * Singleton MongoDB client for serverless.
 *
 * The client promise is cached on `globalThis` so hot reloads in dev and
 * re-used lambda containers in production share one connection pool instead
 * of opening a new one per invocation (connection storms).
 */
const globalForMongo = globalThis as typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

function getClientPromise(): Promise<MongoClient> {
  if (!globalForMongo._mongoClientPromise) {
    const client = new MongoClient(requireEnv("MONGODB_URI"));
    globalForMongo._mongoClientPromise = client.connect();
  }
  return globalForMongo._mongoClientPromise;
}

export async function getMongoClient(): Promise<MongoClient> {
  return getClientPromise();
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db(process.env.MONGODB_DB ?? "brewpass");
}
