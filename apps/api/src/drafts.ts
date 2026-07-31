import { randomUUID } from "node:crypto";

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
import { ApiError } from "./errors.js";
import { prisma } from "./prisma.js";
import { presentDraft } from "./presenter.js";

export const draftsRouter = new Hono<ApiEnvironment>();

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

draftsRouter.get("/", async (context) => {
  const actor = context.get("actor");
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
  const seed = input.seed ?? randomUUID();
  const slug = await uniqueSlug(input.title);
  const options = buildOptions(seed, input.config);
  const randomizedPlayers = shuffle(
    input.players.map((player, inputIndex) => ({ ...player, inputIndex })),
    seededRandom(`${seed}:players`),
  );
  const draft = await prisma.$transaction(
    async (transaction) =>
      transaction.draft.create({
        data: {
          slug,
          title: input.title,
          creatorUserId: actor.userId,
          playerCount: input.config.playerCount,
          seed,
          generatorVersion: GENERATOR_VERSION,
          config: input.config,
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
          events: {
            create: {
              type: "DRAFT_CREATED",
              actorUserId: actor.userId,
              payload: {
                seed,
                playerCount: input.config.playerCount,
                sliceCount: input.config.sliceCount,
                factionCount: input.config.factionCount,
              },
            },
          },
        },
        select: { id: true },
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return context.json(await presentDraft(draft.id, actor.userId), 201);
});

draftsRouter.get("/:draftId", async (context) => {
  const actor = context.get("actor");
  const draft = await presentDraft(context.req.param("draftId"), actor.userId);
  if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
  return context.json(draft);
});

draftsRouter.delete("/:draftId", async (context) => {
  const actor = context.get("actor");
  const draftId = context.req.param("draftId");
  const draft = await prisma.draft.findFirst({
    where: { OR: [{ id: draftId }, { slug: draftId }] },
    select: { id: true, slug: true, creatorUserId: true },
  });
  if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
  if (draft.creatorUserId !== actor.userId) {
    throw new ApiError(403, "CREATOR_REQUIRED", "Only the creator can delete the draft");
  }
  await prisma.draft.delete({ where: { id: draft.id } });
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
    await prisma.$transaction(
      async (transaction) => {
        const draft = await transaction.draft.findFirst({
          where: { OR: [{ id: draftId }, { slug: draftId }] },
          include: { players: true },
        });
        if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
        if (draft.status !== "SETUP") throw new ApiError(409, "CLAIMS_CLOSED", "Seats can only be claimed before the draft starts");
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
        await transaction.draft.update({ where: { id: draft.id }, data: { version: { increment: 1 } } });
        await transaction.draftEvent.create({
          data: {
            draftId: draft.id,
            type: "PLAYER_CLAIMED",
            actorUserId: actor.userId,
            playerId: player.id,
            payload: { playerName: player.displayName },
          },
        });
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
          include: { players: { orderBy: { orderIndex: "asc" } } },
        });
        if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
        if (draft.creatorUserId !== actor.userId) {
          throw new ApiError(403, "CREATOR_REQUIRED", "Only the creator can remove players");
        }
        if (draft.status !== "SETUP") {
          throw new ApiError(409, "DRAFT_STARTED", "Players cannot be removed after the draft starts");
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
        await transaction.draftEvent.create({
          data: {
            draftId: draft.id,
            type: "PLAYER_REMOVED",
            actorUserId: actor.userId,
            playerId: player.id,
            payload: { playerName: player.displayName, wasClaimed: Boolean(player.userId) },
          },
        });
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
        });
        if (!draft) throw new ApiError(404, "DRAFT_NOT_FOUND", "Draft not found");
        if (draft.creatorUserId !== actor.userId) throw new ApiError(403, "CREATOR_REQUIRED", "Only the creator can regenerate the pool");
        if (draft.status !== "SETUP") throw new ApiError(409, "DRAFT_STARTED", "Pools are frozen after the draft starts");
        if (draft.version !== input.version) throw new ApiError(409, "STALE_DRAFT", "The draft changed; refresh and try again");
        const seed = input.seed ?? randomUUID();
        const options = buildOptions(seed, z.parse(createDraftSchema.shape.config, draft.config));
        await transaction.draftOption.deleteMany({ where: { draftId: draft.id } });
        await transaction.draftOption.createMany({ data: options.map((option) => ({ ...option, draftId: draft.id })) });
        await transaction.draft.update({
          where: { id: draft.id },
          data: { seed, version: { increment: 1 }, generatorVersion: GENERATOR_VERSION },
        });
        await transaction.draftEvent.create({
          data: {
            draftId: draft.id,
            type: "POOL_REGENERATED",
            actorUserId: actor.userId,
            payload: { seed },
          },
        });
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
        if (draft.players.some((player) => !player.userId)) {
          throw new ApiError(409, "UNCLAIMED_PLAYERS", "Every player must claim their seat before the draft starts");
        }
        const event = await transaction.draftEvent.create({
          data: {
            draftId: draft.id,
            type: "DRAFT_STARTED",
            actorUserId: actor.userId,
            payload: { activePlayerId: draft.players[0]!.id },
          },
        });
        await transaction.draft.update({
          where: { id: draft.id },
          data: { status: "DRAFTING", startedAt: new Date(), version: { increment: 1 } },
        });
        if (draft.telegramChatId) {
          await transaction.notificationOutbox.create({
            data: {
              draftId: draft.id,
              eventId: event.id,
              chatId: draft.telegramChatId,
              message: `🚀 ${draft.title} has started.\n${draft.players[0]!.displayName}, you are first to choose.`,
            },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return context.json(await presentDraft(draftId, actor.userId));
  },
);

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
        if (!player || player.userId !== actor.userId) throw new ApiError(403, "NOT_YOUR_TURN", "It is not your turn");
        const option = draft.options.find((candidate) => candidate.id === input.optionId);
        if (!option) throw new ApiError(404, "OPTION_NOT_FOUND", "Draft option not found");
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
            payload: { optionId: option.id, optionKind: option.kind, optionKey: option.key, optionLabel: option.label },
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
              message: `◆ ${player.displayName} selected ${option.label} (${option.kind.toLowerCase()}).\n${nextLine}`,
            },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  return context.json(await presentDraft(draftId, actor.userId));
});
