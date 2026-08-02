import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { Hono } from "hono";

import { env } from "./env.js";
import { ApiError } from "./errors.js";
import { claimBrowserSession } from "./browser-session.js";
import { prisma } from "./prisma.js";

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

export type TelegramMessage = {
  chat: TelegramChat;
  from?: { id: number; first_name: string; last_name?: string; username?: string };
  text?: string;
  chat_shared?: {
    request_id: number;
    chat_id: number;
    title?: string;
    username?: string;
  };
};

export type TelegramChat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
};

type TelegramChatMember = {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  can_post_messages?: boolean;
};

export type TelegramNotificationTarget = "group" | "channel";

type TelegramUser = { id: number };

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export const telegramRouter = new Hono();

async function telegramApi<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  if (!env.BOT_TOKEN) throw new Error("Telegram bot is not configured");
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => undefined)) as TelegramResponse<T> | undefined;
  if (!response.ok || !body?.ok || body.result === undefined) {
    throw new Error(body?.description ?? `Telegram returned ${response.status}`);
  }
  return body.result;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<void> {
  if (!env.BOT_TOKEN) return;
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

const groupAdministratorRights = {
  is_anonymous: false,
  can_manage_chat: true,
  can_delete_messages: false,
  can_manage_video_chats: false,
  can_restrict_members: false,
  can_promote_members: false,
  can_change_info: false,
  can_invite_users: false,
  can_post_stories: false,
  can_edit_stories: false,
  can_delete_stories: false,
  can_post_messages: false,
  can_edit_messages: false,
  can_pin_messages: false,
  can_manage_topics: false,
  can_manage_direct_messages: false,
  can_manage_tags: false,
};

export function groupPickerReplyMarkup(requestId: number): Record<string, unknown> {
  return notificationChatPickerReplyMarkup(requestId, "group");
}

export function notificationChatPickerReplyMarkup(
  requestId: number,
  target: TelegramNotificationTarget,
): Record<string, unknown> {
  const isChannel = target === "channel";
  const administratorRights = isChannel
    ? { ...groupAdministratorRights, can_post_messages: true }
    : groupAdministratorRights;
  return {
    keyboard: [
      [
        {
          text: `Choose notification ${target}`,
          request_chat: {
            request_id: requestId,
            chat_is_channel: isChannel,
            user_administrator_rights: administratorRights,
            bot_administrator_rights: administratorRights,
            request_title: true,
            request_username: true,
          },
        },
      ],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: `Choose a ${target} you administer`,
  };
}

export async function sendTelegramChatPicker(
  userChatId: string,
  draftTitle: string,
  requestId: number,
  target: TelegramNotificationTarget,
): Promise<void> {
  await sendTelegramMessage(
    userChatId,
    `Choose a ${target} for ${draftTitle}. Telegram only shows ${target}s you administer and will grant the bot the access needed to post notifications.`,
    notificationChatPickerReplyMarkup(requestId, target),
  );
}

export function miniAppLink(startParam?: string): string {
  if (env.BOT_USERNAME && env.TELEGRAM_APP_SHORT_NAME) {
    const base = `https://t.me/${env.BOT_USERNAME}/${env.TELEGRAM_APP_SHORT_NAME}`;
    return startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : base;
  }
  if (!startParam) return env.APP_URL;
  const isGroupLaunch = /^(?:group|channel)_/.test(startParam);
  const parameter = isGroupLaunch ? "groupLaunch" : "draft";
  return `${env.APP_URL}?${parameter}=${encodeURIComponent(startParam.replace(/^(?:group|channel)_/, ""))}`;
}

export function groupDraftLaunchReplyMarkup(token: string): Record<string, unknown> {
  return {
    inline_keyboard: [[{ text: "Create draft", url: miniAppLink(`group_${token}`) }]],
  };
}

function canManageGroup(member: TelegramChatMember): boolean {
  return member.status === "creator" || member.status === "administrator";
}

export async function verifyTelegramNotificationChatAccess(
  chatId: string,
  userId: number,
  expectedTarget?: TelegramNotificationTarget,
): Promise<TelegramChat> {
  const bot = await telegramApi<TelegramUser>("getMe", {});
  const [chat, userMember, botMember] = await Promise.all([
    telegramApi<TelegramChat>("getChat", { chat_id: chatId }),
    telegramApi<TelegramChatMember>("getChatMember", { chat_id: chatId, user_id: userId }),
    telegramApi<TelegramChatMember>("getChatMember", { chat_id: chatId, user_id: bot.id }),
  ]);
  const target = chat.type === "channel" ? "channel" : new Set(["supergroup", "group"]).has(chat.type) ? "group" : null;
  if (!target || (expectedTarget && target !== expectedTarget)) {
    throw new Error(`Choose a Telegram ${expectedTarget ?? "group or channel"}`);
  }
  if (!canManageGroup(userMember)) {
    throw new Error(`You must be an administrator in this ${target}`);
  }
  if (!canManageGroup(botMember)) {
    throw new Error(`Make the bot an administrator in this ${target}`);
  }
  if (target === "channel" && botMember.can_post_messages === false) {
    throw new Error("Allow the bot to post messages in this channel");
  }
  return chat;
}

export async function resolveNewDraftTarget(
  message: TelegramMessage,
): Promise<TelegramChat | undefined> {
  return new Set(["supergroup", "group"]).has(message.chat.type) ? message.chat : undefined;
}

async function bindSharedGroup(
  message: NonNullable<TelegramUpdate["message"]>,
  user: { id: string; telegramId: string },
): Promise<void> {
  const shared = message.chat_shared;
  if (!shared || !message.from) return;
  const draft = await prisma.draft.findFirst({
    where: { telegramChannelRequestId: shared.request_id, creatorUserId: user.id },
    select: { id: true, slug: true, title: true, creatorUserId: true },
  });
  if (!draft) {
    await sendTelegramMessage(
      user.telegramId,
      "That group request has expired. Return to the draft and request a new one from Manage draft.",
      { remove_keyboard: true },
    );
    return;
  }

  let chat: TelegramChat;
  try {
    chat = await verifyTelegramNotificationChatAccess(String(shared.chat_id), message.from.id);
  } catch (error) {
    await sendTelegramMessage(
      user.telegramId,
      error instanceof Error ? error.message : "I could not connect that group. Choose another one.",
    );
    return;
  }

  const chatTitle = chat.title ?? shared.title ?? chat.username ?? shared.username ?? "Telegram group";
  const chatUsername = chat.username ?? shared.username;
  const bound = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.draft.updateMany({
      where: {
        id: draft.id,
        creatorUserId: user.id,
        telegramChannelRequestId: shared.request_id,
      },
      data: {
        telegramChatId: String(shared.chat_id),
        telegramChatTitle: chatTitle,
        telegramChatUsername: chatUsername,
        telegramChannelRequestId: null,
      },
    });
    if (updated.count !== 1) return false;
    const event = await transaction.draftEvent.create({
      data: {
        draftId: draft.id,
        actorUserId: user.id,
        type: "CHAT_BOUND",
        payload: { chatId: String(shared.chat_id), chatTitle, chatUsername, source: "group_picker" },
      },
    });
    await transaction.notificationOutbox.create({
      data: {
        draftId: draft.id,
        eventId: event.id,
        chatId: String(shared.chat_id),
        message: `📣 Owner connected ${draft.title} to this Telegram chat. Every accepted player and owner action will be posted here.\nOpen the draft: ${miniAppLink(draft.slug)}`,
      },
    });
    return true;
  });
  if (!bound) return;

  try {
    await sendTelegramMessage(
      user.telegramId,
      `Connected ${chatTitle} to ${draft.title}. You can return to the Mini App.`,
      { remove_keyboard: true },
    );
  } catch (error) {
    console.error("Could not send Telegram group confirmation", error);
  }
}

