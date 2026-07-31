import { serve } from "@hono/node-server";

import { app } from "./app.js";
import { env } from "./env.js";
import { prisma } from "./prisma.js";
import { startOutboxWorker } from "./telegram.js";

const stopWorker = startOutboxWorker();
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.info(`Imperium API listening on http://localhost:${info.port}`);
});

async function shutdown(): Promise<void> {
  stopWorker();
  server.close();
  await prisma.$disconnect();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
