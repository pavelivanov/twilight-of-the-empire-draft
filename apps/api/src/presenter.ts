import type { Prisma } from "@prisma/client";
import {
  createTurnOrder,
  draftConfigSchema,
  lowerOptionKind,
  type PublicDraft,
} from "@imperium/domain";

import { prisma } from "./prisma.js";

const draftInclude = {
  players: { orderBy: { orderIndex: "asc" as const } },
  options: { orderBy: [{ kind: "asc" as const }, { sortOrder: "asc" as const }] },
  events: { orderBy: { createdAt: "desc" as const }, take: 80 },
} satisfies Prisma.DraftInclude;

export async function presentDraft(
  draftIdOrSlug: string,
  currentUserId?: string,
): Promise<PublicDraft | null> {
  const draft = await prisma.draft.findFirst({
    where: { OR: [{ id: draftIdOrSlug }, { slug: draftIdOrSlug }] },
    include: draftInclude,
  });
  if (!draft) return null;
  const turnOrder = createTurnOrder(draft.players.map((player) => player.id));
  const picksByPlayer = new Map<string, Record<string, string>>();
  for (const option of draft.options) {
    if (!option.selectedByPlayerId) continue;
    const picks = picksByPlayer.get(option.selectedByPlayerId) ?? {};
    picks[lowerOptionKind(option.kind)] = option.key;
    picksByPlayer.set(option.selectedByPlayerId, picks);
  }
  return {
    id: draft.id,
    slug: draft.slug,
    title: draft.title,
    status: draft.status,
    version: draft.version,
    turnCursor: draft.turnCursor,
    totalTurns: turnOrder.length,
    activePlayerId: draft.status === "BANNING" ? null : (turnOrder[draft.turnCursor] ?? null),
    creatorUserId: draft.creatorUserId,
    currentUserId,
    canManage: draft.creatorUserId === currentUserId,
    telegramChannel: draft.telegramChatId
      ? {
          title: draft.telegramChatTitle ?? draft.telegramChatUsername ?? "Telegram group",
          username: draft.telegramChatUsername,
        }
      : null,
    seed: draft.seed,
    config: draftConfigSchema.parse(draft.config),
    players: draft.players.map((player) => ({
      id: player.id,
      displayName: player.displayName,
      telegramUsername: player.telegramUsername,
      orderIndex: player.orderIndex,
      color: player.color,
      isClaimed: Boolean(player.userId),
      isCurrentUser: player.userId === currentUserId,
      picks: picksByPlayer.get(player.id) ?? {},
    })),
    options: draft.options.map((option) => ({
      id: option.id,
      kind: option.kind,
      key: option.key,
      label: option.label,
      sortOrder: option.sortOrder,
      payload: option.payload as Record<string, unknown>,
      selectedByPlayerId: option.selectedByPlayerId,
      bannedByPlayerId: option.bannedByPlayerId,
    })),
    events: draft.events.map((event) => ({
      id: event.id,
      type: event.type,
      createdAt: event.createdAt.toISOString(),
      playerId: event.playerId,
      payload: event.payload as Record<string, unknown>,
    })),
  };
}
