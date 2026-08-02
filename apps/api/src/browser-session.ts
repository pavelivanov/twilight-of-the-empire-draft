import { createHash, randomBytes } from "node:crypto";

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { env } from "./env.js";
import { ApiError } from "./errors.js";
import { prisma } from "./prisma.js";

const pendingLifetimeMs = 10 * 60 * 1_000;
const linkedLifetimeMs = 30 * 24 * 60 * 60 * 1_000;
const sessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);

export const browserSessionRouter = new Hono();

export function hashBrowserSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function browserSessionBotLink(token: string): string {
  if (!env.BOT_USERNAME) {
    throw new ApiError(503, "BOT_NOT_CONFIGURED", "Telegram browser sign-in is not configured");
  }
  return `https://t.me/${env.BOT_USERNAME.replace(/^@/, "")}?start=web_${token}`;
}

export async function resolveBrowserSession(token: string) {
  const parsed = sessionTokenSchema.safeParse(token);
  if (!parsed.success) return null;
  const now = new Date();
  const session = await prisma.browserSession.findUnique({
    where: { tokenHash: hashBrowserSessionToken(parsed.data) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= now || !session.user) return null;
  if (!session.lastUsedAt || session.lastUsedAt.getTime() < now.getTime() - 5 * 60 * 1_000) {
    await prisma.browserSession.updateMany({
      where: { id: session.id, expiresAt: { gt: now } },
      data: { lastUsedAt: now },
    });
  }
  return session;
}

export async function claimBrowserSession(token: string, userId: string): Promise<"linked" | "already-linked" | "expired"> {
  const parsed = sessionTokenSchema.safeParse(token);
  if (!parsed.success) return "expired";
  const now = new Date();
  const tokenHash = hashBrowserSessionToken(parsed.data);
  const claimed = await prisma.browserSession.updateMany({
    where: { tokenHash, userId: null, expiresAt: { gt: now } },
    data: {
      userId,
      linkedAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + linkedLifetimeMs),
    },
  });
  if (claimed.count === 1) return "linked";
  const existing = await prisma.browserSession.findUnique({ where: { tokenHash }, select: { userId: true, expiresAt: true } });
  if (existing?.userId === userId && existing.expiresAt > now) return "already-linked";
  return "expired";
}

browserSessionRouter.post("/browser-sessions", async (context) => {
  if (!env.BOT_TOKEN || !env.BOT_USERNAME) {
    throw new ApiError(503, "BOT_NOT_CONFIGURED", "Telegram browser sign-in is not configured");
  }
  const now = new Date();
  await prisma.browserSession.deleteMany({ where: { expiresAt: { lte: now } } });
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + pendingLifetimeMs);
  await prisma.browserSession.create({
    data: { tokenHash: hashBrowserSessionToken(token), expiresAt },
  });
  return context.json({ token, botUrl: browserSessionBotLink(token), expiresAt: expiresAt.toISOString() }, 201);
});

browserSessionRouter.post(
  "/browser-sessions/status",
  zValidator("json", z.object({ token: sessionTokenSchema })),
  async (context) => {
    const { token } = context.req.valid("json");
    const session = await prisma.browserSession.findUnique({
      where: { tokenHash: hashBrowserSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date()) {
      return context.json({ status: "expired" as const });
    }
    if (!session.user) return context.json({ status: "pending" as const });
    return context.json({ status: "authenticated" as const });
  },
);
