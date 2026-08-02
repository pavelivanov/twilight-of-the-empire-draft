import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { authenticate, type ApiEnvironment } from "./auth.js";
import { browserSessionRouter } from "./browser-session.js";
import { draftsRouter } from "./drafts.js";
import { env } from "./env.js";
import { ApiError } from "./errors.js";
import { prisma } from "./prisma.js";
import { telegramRouter } from "./telegram.js";

export const app = new Hono<ApiEnvironment>();

app.use(logger());
app.use("*", async (context, next) => {
  context.set("requestId", context.req.header("x-request-id") ?? randomUUID());
  await next();
  context.header("x-request-id", context.get("requestId"));
});
app.use(
  "/api/*",
  cors({
    origin: (origin) =>
      env.NODE_ENV !== "production" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)
        ? origin
        : env.WEB_ORIGIN,
    allowHeaders: ["authorization", "content-type", "x-demo-user-id", "x-demo-user-name", "x-request-id"],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", async (context) => {
  await prisma.$queryRaw`SELECT 1`;
  return context.json({ status: "ok" });
});
app.route("/api/telegram", telegramRouter);
app.route("/api/auth", browserSessionRouter);
app.use("/api/auth/me", authenticate);
app.get("/api/auth/me", (context) => {
  const actor = context.get("actor");
  return context.json({
    id: actor.userId,
    displayName: actor.displayName,
    username: actor.username,
    mode: actor.authMode,
  });
});
app.use("/api/drafts/*", authenticate);
app.use("/api/drafts", authenticate);
app.route("/api/drafts", draftsRouter);

app.notFound((context) =>
  context.json({ error: { code: "NOT_FOUND", message: "Route not found", requestId: context.get("requestId") } }, 404),
);
app.onError((error, context) => {
  if (error instanceof ApiError) {
    return context.json(
      { error: { code: error.code, message: error.message, requestId: context.get("requestId") } },
      error.status,
    );
  }
  console.error(error);
  return context.json(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred", requestId: context.get("requestId") } },
    500,
  );
});