async function sendGroupDraftLaunch(message: TelegramMessage): Promise<void> {
  const target = await resolveNewDraftTarget(message);
  if (!target) {
    await sendTelegramMessage(
      String(message.chat.id),
      "Send /newdraft in a Telegram group where the bot is an administrator.",
    );
    return;
  }
  const token = randomUUID();
  await prisma.telegramDraftLaunch.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await prisma.telegramDraftLaunch.create({
    data: {
      token,
      telegramChatId: String(target.id),
      telegramChatTitle: target.title,
      telegramChatUsername: target.username,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    },
  });
  try {
    await sendTelegramMessage(
      String(message.chat.id),
      `Create a draft for ${target.title ?? "this chat"}. The link expires in one hour and can be used once.`,
      groupDraftLaunchReplyMarkup(token),
    );
  } catch (error) {
    await prisma.telegramDraftLaunch.deleteMany({ where: { token } });
    throw error;
  }
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
  if (!message) return context.json({ ok: true });
  const [rawCommand, argument] = message.text?.trim().split(/\s+/, 2) ?? [];
  const command = rawCommand?.split("@", 1)[0]?.toLocaleLowerCase();

  if (command === "/newdraft") {
    try {
      await sendGroupDraftLaunch(message);
    } catch (error) {
      await prisma.telegramUpdate.deleteMany({ where: { updateId: String(update.update_id) } });
      throw error;
    }
    return context.json({ ok: true });
  }

  if (!message.from) return context.json({ ok: true });
  const user = await prisma.user.upsert({
    where: { telegramId: String(message.from.id) },
    create: {
      telegramId: String(message.from.id),
      displayName: [message.from.first_name, message.from.last_name].filter(Boolean).join(" "),
      username: message.from.username,
    },
    update: {
      displayName: [message.from.first_name, message.from.last_name].filter(Boolean).join(" "),
      username: message.from.username,
    },
  });

  if (message.chat_shared) {
    try {
      await bindSharedGroup(message, user);
    } catch (error) {
      console.error("Telegram group binding failed", error);
      await prisma.telegramUpdate.deleteMany({ where: { updateId: String(update.update_id) } });
      throw error;
    }
    return context.json({ ok: true });
  }
  if (!message.text) return context.json({ ok: true });

  if (command === "/start") {
    if (argument?.startsWith("web_") && message.chat.type === "private") {
      const result = await claimBrowserSession(argument.slice(4), user.id);
      await sendTelegramMessage(
        String(message.chat.id),
        result === "expired"
          ? "That browser sign-in link has expired. Return to the website and request a new one."
          : "Browser connected. You can return to Imperium Draft and use the full app there.",
      );
    } else {
      await sendTelegramMessage(
        String(message.chat.id),
        `Create or join a Twilight Imperium draft in the Mini App:\n${miniAppLink()}`,
      );
    }
  } else if (command === "/draft" && !argument) {
    await sendTelegramMessage(String(message.chat.id), "Usage: /draft <draft-link-code>");
  } else if (command === "/draft" && argument) {
    const draft = await prisma.draft.findUnique({ where: { slug: argument } });
    if (!draft) {
      await sendTelegramMessage(String(message.chat.id), "I could not find that draft.");
    } else if (draft.creatorUserId !== user.id) {
      await sendTelegramMessage(String(message.chat.id), "Only the draft creator can connect it to this chat.");
    } else if (message.chat.type === "private") {
      await sendTelegramMessage(
        String(message.chat.id),
        "Use the group picker in the Mini App, or send this command in a group.",
      );
    } else {
      await prisma.draft.update({
        where: { id: draft.id },
        data: {
          telegramChatId: String(message.chat.id),
          telegramChatTitle: message.chat.title,
          telegramChatUsername: message.chat.username,
          telegramChannelRequestId: null,
        },
      });
      await prisma.draftEvent.create({
        data: {
          draftId: draft.id,
          actorUserId: user.id,
          type: "CHAT_BOUND",
          payload: { chatId: String(message.chat.id) },
        },
      });
      await sendTelegramMessage(
        String(message.chat.id),
        `Connected to ${draft.title}.\nOpen the draft: ${miniAppLink(draft.slug)}`,
      );
    }
  } else if (command === "/status") {
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
    await sendTelegramMessage(
      String(message.chat.id),
      draft
        ? `${draft.title}: ${draft.status.toLowerCase()}, ${progress}.\n${miniAppLink(draft.slug)}`
        : "This chat is not connected to an active draft. Use /draft <draft-link-code>.",
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
          await sendTelegramMessage(job.chatId, job.message);
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
