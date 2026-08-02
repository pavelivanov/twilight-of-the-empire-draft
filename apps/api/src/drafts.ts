import { randomInt, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import {
  GENERATOR_VERSION,
  createDraftSchema,
  createTurnOrder,
  draftConfigSchema,
  generateBalancedSlices,
  generateFactionPool,
  pickSchema,
  playerColors,
  positionCatalog,
  seededRandom,
  shuffle,
  type PublicDraftSummary,
} from "@imperium/domain";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import type { ApiEnvironment } from "./auth.js";
import { env } from "./env.js";
import { ApiError } from "./errors.js";
import { prisma } from "./prisma.js";
import { presentDraft } from "./presenter.js";
import { miniAppLink, sendTelegramGroupPicker, verifyTelegramNotificationChatAccess } from "./telegram.js";

export const draftsRouter = new Hono<ApiEnvironment>();

const serializableRetryLimit = 8;
const banSchema = pickSchema.extend({ playerId: z.string().min(1).optional() });

type NotificationDraft = {
  id: string;
  telegramChatId: string | null;
};

type TelegramDraftLaunch = {
  token: string;
  telegramChatId: string;
  telegramChatTitle: string;
  telegramChatUsername?: string;
};

async function queueDraftNotification(
  transaction: Prisma.TransactionClient,
  draft: NotificationDraft,
  eventId: string,
  message: string,
): Promise<void> {
  if (!draft.telegramChatId) return;
  await transaction.notificationOutbox.create({
    data: {
      draftId: draft.id,
      eventId,
      chatId: draft.telegramChatId,
      message,
    },
  });
}

async function reserveTelegramChannelRequest(draftId: string): Promise<number> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const requestId = randomInt(1, 2_147_483_647);
    try {
      await prisma.draft.update({
        where: { id: draftId },
        data: { telegramChannelRequestId: requestId },
      });
      return requestId;
    } catch (error) {
      const collision = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!collision) throw error;
    }
  }
  throw new ApiError(500, "GROUP_REQUEST_FAILED", "Could not create a Telegram group request");
}

async function verifyTelegramDraftLaunch(
  token: string | undefined,
  actor: { telegramId: string; isDemo: boolean },
): Promise<TelegramDraftLaunch | undefined> {
  if (!token) return undefined;
  if (actor.isDemo) {
    throw new ApiError(409, "TELEGRAM_REQUIRED", "Open this group link inside the Telegram Mini App");
  }
  const launch = await prisma.telegramDraftLaunch.findFirst({
    where: { token, expiresAt: { gt: new Date() } },
  });
  if (!launch) {
    throw new ApiError(409, "GROUP_LAUNCH_EXPIRED", "This group draft link has expired or was already used");
  }
  const telegramUserId = Number(actor.telegramId);
  if (!Number.isSafeInteger(telegramUserId)) {
    throw new ApiError(401, "INVALID_TELEGRAM_USER", "Telegram user identity is invalid");
  }
  try {
    const chat = await verifyTelegramNotificationChatAccess(launch.telegramChatId, telegramUserId);
    return {
      token,
      telegramChatId: launch.telegramChatId,
      telegramChatTitle: chat.title ?? launch.telegramChatTitle ?? chat.username ?? "Telegram group",
      telegramChatUsername: chat.username ?? launch.telegramChatUsername ?? undefined,
    };
  } catch (error) {
    throw new ApiError(
      403,
      "GROUP_ACCESS_REQUIRED",
      error instanceof Error ? error.message : "You and the bot must be administrators in this group",
    );
  }
}

async function withSerializableRetry<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < serializableRetryLimit; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const isWriteConflict =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!isWriteConflict) throw error;
      if (attempt === serializableRetryLimit - 1) {
        throw new ApiError(409, "DRAFT_BUSY", "The draft is busy; try again");
      }
    }
  }
  throw new ApiError(409, "DRAFT_BUSY", "The draft is busy; try again");
}

const slugify = (value: string): string =>
  value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);

