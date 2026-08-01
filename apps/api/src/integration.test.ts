import { afterAll, describe, expect, it } from "vitest";
import type { PublicDraft } from "@imperium/domain";

import { app } from "./app.js";
import { prisma } from "./prisma.js";

const runId = crypto.randomUUID();
const creatorIdentity = `integration-creator-${runId}`;
let draft: PublicDraft | undefined;
let creatorPlayerId: string;
let managedDraft: PublicDraft | undefined;
const jsonHeaders = (identity: string, name: string) => ({
  "content-type": "application/json",
  "x-demo-user-id": identity,
  "x-demo-user-name": name,
});

async function responseDraft(response: Response): Promise<PublicDraft> {
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body as PublicDraft;
}

describe.sequential("draft lifecycle", () => {
  it("creates a deterministic live draft immediately", async () => {
    const response = await app.request("/api/drafts", {
      method: "POST",
      headers: jsonHeaders(creatorIdentity, "Alice"),
      body: JSON.stringify({
        title: `Lifecycle ${runId}`,
        players: ["Alice", "Bob", "Cara", "Dan", "Eve", "Finn"].map((displayName) => ({ displayName })),
        seed: "integration-lifecycle",
        config: {
          playerCount: 6,
          sliceCount: 9,
          factionCount: 12,
          sets: ["Base Game", "Prophecy of Kings"],
          balance: {
            minimumLegendaryPlanets: 2,
            minimumOptimalInfluence: 4,
            minimumOptimalResources: 2.5,
            minimumOptimalTotal: 9,
            maximumOptimalTotal: 13,
            maximumWormholesPerSlice: 1,
            minimumPairedAlphaWormholes: 1,
            minimumPairedBetaWormholes: 0,
            attemptBudget: 5_000,
          },
        },
      }),
    });
    draft = await responseDraft(response);
    creatorPlayerId = draft.players.find((player) => player.isCurrentUser)!.id;
    expect(draft.status).toBe("DRAFTING");
    expect(draft.players).toHaveLength(6);
    expect(draft.players.filter((player) => player.isClaimed)).toHaveLength(1);
    expect(draft.options.filter((option) => option.kind === "SLICE")).toHaveLength(9);
    expect(draft.events).toContainEqual(
      expect.objectContaining({
        type: "DRAFT_STARTED",
        payload: expect.objectContaining({ automatic: true }),
      }),
    );
  });

  it("lets the creator select for another player and undo that selection", async () => {
    if (!draft) throw new Error("Draft was not created");
    if (draft.activePlayerId === creatorPlayerId) {
      const creator = draft.players.find((player) => player.id === creatorPlayerId)!;
      const option = draft.options.find(
        (candidate) => candidate.kind === "SLICE" && !candidate.selectedByPlayerId,
      )!;
      draft = await responseDraft(
        await app.request(`/api/drafts/${draft.slug}/picks`, {
          method: "POST",
          headers: jsonHeaders(creatorIdentity, creator.displayName),
          body: JSON.stringify({
            optionId: option.id,
            version: draft.version,
            idempotencyKey: crypto.randomUUID(),
          }),
        }),
      );
    }

    const turnIndex = draft.turnCursor;
    const activePlayerId = draft.activePlayerId!;
    const active = draft.players.find((player) => player.id === activePlayerId)!;
    expect(active.id).not.toBe(creatorPlayerId);
    const option = draft.options.find(
      (candidate) => candidate.kind === "FACTION" && !candidate.selectedByPlayerId,
    )!;
    draft = await responseDraft(
      await app.request(`/api/drafts/${draft.slug}/picks`, {
        method: "POST",
        headers: jsonHeaders(creatorIdentity, "Alice"),
        body: JSON.stringify({
          optionId: option.id,
          version: draft.version,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
    );

    expect(draft.options.find((candidate) => candidate.id === option.id)?.selectedByPlayerId).toBe(active.id);
    expect(draft.events).toContainEqual(
      expect.objectContaining({
        type: "OPTION_SELECTED",
        playerId: active.id,
        payload: expect.objectContaining({ turnIndex, performedByCreator: true }),
      }),
    );

    const rejectedUndo = await app.request(`/api/drafts/${draft.slug}/picks/undo`, {
      method: "POST",
      headers: jsonHeaders(active.id, active.displayName),
      body: JSON.stringify({ version: draft.version }),
    });
    expect(rejectedUndo.status).toBe(403);

    draft = await responseDraft(
      await app.request(`/api/drafts/${draft.slug}/picks/undo`, {
        method: "POST",
        headers: jsonHeaders(creatorIdentity, "Alice"),
        body: JSON.stringify({ version: draft.version }),
      }),
    );
    expect(draft.turnCursor).toBe(turnIndex);
    expect(draft.activePlayerId).toBe(active.id);
    expect(draft.options.find((candidate) => candidate.id === option.id)?.selectedByPlayerId).toBeNull();
    expect(draft.events).toContainEqual(
      expect.objectContaining({
        type: "PICK_REVERTED",
        playerId: active.id,
        payload: expect.objectContaining({ optionId: option.id, turnIndex }),
      }),
    );
  });

  it("lets all invited players claim seats after selections are live", async () => {
    if (!draft) throw new Error("Draft was not created");
    for (const player of draft.players.filter((candidate) => !candidate.isClaimed)) {
      const response = await app.request(`/api/drafts/${draft.slug}/players/${player.id}/claim`, {
        method: "POST",
        headers: jsonHeaders(player.id, player.displayName),
        body: JSON.stringify({ version: draft.version }),
      });
      draft = await responseDraft(response);
    }
    expect(draft.players.every((player) => player.isClaimed)).toBe(true);
    expect(draft.status).toBe("DRAFTING");
  });

  it("atomically accepts all remaining picks", async () => {
    if (!draft) throw new Error("Draft was not created");

    while (draft.status === "DRAFTING") {
      const activePlayerId = draft.activePlayerId;
      const active = draft.players.find((player) => player.id === activePlayerId)!;
      const missingKind = (["FACTION", "SLICE", "POSITION"] as const).find(
        (kind) => !active.picks[kind.toLowerCase() as keyof typeof active.picks],
      )!;
      const option = draft.options.find((candidate) => candidate.kind === missingKind && !candidate.selectedByPlayerId)!;
      const identity = active.id === creatorPlayerId ? creatorIdentity : active.id;
      draft = await responseDraft(
        await app.request(`/api/drafts/${draft.slug}/picks`, {
          method: "POST",
          headers: jsonHeaders(identity, active.displayName),
          body: JSON.stringify({
            optionId: option.id,
            version: draft.version,
            idempotencyKey: crypto.randomUUID(),
          }),
        }),
      );
    }

    expect(draft.status).toBe("COMPLETE");
    expect(draft.turnCursor).toBe(18);
    expect(draft.players.every((player) => Object.keys(player.picks).length === 3)).toBe(true);
    expect(draft.events.filter((event) => event.type === "OPTION_SELECTED")).toHaveLength(19);
    expect(draft.events.filter((event) => event.type === "PICK_REVERTED")).toHaveLength(1);
  });

  it("reopens a completed draft when the creator undoes the final selection", async () => {
    if (!draft) throw new Error("Draft was not created");
    const finalTurnIndex = draft.totalTurns - 1;
    const finalPick = draft.events.find(
      (event) => event.type === "OPTION_SELECTED" && event.payload.turnIndex === finalTurnIndex,
    );
    const option = draft.options.find((candidate) => candidate.id === finalPick?.payload.optionId)!;

    draft = await responseDraft(
      await app.request(`/api/drafts/${draft.slug}/picks/undo`, {
        method: "POST",
        headers: jsonHeaders(creatorIdentity, "Alice"),
        body: JSON.stringify({ version: draft.version }),
      }),
    );
    expect(draft.status).toBe("DRAFTING");
    expect(draft.turnCursor).toBe(finalTurnIndex);
    expect(draft.options.find((candidate) => candidate.id === option.id)?.selectedByPlayerId).toBeNull();

    draft = await responseDraft(
      await app.request(`/api/drafts/${draft.slug}/picks`, {
        method: "POST",
        headers: jsonHeaders(creatorIdentity, "Alice"),
        body: JSON.stringify({
          optionId: option.id,
          version: draft.version,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
    );
    expect(draft.status).toBe("COMPLETE");
    expect(draft.turnCursor).toBe(draft.totalTurns);
  });
});

describe.sequential("ban phase", () => {
  let banDraft: PublicDraft | undefined;

  it("rejects a faction pool too small for bans", async () => {
    const response = await app.request("/api/drafts", {
      method: "POST",
      headers: jsonHeaders(creatorIdentity, "Alice"),
      body: JSON.stringify({
        title: `Ban invalid ${runId}`,
        players: ["Alice", "Bob", "Cara", "Dan", "Eve", "Finn"].map((displayName) => ({ displayName })),
        seed: `ban-invalid-${runId}`,
        config: { playerCount: 6, factionCount: 9, bansPerPlayer: 1 },
      }),
    });
    expect(response.status).toBe(400);
  });

  it("creates a draft directly in BANNING before invitees claim seats", async () => {
    const response = await app.request("/api/drafts", {
      method: "POST",
      headers: jsonHeaders(creatorIdentity, "Alice"),
      body: JSON.stringify({
        title: `Ban lifecycle ${runId}`,
        players: ["Alice", "Bob", "Cara"].map((displayName) => ({ displayName })),
        seed: "integration-ban",
        config: { playerCount: 3, factionCount: 9, bansPerPlayer: 1 },
      }),
    });
    banDraft = await responseDraft(response);
    expect(banDraft.config.bansPerPlayer).toBe(1);
    expect(banDraft.status).toBe("BANNING");
    expect(banDraft.players.filter((player) => player.isClaimed)).toHaveLength(1);
    expect(banDraft.activePlayerId).toBeNull();
    expect(banDraft.events).toContainEqual(
      expect.objectContaining({
        type: "DRAFT_STARTED",
        payload: expect.objectContaining({ automatic: true, banPhase: true }),
      }),
    );
  });

  it("rejects picks during the ban phase", async () => {
    if (!banDraft) throw new Error("Ban draft was not created");
    const option = banDraft.options.find((candidate) => candidate.kind === "SLICE")!;
    const response = await app.request(`/api/drafts/${banDraft.slug}/picks`, {
      method: "POST",
      headers: jsonHeaders(creatorIdentity, "Alice"),
      body: JSON.stringify({ optionId: option.id, version: banDraft.version, idempotencyKey: crypto.randomUUID() }),
    });
    expect(response.status).toBe(409);
  });

  it("lets the creator lock bans for unclaimed players and enter DRAFTING", async () => {
    if (!banDraft) throw new Error("Ban draft was not created");
    const seats = banDraft.players.map((player) => ({ id: player.id, name: player.displayName }));
    const factions = banDraft.options.filter((candidate) => candidate.kind === "FACTION").slice(0, seats.length);

    for (const [index, seat] of seats.entries()) {
      banDraft = await responseDraft(
        await app.request(`/api/drafts/${banDraft.slug}/bans`, {
          method: "POST",
          headers: jsonHeaders(creatorIdentity, "Alice"),
          body: JSON.stringify({
            optionId: factions[index]!.id,
            playerId: seat.id,
            version: banDraft.version,
            idempotencyKey: crypto.randomUUID(),
          }),
        }),
      );
    }

    expect(banDraft.status).toBe("DRAFTING");
    expect(banDraft.activePlayerId).toBe(banDraft.players[0]!.id);
    expect(banDraft.options.filter((option) => option.bannedByPlayerId)).toHaveLength(3);
    expect(banDraft.events.filter((event) => event.type === "PLAYER_BANNED")).toHaveLength(3);
    expect(
      banDraft.events.filter(
        (event) => event.type === "PLAYER_BANNED" && event.payload.performedByCreator === true,
      ),
    ).toHaveLength(2);
    expect(banDraft.events.some((event) => event.type === "BAN_PHASE_COMPLETED")).toBe(true);
  });

  it("lets invitees claim their seats after the ban phase", async () => {
    if (!banDraft) throw new Error("Ban draft was not created");
    for (const player of banDraft.players.filter((candidate) => !candidate.isClaimed)) {
      banDraft = await responseDraft(
        await app.request(`/api/drafts/${banDraft.slug}/players/${player.id}/claim`, {
          method: "POST",
          headers: jsonHeaders(`ban-${player.id}`, player.displayName),
          body: JSON.stringify({ version: banDraft.version }),
        }),
      );
    }
    banDraft = await responseDraft(
      await app.request(`/api/drafts/${banDraft.slug}`, { headers: jsonHeaders(creatorIdentity, "Alice") }),
    );
    expect(banDraft.players.every((player) => player.isClaimed)).toBe(true);
    expect(banDraft.status).toBe("DRAFTING");
  });

  it("rejects a second ban and picks of banned factions", async () => {
    if (!banDraft) throw new Error("Ban draft was not created");
    banDraft = await responseDraft(
      await app.request(`/api/drafts/${banDraft.slug}`, { headers: jsonHeaders(creatorIdentity, "Alice") }),
    );
    const banned = banDraft.options.find((option) => option.kind === "FACTION" && option.bannedByPlayerId)!;
    const secondBan = await app.request(`/api/drafts/${banDraft.slug}/bans`, {
      method: "POST",
      headers: jsonHeaders(creatorIdentity, "Alice"),
      body: JSON.stringify({ optionId: banned.id, version: banDraft.version, idempotencyKey: crypto.randomUUID() }),
    });
    expect(secondBan.status).toBe(409);

    const activePlayer = banDraft.players.find((player) => player.id === banDraft!.activePlayerId)!;
    const activeIdentity = activePlayer.isCurrentUser ? creatorIdentity : `ban-${activePlayer.id}`;
    const bannedPick = await app.request(`/api/drafts/${banDraft.slug}/picks`, {
      method: "POST",
      headers: jsonHeaders(activeIdentity, activePlayer.displayName),
      body: JSON.stringify({ optionId: banned.id, version: banDraft.version, idempotencyKey: crypto.randomUUID() }),
    });
    expect(bannedPick.status).toBe(409);
    const body = (await bannedPick.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("OPTION_BANNED");
  });

  afterAll(async () => {
    if (banDraft?.id) await prisma.draft.delete({ where: { id: banDraft.id } });
  });
});

describe.sequential("draft management", () => {
  it("lists a creator's drafts", async () => {
    const response = await app.request("/api/drafts", {
      method: "POST",
      headers: jsonHeaders(creatorIdentity, "Alice"),
      body: JSON.stringify({
        title: `Managed ${runId}`,
        players: ["Alice", "Bob", "Cara", "Dan"].map((displayName) => ({ displayName })),
        seed: "integration-managed",
        config: {
          playerCount: 4,
          sliceCount: 9,
          factionCount: 12,
          sets: ["Base Game", "Prophecy of Kings"],
          balance: {
            minimumLegendaryPlanets: 2,
            minimumOptimalInfluence: 4,
            minimumOptimalResources: 2.5,
            minimumOptimalTotal: 9,
            maximumOptimalTotal: 13,
            maximumWormholesPerSlice: 1,
            minimumPairedAlphaWormholes: 1,
            minimumPairedBetaWormholes: 0,
            attemptBudget: 5_000,
          },
        },
      }),
    });
    managedDraft = await responseDraft(response);

    const listResponse = await app.request("/api/drafts", {
      headers: jsonHeaders(creatorIdentity, "Alice"),
    });
    const summaries = (await listResponse.json()) as Array<{ slug: string; playerCount: number }>;
    expect(summaries).toContainEqual(
      expect.objectContaining({ slug: managedDraft.slug, playerCount: 4 }),
    );
  });

  it("only lets a player release their own claimed seat", async () => {
    if (!managedDraft) throw new Error("Managed draft was not created");
    const seat = managedDraft.players.find((player) => !player.isClaimed)!;
    const seatIdentity = `seat-owner-${runId}`;
    managedDraft = await responseDraft(
      await app.request(`/api/drafts/${managedDraft.slug}/players/${seat.id}/claim`, {
        method: "POST",
        headers: jsonHeaders(seatIdentity, seat.displayName),
        body: JSON.stringify({ version: managedDraft.version }),
      }),
    );

    const rejected = await app.request(
      `/api/drafts/${managedDraft.slug}/players/${seat.id}/claim?version=${managedDraft.version}`,
      {
        method: "DELETE",
        headers: jsonHeaders(`seat-intruder-${runId}`, "Mallory"),
      },
    );
    expect(rejected.status).toBe(403);

    managedDraft = await responseDraft(
      await app.request(
        `/api/drafts/${managedDraft.slug}/players/${seat.id}/claim?version=${managedDraft.version}`,
        {
          method: "DELETE",
          headers: jsonHeaders(seatIdentity, seat.displayName),
        },
      ),
    );
    expect(managedDraft.players.find((player) => player.id === seat.id)?.isClaimed).toBe(false);
    expect(managedDraft.events[0]).toEqual(
      expect.objectContaining({ type: "PLAYER_UNCLAIMED", playerId: seat.id }),
    );
  });

  it("removes a claimed player before the first selection and reduces the position pool", async () => {
    if (!managedDraft) throw new Error("Managed draft was not created");
    const leavingPlayer = managedDraft.players.find((player) => !player.isClaimed)!;
    managedDraft = await responseDraft(
      await app.request(`/api/drafts/${managedDraft.slug}/players/${leavingPlayer.id}/claim`, {
        method: "POST",
        headers: jsonHeaders(`leaver-${runId}`, leavingPlayer.displayName),
        body: JSON.stringify({ version: managedDraft.version }),
      }),
    );
    managedDraft = await responseDraft(
      await app.request(
        `/api/drafts/${managedDraft.slug}/players/${leavingPlayer.id}?version=${managedDraft.version}`,
        {
          method: "DELETE",
          headers: jsonHeaders(creatorIdentity, "Alice"),
        },
      ),
    );

    expect(managedDraft.players).toHaveLength(3);
    expect(managedDraft.config.playerCount).toBe(3);
    expect(managedDraft.options.filter((option) => option.kind === "POSITION")).toHaveLength(3);
    expect(managedDraft.events[0]).toEqual(
      expect.objectContaining({ type: "PLAYER_REMOVED" }),
    );
  });

  it("keeps drafting live while all three remaining seats are claimed", async () => {
    if (!managedDraft) throw new Error("Managed draft was not created");
    for (const player of managedDraft.players.filter((candidate) => !candidate.isClaimed)) {
      managedDraft = await responseDraft(
        await app.request(`/api/drafts/${managedDraft.slug}/players/${player.id}/claim`, {
          method: "POST",
          headers: jsonHeaders(`managed-${player.id}`, player.displayName),
          body: JSON.stringify({ version: managedDraft.version }),
        }),
      );
    }
    expect(managedDraft.status).toBe("DRAFTING");
    expect(managedDraft.totalTurns).toBe(9);
  });

  it("deletes a draft and removes it from the creator's list", async () => {
    if (!managedDraft) throw new Error("Managed draft was not created");
    const deletedSlug = managedDraft.slug;
    const deleteResponse = await app.request(`/api/drafts/${deletedSlug}`, {
      method: "DELETE",
      headers: jsonHeaders(creatorIdentity, "Alice"),
    });
    expect(deleteResponse.ok).toBe(true);
    managedDraft = undefined;

    const listResponse = await app.request("/api/drafts", {
      headers: jsonHeaders(creatorIdentity, "Alice"),
    });
    const summaries = (await listResponse.json()) as Array<{ slug: string }>;
    expect(summaries.some((summary) => summary.slug === deletedSlug)).toBe(false);
  });
});

afterAll(async () => {
  if (draft?.id) await prisma.draft.delete({ where: { id: draft.id } });
  if (managedDraft?.id) await prisma.draft.delete({ where: { id: managedDraft.id } });
  await prisma.user.deleteMany({ where: { telegramId: { contains: runId } } });
  await prisma.$disconnect();
});
