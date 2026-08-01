import { Prisma } from "@prisma/client";
import { Hono } from "hono";

import { env } from "./env.js";
import { ApiError } from "./errors.js";
import { prisma } from "./prisma.js";

type TelegramUpdate = {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    from?: { id: number; first_name: string; last_name?: string; username?: string };
    text?: string;
  };
};

export const telegramRouter = new Hono();

async function sendMessage(chatId: string, text: string): Promise<void> {
  if (!env.BOT_TOKEN) return;
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!response.ok) throw new Error(`Telegram returned ${response.status}`);
}

function miniAppLink(slug?: string): string {
  if (env.BOT_USERNAME && env.TELEGRAM_APP_SHORT_NAME) {
    const base = `https://t.me/${env.BOT_USERNAME}/${env.TELEGRAM_APP_SHORT_NAME}`;
    return slug ? `${base}?startapp=${encodeURIComponent(slug)}` : base;
  }
  return slug ? `${env.APP_URL}?draft=${encodeURIComponent(slug)}` : env.APP_URL;
}

telegramRouter.post("/webhook", async (context) => {
  if (!env.WEBHOOK_SECRET || context.req.header("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) {
    throw new ApiError(401, "INVALID_WEBHOOK_SECRET", "Invalid webhook secret");
  }
  const update = (await context.req.json()) as TelegramUpdate;
  try {
    await prisma.telegramUpdate.create({ data: { updateId: String(update.update_id) } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return context.json({ ok: true, duplicate: true });
    }
    throw error;
  }
  const message = update.message;
  if (!message?.text || !message.from) return context.json({ ok: true });
  const [command, argument] = message.text.trim().split(/\s+/, 2);
  const user = await prisma.user.upsert({
    where: { telegramId: String(message.from.id) },
    create: {
      telegramId: String(message.from.id),
      displayName: [message.from.first_name, message.from.last_name].filter(Boolean).join(" "),
      username: message.from.username,
    },
    update: { username: message.from.username },
  });

  if (command?.startsWith("/start")) {
    await sendMessage(
      String(message.chat.id),
      `Create or join a Twilight Imperium draft in the Mini App:\n${miniAppLink()}`,
    );
  } else if (command?.startsWith("/draft") && !argument) {
    await sendMessage(String(message.chat.id), "Usage: /draft <draft-link-code>");
  } else if (command?.startsWith("/draft") && argument) {
    const draft = await prisma.draft.findUnique({ where: { slug: argument } });
    if (!draft) {
      await sendMessage(String(message.chat.id), "I could not find that draft.");
    } else if (draft.creatorUserId !== user.id) {
      await sendMessage(String(message.chat.id), "Only the draft creator can connect it to this group.");
    } else {
      await prisma.draft.update({ where: { id: draft.id }, data: { telegramChatId: String(message.chat.id) } });
      await prisma.draftEvent.create({
        data: {
          draftId: draft.id,
          actorUserId: user.id,
          type: "CHAT_BOUND",
          payload: { chatId: String(message.chat.id) },
        },
      });
      await sendMessage(
        String(message.chat.id),
        `Connected to ${draft.title}.\nOpen the draft: ${miniAppLink(draft.slug)}`,
      );
    }
  } else if (command?.startsWith("/status")) {
    const draft = await prisma.draft.findFirst({
      where: { telegramChatId: String(message.chat.id), status: { in: ["SETUP", "BANNING", "DRAFTING", "COMPLETE"] } },
      orderBy: { createdAt: "desc" },
      include: {
        players: { orderBy: { orderIndex: "asc" } },
        options: {
          where: { kind: "FACTION", bannedByPlayerId: { not: null } },
          select: { id: true },
        },
      },
    });
    const progress = draft
      ? draft.status === "BANNING"
        ? `${draft.options.length}/${draft.players.length} bans locked`
        : `${draft.turnCursor}/${draft.players.length * 3} choices`
      : "";
    await sendMessage(
      String(message.chat.id),
      draft
        ? `${draft.title}: ${draft.status.toLowerCase()}, ${progress}.\n${miniAppLink(draft.slug)}`
        : "This group is not connected to an active draft. Use /draft <draft-link-code>.",
    );
  }
  return context.json({ ok: true });
});

export function startOutboxWorker(): () => void {
  if (!env.BOT_TOKEN) return () => undefined;
  let running = false;
  const processOutbox = async () => {
    if (running) return;
    running = true;
    try {
      const jobs = await prisma.notificationOutbox.findMany({
        where: { status: { in: ["PENDING", "FAILED", "SENDING"] }, nextAttemptAt: { lte: new Date() }, attempts: { lt: 8 } },
        orderBy: { createdAt: "asc" },
        take: 10,
      });
      for (const job of jobs) {
        const claimed = await prisma.notificationOutbox.updateMany({
          where: { id: job.id, status: job.status, nextAttemptAt: job.nextAttemptAt },
          data: {
            status: "SENDING",
            attempts: { increment: 1 },
            nextAttemptAt: new Date(Date.now() + 60_000),
          },
        });
        if (claimed.count !== 1) continue;
        try {
          await sendMessage(job.chatId, job.message);
          await prisma.notificationOutbox.update({
            where: { id: job.id },
            data: { status: "SENT", sentAt: new Date(), lastError: null },
          });
        } catch (error) {
          const delay = Math.min(300, 2 ** (job.attempts + 1));
          await prisma.notificationOutbox.update({
            where: { id: job.id },
            data: {
              status: "FAILED",
              lastError: error instanceof Error ? error.message.slice(0, 500) : "Unknown Telegram error",
              nextAttemptAt: new Date(Date.now() + delay * 1_000),
            },
          });
        }
      }
    } catch (error) {
      console.error("Telegram outbox worker failed", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void processOutbox(), 2_000);
  timer.unref();
  void processOutbox();
  return () => clearInterval(timer);
}
