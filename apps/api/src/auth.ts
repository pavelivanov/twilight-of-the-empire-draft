import { createHmac, timingSafeEqual } from "node:crypto";

import type { MiddlewareHandler } from "hono";

import { resolveBrowserSession } from "./browser-session.js";
import { ApiError } from "./errors.js";
import { env } from "./env.js";
import { prisma } from "./prisma.js";

export type Actor = {
  userId: string;
  telegramId: string;
  displayName: string;
  username?: string;
  isDemo: boolean;
  authMode: "telegram" | "browser" | "demo";
};

export type ApiEnvironment = {
  Variables: {
    actor: Actor;
    requestId: string;
  };
};

export type TelegramWebAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

export function verifyTelegramInitData(
  initData: string,
  botToken = env.BOT_TOKEN,
  maxAge = env.AUTH_MAX_AGE,
  now = Date.now(),
): TelegramWebAppUser {
  if (!botToken) throw new ApiError(500, "BOT_NOT_CONFIGURED", "Telegram authentication is not configured");
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  const rawUser = params.get("user");
  if (!receivedHash || !authDate || !rawUser) {
    throw new ApiError(401, "INVALID_INIT_DATA", "Telegram authentication data is incomplete");
  }
  if (Math.abs(now / 1_000 - authDate) > maxAge) {
    throw new ApiError(401, "EXPIRED_INIT_DATA", "Telegram authentication data has expired");
  }

  params.delete("hash");
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secret).update(checkString).digest();
  const receivedBuffer = Buffer.from(receivedHash, "hex");
  if (receivedBuffer.length !== expectedHash.length || !timingSafeEqual(receivedBuffer, expectedHash)) {
    throw new ApiError(401, "INVALID_INIT_DATA", "Telegram authentication data is invalid");
  }
  return JSON.parse(rawUser) as TelegramWebAppUser;
}

export const authenticate: MiddlewareHandler<ApiEnvironment> = async (context, next) => {
  const authorization = context.req.header("authorization");
  let identity: {
    telegramId: string;
    displayName: string;
    username?: string;
    isDemo: boolean;
    authMode: Actor["authMode"];
  };
  let existingUserId: string | undefined;

  if (authorization?.startsWith("tma ")) {
    const user = verifyTelegramInitData(authorization.slice(4));
    identity = {
      telegramId: String(user.id),
      displayName: [user.first_name, user.last_name].filter(Boolean).join(" "),
      username: user.username,
      isDemo: false,
      authMode: "telegram",
    };
  } else if (authorization?.startsWith("Bearer ")) {
    const session = await resolveBrowserSession(authorization.slice(7));
    if (!session?.user) {
      throw new ApiError(401, "INVALID_BROWSER_SESSION", "Reconnect this browser with Telegram");
    }
    existingUserId = session.user.id;
    identity = {
      telegramId: session.user.telegramId,
      displayName: session.user.displayName,
      username: session.user.username ?? undefined,
      isDemo: false,
      authMode: "browser",
    };
  } else if (env.ALLOW_DEMO_AUTH && context.req.header("x-demo-user-id")) {
    identity = {
      telegramId: `demo:${context.req.header("x-demo-user-id")}`,
      displayName: context.req.header("x-demo-user-name")?.slice(0, 48) || "Local player",
      isDemo: true,
      authMode: "demo",
    };
  } else {
    throw new ApiError(401, "AUTH_REQUIRED", "Connect this browser with Telegram");
  }

  const userId =
    existingUserId ??
    (
      await prisma.user.upsert({
        where: { telegramId: identity.telegramId },
        create: {
          telegramId: identity.telegramId,
          displayName: identity.displayName,
          username: identity.username,
        },
        update: {
          displayName: identity.displayName,
          username: identity.username,
        },
      })
    ).id;
  context.set("actor", { ...identity, userId });
  await next();
};