async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title) || "imperium-draft";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = randomUUID().slice(0, 6);
    const slug = `${base}-${suffix}`;
    if (!(await prisma.draft.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  throw new ApiError(500, "SLUG_FAILED", "Could not create a unique draft link");
}

function buildPositionOptions(playerCount: number) {
  return positionCatalog.slice(0, playerCount).map((position, sortOrder) => ({
    kind: "POSITION" as const,
    key: position.id,
    label: position.label,
    sortOrder,
    payload: position,
  }));
}

function buildOptions(seed: string, config: z.infer<typeof createDraftSchema>["config"]) {
  const slices = generateBalancedSlices(`${seed}:slices`, config.balance);
  const factions = generateFactionPool(seed, config);
  return [
    ...factions.map((faction, sortOrder) => ({
      kind: "FACTION" as const,
      key: faction.id,
      label: faction.name,
      sortOrder,
      payload: faction,
    })),
    ...slices.map((slice, sortOrder) => ({
      kind: "SLICE" as const,
      key: slice.id,
      label: slice.name,
      sortOrder,
      payload: slice,
    })),
    ...buildPositionOptions(config.playerCount),
  ];
}

function draftActionsLocked(draft: {
  status: string;
  turnCursor: number;
  options: Array<{ selectedByPlayerId: string | null; bannedByPlayerId: string | null }>;
}): boolean {
  return (
    draft.status === "COMPLETE" ||
    draft.status === "ARCHIVED" ||
    draft.turnCursor > 0 ||
    draft.options.some((option) => option.selectedByPlayerId || option.bannedByPlayerId)
  );
}

async function activateLegacyDraft(draftIdOrSlug: string): Promise<void> {
  await withSerializableRetry(async (transaction) => {
    const draft = await transaction.draft.findFirst({
      where: { OR: [{ id: draftIdOrSlug }, { slug: draftIdOrSlug }] },
      include: { players: { orderBy: { orderIndex: "asc" } } },
    });
    if (!draft || draft.status !== "SETUP") return;

    const firstPlayer = draft.players[0];
    if (!firstPlayer) return;
    const config = draftConfigSchema.parse(draft.config);
    const withBanPhase = config.bansPerPlayer > 0;
    const updated = await transaction.draft.updateMany({
      where: { id: draft.id, status: "SETUP" },
      data: {
        status: withBanPhase ? "BANNING" : "DRAFTING",
        startedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) return;

    const event = await transaction.draftEvent.create({
      data: {
        draftId: draft.id,
        type: "DRAFT_STARTED",
        actorUserId: draft.creatorUserId,
        payload: {
          activePlayerId: firstPlayer.id,
          banPhase: withBanPhase,
          automatic: true,
          upgradedLegacy: true,
        },
      },
    });
    if (draft.telegramChatId) {
      await transaction.notificationOutbox.create({
        data: {
          draftId: draft.id,
          eventId: event.id,
          chatId: draft.telegramChatId,
          message: withBanPhase
            ? `🚀 ${draft.title} has started automatically.\nBan phase first — everyone picks one faction to remove.`
            : `🚀 ${draft.title} has started automatically.\n${firstPlayer.displayName}, you are first to choose.`,
        },
      });
    }
  });
}

draftsRouter.get("/", async (context) => {
  const actor = context.get("actor");
  const legacyDrafts = await prisma.draft.findMany({
    where: { creatorUserId: actor.userId, status: "SETUP" },
    select: { id: true },
  });
  await Promise.all(legacyDrafts.map((draft) => activateLegacyDraft(draft.id)));
  const drafts = await prisma.draft.findMany({
    where: { creatorUserId: actor.userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      players: { select: { userId: true } },
    },
  });
  const summaries: PublicDraftSummary[] = drafts.map((draft) => ({
    id: draft.id,
    slug: draft.slug,
    title: draft.title,
    status: draft.status,
    playerCount: draft.players.length,
    claimedPlayerCount: draft.players.filter((player) => Boolean(player.userId)).length,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  }));
  return context.json(summaries);
});

draftsRouter.post("/", zValidator("json", createDraftSchema), async (context) => {
  const actor = context.get("actor");
  const input = context.req.valid("json");
  const telegramLaunch = await verifyTelegramDraftLaunch(input.telegramLaunchToken, actor);
  const seed = input.seed ?? randomUUID();
  const slug = await uniqueSlug(input.title);
  const options = buildOptions(seed, input.config);
  const withBanPhase = input.config.bansPerPlayer > 0;
  const startedAt = new Date();
  const randomizedPlayers = shuffle(
    input.players.map((player, inputIndex) => ({ ...player, inputIndex })),
    seededRandom(`${seed}:players`),
  );
  const draft = await withSerializableRetry(
    async (transaction) => {
      if (telegramLaunch) {
        const consumed = await transaction.telegramDraftLaunch.deleteMany({
          where: { token: telegramLaunch.token, expiresAt: { gt: startedAt } },
        });
        if (consumed.count !== 1) {
          throw new ApiError(409, "GROUP_LAUNCH_EXPIRED", "This group draft link has expired or was already used");
        }
      }
      const created = await transaction.draft.create({
        data: {
          slug,
          title: input.title,
          status: withBanPhase ? "BANNING" : "DRAFTING",
          creatorUserId: actor.userId,
          telegramChatId: telegramLaunch?.telegramChatId,
          telegramChatTitle: telegramLaunch?.telegramChatTitle,
          telegramChatUsername: telegramLaunch?.telegramChatUsername,
          playerCount: input.config.playerCount,
          seed,
          generatorVersion: GENERATOR_VERSION,
          config: input.config,
          startedAt,
          players: {
            create: randomizedPlayers.map((player, orderIndex) => ({
              displayName: player.displayName,
              telegramUsername: player.telegramUsername,
              orderIndex,
              color: playerColors[orderIndex]!,
              userId: player.inputIndex === 0 ? actor.userId : undefined,
            })),
          },
          options: { create: options },
        },
        select: {
          id: true,
          players: {
            orderBy: { orderIndex: "asc" },
            select: { id: true },
          },
        },
      });
      await transaction.draftEvent.create({
        data: {
          draftId: created.id,
          type: "DRAFT_CREATED",
          actorUserId: actor.userId,
          payload: {
            seed,
            playerCount: input.config.playerCount,
            sliceCount: input.config.sliceCount,
            factionCount: input.config.factionCount,
          },
        },
      });
      if (telegramLaunch) {
        const chatBoundEvent = await transaction.draftEvent.create({
          data: {
            draftId: created.id,
            type: "CHAT_BOUND",
            actorUserId: actor.userId,
            payload: {
              chatId: telegramLaunch.telegramChatId,
              chatTitle: telegramLaunch.telegramChatTitle,
              chatUsername: telegramLaunch.telegramChatUsername,
              source: "group_command",
            },
          },
        });
        await transaction.notificationOutbox.create({
          data: {
            draftId: created.id,
            eventId: chatBoundEvent.id,
            chatId: telegramLaunch.telegramChatId,
            message: `📣 Owner created ${input.title} and connected this group. Every accepted player and owner action will be posted here.\nOpen the draft: ${miniAppLink(slug)}`,
          },
        });
      }
      await transaction.draftEvent.create({
        data: {
          draftId: created.id,
          type: "DRAFT_STARTED",
          actorUserId: actor.userId,
          payload: {
            activePlayerId: created.players[0]!.id,
            banPhase: withBanPhase,
            automatic: true,
          },
        },
      });
      return created;
    },
  );
  return context.json(await presentDraft(draft.id, actor.userId), 201);
});

draftsRouter.get("/:draftId", async (context) => {
  const actor = context.get("actor");
  await activateLegacyDraft(context.req.param("draftId"));
  const draft = await presentDraft(context.req.param("draftId"), actor.userId);
  if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
  return context.json(draft);
});

draftsRouter.post("/:draftId/telegram-channel-picker", async (context) => {
  const actor = context.get("actor");
  if (actor.isDemo) {
    throw new ApiError(409, "TELEGRAM_REQUIRED", "Open the Mini App in Telegram to choose a group");
  }
  if (!env.BOT_TOKEN) {
    throw new ApiError(503, "BOT_NOT_CONFIGURED", "Telegram group notifications are not configured");
  }
  const draftId = context.req.param("draftId");
  const draft = await prisma.draft.findFirst({
    where: { OR: [{ id: draftId }, { slug: draftId }] },
    select: { id: true, title: true, creatorUserId: true },
  });
  if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
  if (draft.creatorUserId !== actor.userId) {
    throw new ApiError(403, "CREATOR_REQUIRED", "Only the creator can choose the notification group");
  }

  const requestId = await reserveTelegramChannelRequest(draft.id);
  try {
    await sendTelegramGroupPicker(actor.telegramId, draft.title, requestId);
  } catch (error) {
    await prisma.draft.updateMany({
      where: { id: draft.id, telegramChannelRequestId: requestId },
      data: { telegramChannelRequestId: null },
    });
    console.error("Could not send Telegram group picker", error);
    throw new ApiError(
      502,
      "GROUP_PICKER_UNAVAILABLE",
      "Could not open the group picker. Open the bot privately, press Start, and try again",
    );
  }
  return context.json({ requested: true });
});

draftsRouter.delete("/:draftId", async (context) => {
  const actor = context.get("actor");
  const draftId = context.req.param("draftId");
  const draft = await prisma.draft.findFirst({
    where: { OR: [{ id: draftId }, { slug: draftId }] },
    select: { id: true, slug: true, title: true, creatorUserId: true, telegramChatId: true },
  });
  if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
  if (draft.creatorUserId !== actor.userId) {
    throw new ApiError(403, "CREATOR_REQUIRED", "Only the creator can delete the draft");
  }
  await prisma.$transaction(async (transaction) => {
    if (draft.telegramChatId) {
      const event = await transaction.draftEvent.create({
        data: {
          draftId: draft.id,
          type: "DRAFT_DELETED",
          actorUserId: actor.userId,
          payload: { title: draft.title },
        },
      });
      await queueDraftNotification(
        transaction,
        draft,
        event.id,
        `🗑 Owner deleted ${draft.title}. This draft is no longer available.`,
      );
    }
    await transaction.draft.delete({ where: { id: draft.id } });
  });
  return context.json({ id: draft.id, slug: draft.slug });
});

draftsRouter.post(
  "/:draftId/players/:playerId/claim",
  zValidator("json", z.object({ version: z.number().int().nonnegative() })),
  async (context) => {
    const actor = context.get("actor");
    const input = context.req.valid("json");
    const draftId = context.req.param("draftId");
    const playerId = context.req.param("playerId");
    await withSerializableRetry(
      async (transaction) => {
        const draft = await transaction.draft.findFirst({
          where: { OR: [{ id: draftId }, { slug: draftId }] },
          include: { players: true },
        });
        if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
        if (draft.status === "ARCHIVED") {
          throw new ApiError(409, "CLAIMS_CLOSED", "Seats cannot be claimed after the draft is archived");
        }
        if (draft.version !== input.version) throw new ApiError(409, "STALE_DRAFT", "The draft changed; refresh and try again");
        if (draft.players.some((player) => player.userId === actor.userId)) {
          throw new ApiError(409, "ALREADY_CLAIMED", "You already own a player seat");
        }
        const player = draft.players.find((candidate) => candidate.id === playerId);
        if (!player) throw new ApiError(404, "PLAYER_NOT_FOUND", "Player seat not found");
        if (player.userId) throw new ApiError(409, "SEAT_TAKEN", "That player seat is already claimed");
        if (
          player.telegramUsername &&
          player.telegramUsername.toLocaleLowerCase() !== actor.username?.toLocaleLowerCase()
        ) {
          throw new ApiError(403, "USERNAME_MISMATCH", "This seat is reserved for another Telegram username");
        }
        await transaction.draftPlayer.update({ where: { id: player.id }, data: { userId: actor.userId } });
        await transaction.draft.update({
          where: { id: draft.id },
          data: { version: { increment: 1 } },
        });
        const event = await transaction.draftEvent.create({
          data: {
            draftId: draft.id,
            type: "PLAYER_CLAIMED",
            actorUserId: actor.userId,
            playerId: player.id,
            payload: { playerName: player.displayName },
          },
        });
        await queueDraftNotification(
          transaction,
          draft,
          event.id,
          `👤 ${player.displayName} claimed their seat in ${draft.title}.`,
        );
      },
    );
    return context.json(await presentDraft(draftId, actor.userId));
  },
);

draftsRouter.delete(
  "/:draftId/players/:playerId/claim",
  zValidator("query", z.object({ version: z.coerce.number().int().nonnegative() })),
  async (context) => {
    const actor = context.get("actor");
    const input = context.req.valid("query");
    const draftId = context.req.param("draftId");
    const playerId = context.req.param("playerId");
    await prisma.$transaction(
      async (transaction) => {
        const draft = await transaction.draft.findFirst({
          where: { OR: [{ id: draftId }, { slug: draftId }] },
          include: {
            players: true,
            options: { select: { selectedByPlayerId: true, bannedByPlayerId: true } },
          },
        });
        if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
        if (draftActionsLocked(draft)) {
          throw new ApiError(409, "DRAFT_LOCKED", "Seats cannot be released after the first selection");
        }
        if (draft.version !== input.version) {
          throw new ApiError(409, "STALE_DRAFT", "The draft changed; refresh and try again");
        }
        const player = draft.players.find((candidate) => candidate.id === playerId);
        if (!player) throw new ApiError(404, "PLAYER_NOT_FOUND", "Player seat not found");
        if (!player.userId) throw new ApiError(409, "SEAT_NOT_CLAIMED", "That player seat is not claimed");
        if (player.userId !== actor.userId) {
          throw new ApiError(403, "SEAT_OWNER_REQUIRED", "Only the player in this seat can release it");
        }
        await transaction.draftPlayer.update({ where: { id: player.id }, data: { userId: null } });
        await transaction.draft.update({ where: { id: draft.id }, data: { version: { increment: 1 } } });
        const event = await transaction.draftEvent.create({
          data: {
            draftId: draft.id,
            type: "PLAYER_UNCLAIMED",
            actorUserId: actor.userId,
            playerId: player.id,
            payload: { playerName: player.displayName },
          },
        });
        await queueDraftNotification(
          transaction,
          draft,
          event.id,
          `↪ ${player.displayName} released their seat in ${draft.title}.`,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return context.json(await presentDraft(draftId, actor.userId));
  },
);

draftsRouter.delete(
  "/:draftId/players/:playerId",
  zValidator("query", z.object({ version: z.coerce.number().int().nonnegative() })),
  async (context) => {
    const actor = context.get("actor");
    const input = context.req.valid("query");
    const draftId = context.req.param("draftId");
    const playerId = context.req.param("playerId");
    await prisma.$transaction(
      async (transaction) => {
        const draft = await transaction.draft.findFirst({
          where: { OR: [{ id: draftId }, { slug: draftId }] },
          include: {
            players: { orderBy: { orderIndex: "asc" } },
            options: { select: { selectedByPlayerId: true, bannedByPlayerId: true } },
          },
        });
        if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
        if (draft.creatorUserId !== actor.userId) {
          throw new ApiError(403, "CREATOR_REQUIRED", "Only the creator can remove players");
        }
        if (draftActionsLocked(draft)) {
          throw new ApiError(409, "DRAFT_LOCKED", "Players cannot be removed after the first selection");
        }
        if (draft.version !== input.version) {
          throw new ApiError(409, "STALE_DRAFT", "The draft changed; refresh and try again");
        }
        if (draft.players.length <= 3) {
          throw new ApiError(409, "MINIMUM_PLAYERS", "A draft needs at least three players");
        }
        const player = draft.players.find((candidate) => candidate.id === playerId);
        if (!player) throw new ApiError(404, "PLAYER_NOT_FOUND", "Player seat not found");

        const playerCount = draft.players.length - 1;
        const config = { ...draftConfigSchema.parse(draft.config), playerCount };
        const event = await transaction.draftEvent.create({
          data: {
            draftId: draft.id,
            type: "PLAYER_REMOVED",
            actorUserId: actor.userId,
            playerId: player.id,
            payload: { playerName: player.displayName, wasClaimed: Boolean(player.userId) },
          },
        });
        await queueDraftNotification(
          transaction,
          draft,
          event.id,
          `− Owner removed ${player.displayName} from ${draft.title}.`,
        );
        await transaction.draftPlayer.delete({ where: { id: player.id } });
        await transaction.draftPlayer.updateMany({
          where: { draftId: draft.id, orderIndex: { gt: player.orderIndex } },
          data: { orderIndex: { decrement: 1 } },
        });
        await transaction.draftOption.deleteMany({ where: { draftId: draft.id, kind: "POSITION" } });
        await transaction.draftOption.createMany({
          data: buildPositionOptions(playerCount).map((option) => ({ ...option, draftId: draft.id })),
        });
        await transaction.draft.update({
          where: { id: draft.id },
          data: { playerCount, config, version: { increment: 1 } },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return context.json(await presentDraft(draftId, actor.userId));
  },
);

draftsRouter.post(
  "/:draftId/regenerate",
  zValidator("json", z.object({ version: z.number().int().nonnegative(), seed: z.string().min(1).max(80).optional() })),
  async (context) => {
    const actor = context.get("actor");
    const input = context.req.valid("json");
    const draftId = context.req.param("draftId");
    await prisma.$transaction(
      async (transaction) => {
        const draft = await transaction.draft.findFirst({
          where: { OR: [{ id: draftId }, { slug: draftId }] },
          include: {
            options: { select: { selectedByPlayerId: true, bannedByPlayerId: true } },
          },
        });
        if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
        if (draft.creatorUserId !== actor.userId) throw new ApiError(403, "CREATOR_REQUIRED", "Only the creator can regenerate the pool");
        if (draftActionsLocked(draft)) {
          throw new ApiError(409, "DRAFT_LOCKED", "Pools are frozen after the first selection");
        }
        if (draft.version !== input.version) throw new ApiError(409, "STALE_DRAFT", "The draft changed; refresh and try again");
        const seed = input.seed ?? randomUUID();
        const options = buildOptions(seed, z.parse(createDraftSchema.shape.config, draft.config));
        await transaction.draftOption.deleteMany({ where: { draftId: draft.id } });
        await transaction.draftOption.createMany({ data: options.map((option) => ({ ...option, draftId: draft.id })) });
        await transaction.draft.update({
          where: { id: draft.id },
          data: { seed, version: { increment: 1 }, generatorVersion: GENERATOR_VERSION },
        });
        const event = await transaction.draftEvent.create({
          data: {
            draftId: draft.id,
            type: "POOL_REGENERATED",
            actorUserId: actor.userId,
            payload: { seed },
          },
        });
        await queueDraftNotification(
          transaction,
          draft,
          event.id,
          `⟳ Owner regenerated the option pool for ${draft.title}.`,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return context.json(await presentDraft(draftId, actor.userId));
  },
);

draftsRouter.post(
  "/:draftId/start",
  zValidator("json", z.object({ version: z.number().int().nonnegative() })),
  async (context) => {
    const actor = context.get("actor");
    const input = context.req.valid("json");
    const draftId = context.req.param("draftId");
    await prisma.$transaction(
      async (transaction) => {
        const draft = await transaction.draft.findFirst({
          where: { OR: [{ id: draftId }, { slug: draftId }] },
          include: { players: { orderBy: { orderIndex: "asc" } } },
        });
        if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
        if (draft.creatorUserId !== actor.userId) throw new ApiError(403, "CREATOR_REQUIRED", "Only the creator can start the draft");
        if (draft.status !== "SETUP") throw new ApiError(409, "INVALID_STATUS", "The draft is not in setup");
        if (draft.version !== input.version) throw new ApiError(409, "STALE_DRAFT", "The draft changed; refresh and try again");
        const config = draftConfigSchema.parse(draft.config);
        const withBanPhase = config.bansPerPlayer > 0;
        const event = await transaction.draftEvent.create({
          data: {
            draftId: draft.id,
            type: "DRAFT_STARTED",
            actorUserId: actor.userId,
            payload: { activePlayerId: draft.players[0]!.id, banPhase: withBanPhase, automatic: false },
          },
        });
        await transaction.draft.update({
          where: { id: draft.id },
          data: {
            status: withBanPhase ? "BANNING" : "DRAFTING",
            startedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (draft.telegramChatId) {
          await transaction.notificationOutbox.create({
            data: {
              draftId: draft.id,
              eventId: event.id,
              chatId: draft.telegramChatId,
              message: withBanPhase
                ? `🚀 ${draft.title} has started.\nBan phase first — everyone picks one faction to remove.`
                : `🚀 ${draft.title} has started.\n${draft.players[0]!.displayName}, you are first to choose.`,
            },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return context.json(await presentDraft(draftId, actor.userId));
  },
);

draftsRouter.post("/:draftId/bans", zValidator("json", banSchema), async (context) => {
  const actor = context.get("actor");
  const input = context.req.valid("json");
  const draftId = context.req.param("draftId");
  await withSerializableRetry(async (transaction) => {
    const existingEvent = await transaction.draftEvent.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (!existingEvent) {
      const draft = await transaction.draft.findFirst({
        where: { OR: [{ id: draftId }, { slug: draftId }] },
        include: {
          players: { orderBy: { orderIndex: "asc" } },
          options: true,
        },
      });
      if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
      if (draft.status !== "BANNING") {
        throw new ApiError(409, "INVALID_STATUS", "The draft is not in the ban phase");
      }
      if (input.version > draft.version) {
        throw new ApiError(409, "STALE_DRAFT", "The draft changed; refresh and try again");
      }
      const actorPlayer = draft.players.find((candidate) => candidate.userId === actor.userId);
      const player = input.playerId
        ? draft.players.find((candidate) => candidate.id === input.playerId)
        : actorPlayer;
      if (input.playerId && draft.creatorUserId !== actor.userId) {
        throw new ApiError(403, "CREATOR_REQUIRED", "Only the creator can ban for another player");
      }
      if (!player) throw new ApiError(403, "SEAT_REQUIRED", "Choose a valid player before locking a ban");
      const performedByCreator = draft.creatorUserId === actor.userId && player.userId !== actor.userId;
      if (draft.options.some((candidate) => candidate.bannedByPlayerId === player.id)) {
        throw new ApiError(409, "ALREADY_BANNED", "You already locked your ban");
      }
      const option = draft.options.find((candidate) => candidate.id === input.optionId);
      if (!option) throw new ApiError(404, "OPTION_NOT_FOUND", "Draft option not found");
      if (option.kind !== "FACTION") throw new ApiError(409, "INVALID_OPTION", "Only factions can be banned");
      if (option.bannedByPlayerId) throw new ApiError(409, "OPTION_BANNED", "That faction is already banned");
      const banned = await transaction.draftOption.updateMany({
        where: { id: option.id, bannedByPlayerId: null },
        data: { bannedByPlayerId: player.id, bannedAt: new Date() },
      });
      if (banned.count !== 1) throw new ApiError(409, "OPTION_BANNED", "That faction was just banned");
      const event = await transaction.draftEvent.create({
        data: {
          draftId: draft.id,
          type: "PLAYER_BANNED",
          actorUserId: actor.userId,
          playerId: player.id,
          idempotencyKey: input.idempotencyKey,
          payload: {
            optionId: option.id,
            optionKind: option.kind,
            optionKey: option.key,
            optionLabel: option.label,
            playerName: player.displayName,
            performedByCreator,
          },
        },
      });
      const lockedCount = await transaction.draftOption.count({
        where: { draftId: draft.id, bannedByPlayerId: { not: null } },
      });
      const allLocked = lockedCount === draft.players.length;
      if (allLocked) {
        await transaction.draftEvent.create({
          data: {
            draftId: draft.id,
            type: "BAN_PHASE_COMPLETED",
            actorUserId: actor.userId,
            payload: { bannedCount: lockedCount },
          },
        });
      }
      await transaction.draft.update({
        where: { id: draft.id },
        data: {
          status: allLocked ? "DRAFTING" : "BANNING",
          version: { increment: 1 },
        },
      });
      if (draft.telegramChatId) {
        const firstPlayer = draft.players[0]!;
        await transaction.notificationOutbox.create({
          data: {
            draftId: draft.id,
            eventId: event.id,
            chatId: draft.telegramChatId,
            message: allLocked
              ? `🚫 ${performedByCreator ? `Owner banned ${option.label} for ${player.displayName}` : `${player.displayName} banned ${option.label}`}. All bans are locked.\n${firstPlayer.displayName}, you are first to choose.`
              : `🚫 ${performedByCreator ? `Owner banned ${option.label} for ${player.displayName}` : `${player.displayName} banned ${option.label}`}. ${lockedCount}/${draft.players.length} bans locked.`,
          },
        });
      }
    }
  });
  return context.json(await presentDraft(draftId, actor.userId));
});

draftsRouter.post("/:draftId/picks", zValidator("json", pickSchema), async (context) => {
  const actor = context.get("actor");
  const input = context.req.valid("json");
  const draftId = context.req.param("draftId");
  const existingEvent = await prisma.draftEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (!existingEvent) {
    await prisma.$transaction(
      async (transaction) => {
        const draft = await transaction.draft.findFirst({
          where: { OR: [{ id: draftId }, { slug: draftId }] },
          include: {
            players: { orderBy: { orderIndex: "asc" } },
            options: true,
          },
        });
        if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
        if (draft.status !== "DRAFTING") throw new ApiError(409, "INVALID_STATUS", "The draft is not accepting picks");
        if (draft.version !== input.version) throw new ApiError(409, "STALE_DRAFT", "The draft changed; refresh and try again");
        const turnOrder = createTurnOrder(draft.players.map((player) => player.id));
        const player = draft.players.find((candidate) => candidate.id === turnOrder[draft.turnCursor]);
        if (!player) throw new ApiError(409, "INVALID_TURN", "The active draft turn is invalid");
        const performedByCreator = draft.creatorUserId === actor.userId && player.userId !== actor.userId;
        if (player.userId !== actor.userId && !performedByCreator) {
          throw new ApiError(403, "NOT_YOUR_TURN", "It is not your turn");
        }
        const option = draft.options.find((candidate) => candidate.id === input.optionId);
        if (!option) throw new ApiError(404, "OPTION_NOT_FOUND", "Draft option not found");
        if (option.bannedByPlayerId) throw new ApiError(409, "OPTION_BANNED", "That faction was banned before the draft");
        if (option.selectedByPlayerId) throw new ApiError(409, "OPTION_TAKEN", "That option has already been selected");
        if (
          draft.options.some(
            (candidate) => candidate.kind === option.kind && candidate.selectedByPlayerId === player.id,
          )
        ) {
          throw new ApiError(409, "KIND_ALREADY_SELECTED", `You already selected a ${option.kind.toLowerCase()}`);
        }
        const claimed = await transaction.draftOption.updateMany({
          where: { id: option.id, selectedByPlayerId: null },
          data: { selectedByPlayerId: player.id, selectedAt: new Date() },
        });
        if (claimed.count !== 1) throw new ApiError(409, "OPTION_TAKEN", "That option was just selected");
        const nextCursor = draft.turnCursor + 1;
        const completed = nextCursor === turnOrder.length;
        const nextPlayer = draft.players.find((candidate) => candidate.id === turnOrder[nextCursor]);
        const event = await transaction.draftEvent.create({
          data: {
            draftId: draft.id,
            type: "OPTION_SELECTED",
            actorUserId: actor.userId,
            playerId: player.id,
            idempotencyKey: input.idempotencyKey,
            payload: {
              optionId: option.id,
              optionKind: option.kind,
              optionKey: option.key,
              optionLabel: option.label,
              playerName: player.displayName,
              turnIndex: draft.turnCursor,
              performedByCreator,
            },
          },
        });
        await transaction.draft.update({
          where: { id: draft.id },
          data: {
            turnCursor: nextCursor,
            version: { increment: 1 },
            status: completed ? "COMPLETE" : "DRAFTING",
            completedAt: completed ? new Date() : undefined,
          },
        });
        if (draft.telegramChatId) {
          const nextLine = completed
            ? "The draft is complete. Open the Mini App to inspect the final map."
            : `${nextPlayer!.telegramUsername ? `@${nextPlayer!.telegramUsername}` : nextPlayer!.displayName}, you are next.`;
          await transaction.notificationOutbox.create({
            data: {
              draftId: draft.id,
              eventId: event.id,
              chatId: draft.telegramChatId,
              message: performedByCreator
                ? `◆ Owner selected ${option.label} (${option.kind.toLowerCase()}) for ${player.displayName}.\n${nextLine}`
                : `◆ ${player.displayName} selected ${option.label} (${option.kind.toLowerCase()}).\n${nextLine}`,
            },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  return context.json(await presentDraft(draftId, actor.userId));
});

draftsRouter.post(
  "/:draftId/picks/undo",
  zValidator("json", z.object({ version: z.number().int().nonnegative() })),
  async (context) => {
    const actor = context.get("actor");
    const input = context.req.valid("json");
    const draftId = context.req.param("draftId");
    await prisma.$transaction(
      async (transaction) => {
        const draft = await transaction.draft.findFirst({
          where: { OR: [{ id: draftId }, { slug: draftId }] },
          include: {
            players: { orderBy: { orderIndex: "asc" } },
            options: true,
          },
        });
        if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
        if (draft.creatorUserId !== actor.userId) {
          throw new ApiError(403, "CREATOR_REQUIRED", "Only the creator can undo a selection");
        }
        if (draft.status !== "DRAFTING" && draft.status !== "COMPLETE") {
          throw new ApiError(409, "INVALID_STATUS", "There is no draft selection to undo");
        }
        if (draft.version !== input.version) {
          throw new ApiError(409, "STALE_DRAFT", "The draft changed; refresh and try again");
        }
        if (draft.turnCursor === 0) {
          throw new ApiError(409, "NO_SELECTION", "There is no selection to undo");
        }

        const turnOrder = createTurnOrder(draft.players.map((player) => player.id));
        const turnIndex = draft.turnCursor - 1;
        const player = draft.players.find((candidate) => candidate.id === turnOrder[turnIndex]);
        if (!player) throw new ApiError(409, "INVALID_TURN", "The previous draft turn is invalid");

        const selectedOptionIds = new Set(
          draft.options
            .filter((option) => option.selectedByPlayerId === player.id)
            .map((option) => option.id),
        );
        const pickEvents = await transaction.draftEvent.findMany({
          where: { draftId: draft.id, type: "OPTION_SELECTED" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        const pickEvent = pickEvents.find((event) => {
          const payload = event.payload as Record<string, unknown>;
          return payload.turnIndex === turnIndex && selectedOptionIds.has(String(payload.optionId ?? ""));
        }) ?? pickEvents.find((event) => {
          const payload = event.payload as Record<string, unknown>;
          return selectedOptionIds.has(String(payload.optionId ?? ""));
        });
        const eventPayload = pickEvent?.payload as Record<string, unknown> | undefined;
        const option = draft.options.find(
          (candidate) =>
            candidate.id === String(eventPayload?.optionId ?? "") && candidate.selectedByPlayerId === player.id,
        );
        if (!pickEvent || !option) {
          throw new ApiError(409, "SELECTION_NOT_FOUND", "The last selection could not be found");
        }

        const released = await transaction.draftOption.updateMany({
          where: { id: option.id, selectedByPlayerId: player.id },
          data: { selectedByPlayerId: null, selectedAt: null },
        });
        if (released.count !== 1) {
          throw new ApiError(409, "SELECTION_CHANGED", "The last selection already changed");
        }
        const event = await transaction.draftEvent.create({
          data: {
            draftId: draft.id,
            type: "PICK_REVERTED",
            actorUserId: actor.userId,
            playerId: player.id,
            payload: {
              originalEventId: pickEvent.id,
              optionId: option.id,
              optionKind: option.kind,
              optionKey: option.key,
              optionLabel: option.label,
              playerName: player.displayName,
              turnIndex,
              performedByCreator: true,
            },
          },
        });
        await transaction.draft.update({
          where: { id: draft.id },
          data: {
            turnCursor: turnIndex,
            version: { increment: 1 },
            status: "DRAFTING",
            completedAt: null,
          },
        });
        if (draft.telegramChatId) {
          await transaction.notificationOutbox.create({
            data: {
              draftId: draft.id,
              eventId: event.id,
              chatId: draft.telegramChatId,
              message: `↩ Owner undid ${option.label} for ${player.displayName}. It is ${player.displayName}'s turn again.`,
            },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return context.json(await presentDraft(draftId, actor.userId));
  },
);
