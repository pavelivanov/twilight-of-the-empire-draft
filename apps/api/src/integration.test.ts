import { createHmac } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";
import type { PublicDraft } from "@imperium/domain";

import { app } from "./app.js";
import { claimBrowserSession, hashBrowserSessionToken } from "./browser-session.js";
import { env } from "./env.js";
import { prisma } from "./prisma.js";

const runId = crypto.randomUUID();
const creatorIdentity = `integration-creator-${runId}`;
let draft: PublicDraft | undefined;
let creatorPlayerId: string;
let managedDraft: PublicDraft | undefined;
let legacyDraft: PublicDraft | undefined;
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

  it("lists drafts where the current user owns a claimed seat", async () => {
    if (!draft) throw new Error("Draft was not created");
    const participant = draft.players.find((player) => player.id !== creatorPlayerId)!;
    const response = await app.request("/api/drafts", {
      headers: jsonHeaders(participant.id, participant.displayName),
    });
    expect(response.status).toBe(200);
    const summaries = (await response.json()) as Array<{ slug: string }>;
    expect(summaries).toContainEqual(expect.objectContaining({ slug: draft.slug }));
  });

  it("applies concurrent retries with the same idempotency key exactly once", async () => {
    if (!draft) throw new Error("Draft was not created");
    const active = draft.players.find((player) => player.id === draft!.activePlayerId)!;
    const missingKind = (["FACTION", "SLICE", "POSITION"] as const).find(
      (kind) => !active.picks[kind.toLowerCase() as keyof typeof active.picks],
    )!;
    const option = draft.options.find(
      (candidate) => candidate.kind === missingKind && !candidate.selectedByPlayerId,
    )!;
    const idempotencyKey = crypto.randomUUID();
    const request = () =>
      app.request(`/api/drafts/${draft!.slug}/picks`, {
        method: "POST",
        headers: jsonHeaders(creatorIdentity, "Alice"),
        body: JSON.stringify({ optionId: option.id, version: draft!.version, idempotencyKey }),
      });

    const [firstResponse, secondResponse] = await Promise.all([request(), request()]);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    const [firstDraft, secondDraft] = await Promise.all([
      responseDraft(firstResponse),
      responseDraft(secondResponse),
    ]);
    expect(secondDraft.turnCursor).toBe(firstDraft.turnCursor);
    expect(
      await prisma.draftEvent.count({ where: { draftId: draft.id, idempotencyKey } }),
    ).toBe(1);
    draft = firstDraft;
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

describe.sequential("legacy draft compatibility", () => {
  it("activates a legacy SETUP draft for any viewer on first read", async () => {
    legacyDraft = await responseDraft(
      await app.request("/api/drafts", {
        method: "POST",
        headers: jsonHeaders(creatorIdentity, "Alice"),
        body: JSON.stringify({
          title: `Legacy ${runId}`,
          players: ["Alice", "Bob", "Cara"].map((displayName) => ({ displayName })),
          seed: "integration-lifecycle",
          config: { playerCount: 3, sliceCount: 9, factionCount: 12 },
        }),
      }),
    );
    const legacyVersion = legacyDraft.version;
    await prisma.$transaction([
      prisma.draft.update({
        where: { id: legacyDraft.id },
        data: { status: "SETUP", startedAt: null },
      }),
      prisma.draftEvent.deleteMany({
        where: { draftId: legacyDraft.id, type: "DRAFT_STARTED" },
      }),
    ]);

    legacyDraft = await responseDraft(
      await app.request(`/api/drafts/${legacyDraft.slug}`, {
        headers: jsonHeaders(`legacy-viewer-${runId}`, "Viewer"),
      }),
    );

    expect(legacyDraft.status).toBe("DRAFTING");
    expect(legacyDraft.version).toBe(legacyVersion + 1);
    expect(legacyDraft.players.filter((player) => player.isClaimed)).toHaveLength(1);
    expect(legacyDraft.events.filter((event) => event.type === "DRAFT_STARTED")).toHaveLength(1);
    expect(legacyDraft.events).toContainEqual(
      expect.objectContaining({
        type: "DRAFT_STARTED",
        payload: expect.objectContaining({ automatic: true, upgradedLegacy: true }),
      }),
    );
  });

  it("does not activate the same legacy draft twice", async () => {
    if (!legacyDraft) throw new Error("Legacy draft was not created");
    const activatedVersion = legacyDraft.version;
    legacyDraft = await responseDraft(
      await app.request(`/api/drafts/${legacyDraft.slug}`, {
        headers: jsonHeaders(creatorIdentity, "Alice"),
      }),
    );

    expect(legacyDraft.version).toBe(activatedVersion);
    expect(legacyDraft.events.filter((event) => event.type === "DRAFT_STARTED")).toHaveLength(1);
  });
});

describe.sequential("Telegram-linked browser sessions", () => {
  const token = crypto.randomUUID().replaceAll("-", "");

  it("links a pending browser session to the Telegram user and authenticates the same account", async () => {
    const user = await prisma.user.create({
      data: {
        telegramId: `browser-${runId}`,
        displayName: "Browser Admiral",
        username: "browser_admiral",
      },
    });
    await prisma.browserSession.create({
      data: {
        tokenHash: hashBrowserSessionToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(claimBrowserSession(token, user.id)).resolves.toBe("linked");
    const response = await app.request("/api/auth/me", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: user.id,
      displayName: "Browser Admiral",
      username: "browser_admiral",
      mode: "browser",
    });
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

describe.sequential("Telegram action notifications", () => {
  const chatId = `notification-channel-${runId}`;
  let notificationDraft: PublicDraft | undefined;

  it("queues player and creator actions and preserves the deletion notice", async () => {
    notificationDraft = await responseDraft(
      await app.request("/api/drafts", {
        method: "POST",
        headers: jsonHeaders(creatorIdentity, "Alice"),
        body: JSON.stringify({
          title: `Notifications ${runId}`,
          players: ["Alice", "Bob", "Cara", "Dan"].map((displayName) => ({ displayName })),
          seed: `notifications-${runId}`,
          config: { playerCount: 4, sliceCount: 9, factionCount: 12 },
        }),
      }),
    );
    await prisma.draft.update({
      where: { id: notificationDraft.id },
      data: { telegramChatId: chatId, telegramChatTitle: "Test channel" },
    });

    const claimedPlayer = notificationDraft.players.find((player) => !player.isClaimed)!;
    const seatIdentity = `notification-seat-${runId}`;
    notificationDraft = await responseDraft(
      await app.request(`/api/drafts/${notificationDraft.slug}/players/${claimedPlayer.id}/claim`, {
        method: "POST",
        headers: jsonHeaders(seatIdentity, claimedPlayer.displayName),
        body: JSON.stringify({ version: notificationDraft.version }),
      }),
    );
    notificationDraft = await responseDraft(
      await app.request(
        `/api/drafts/${notificationDraft.slug}/players/${claimedPlayer.id}/claim?version=${notificationDraft.version}`,
        { method: "DELETE", headers: jsonHeaders(seatIdentity, claimedPlayer.displayName) },
      ),
    );

    const removedPlayer = notificationDraft.players.find(
      (player) => !player.isClaimed && player.id !== claimedPlayer.id,
    )!;
    notificationDraft = await responseDraft(
      await app.request(
        `/api/drafts/${notificationDraft.slug}/players/${removedPlayer.id}?version=${notificationDraft.version}`,
        { method: "DELETE", headers: jsonHeaders(creatorIdentity, "Alice") },
      ),
    );
    notificationDraft = await responseDraft(
      await app.request(`/api/drafts/${notificationDraft.slug}/regenerate`, {
        method: "POST",
        headers: jsonHeaders(creatorIdentity, "Alice"),
        body: JSON.stringify({ version: notificationDraft.version, seed: "integration-lifecycle" }),
      }),
    );

    const option = notificationDraft.options.find((candidate) => !candidate.selectedByPlayerId)!;
    notificationDraft = await responseDraft(
      await app.request(`/api/drafts/${notificationDraft.slug}/picks`, {
        method: "POST",
        headers: jsonHeaders(creatorIdentity, "Alice"),
        body: JSON.stringify({
          optionId: option.id,
          version: notificationDraft.version,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
    );
    notificationDraft = await responseDraft(
      await app.request(`/api/drafts/${notificationDraft.slug}/picks/undo`, {
        method: "POST",
        headers: jsonHeaders(creatorIdentity, "Alice"),
        body: JSON.stringify({ version: notificationDraft.version }),
      }),
    );

    const queued = await prisma.notificationOutbox.findMany({
      where: { draftId: notificationDraft.id, chatId },
      include: { event: { select: { type: true } } },
    });
    expect(queued.map((job) => job.event?.type)).toEqual(
      expect.arrayContaining([
        "PLAYER_CLAIMED",
        "PLAYER_UNCLAIMED",
        "PLAYER_REMOVED",
        "POOL_REGENERATED",
        "OPTION_SELECTED",
        "PICK_REVERTED",
      ]),
    );

    const deletedId = notificationDraft.id;
    const deleteResponse = await app.request(`/api/drafts/${notificationDraft.slug}`, {
      method: "DELETE",
      headers: jsonHeaders(creatorIdentity, "Alice"),
    });
    expect(deleteResponse.ok).toBe(true);
    notificationDraft = undefined;

    const survivingJobs = await prisma.notificationOutbox.findMany({ where: { chatId } });
    expect(survivingJobs).toHaveLength(7);
    expect(survivingJobs).toContainEqual(
      expect.objectContaining({ draftId: null, eventId: null, message: expect.stringContaining("Owner deleted") }),
    );
    expect(survivingJobs.every((job) => job.draftId === null && job.eventId === null)).toBe(true);
    expect(await prisma.draft.findUnique({ where: { id: deletedId } })).toBeNull();
  });

  afterAll(async () => {
    if (notificationDraft?.id) await prisma.draft.delete({ where: { id: notificationDraft.id } });
    await prisma.notificationOutbox.deleteMany({ where: { chatId } });
  });
});

describe.sequential("group command draft launch", () => {
  const token = crypto.randomUUID();
  const telegramUserId = 8_100_000_001;
  const telegramChatId = "-1008100000001";
  const botToken = "123456789:test-bot-token";
  let groupDraftId: string | undefined;

  function telegramAuthorization(): string {
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1_000)),
      user: JSON.stringify({ id: telegramUserId, first_name: "Group", last_name: "Creator" }),
    });
    const checkString = [...params.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
    params.set("hash", createHmac("sha256", secret).update(checkString).digest("hex"));
    return `tma ${params.toString()}`;
  }

  it("verifies the creator and bot, consumes the link, and binds the new draft", async () => {
    const originalBotToken = env.BOT_TOKEN;
    env.BOT_TOKEN = botToken;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const method = String(input).split("/").at(-1);
        const result =
          method === "getMe"
            ? { id: 9_900_000_001 }
            : method === "getChat"
              ? { id: Number(telegramChatId), type: "supergroup", title: "Galactic Council", username: "council" }
              : { status: "administrator", can_post_messages: true };
        return new Response(JSON.stringify({ ok: true, result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    try {
      await prisma.telegramDraftLaunch.create({
        data: {
          token,
          telegramChatId,
          telegramChatTitle: "Galactic Council",
          telegramChatUsername: "council",
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const response = await app.request("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: telegramAuthorization() },
        body: JSON.stringify({
          title: `Group launch ${runId}`,
          players: ["Creator", "Bob", "Cara"].map((displayName) => ({ displayName })),
          seed: "integration-lifecycle",
          config: { playerCount: 3, sliceCount: 9, factionCount: 12 },
          telegramLaunchToken: token,
        }),
      });
      expect(response.status).toBe(201);
      const groupDraft = (await response.json()) as PublicDraft;
      groupDraftId = groupDraft.id;

      expect(groupDraft.telegramChannel).toMatchObject({ title: "Galactic Council", username: "council" });
      expect(groupDraft.events).toContainEqual(
        expect.objectContaining({
          type: "CHAT_BOUND",
          payload: expect.objectContaining({ source: "group_command", chatId: telegramChatId }),
        }),
      );
      expect(await prisma.telegramDraftLaunch.findUnique({ where: { token } })).toBeNull();
      expect(
        await prisma.notificationOutbox.count({ where: { draftId: groupDraft.id, chatId: telegramChatId } }),
      ).toBe(1);
      expect(
        await prisma.draft.findUnique({ where: { id: groupDraft.id }, select: { telegramChatId: true } }),
      ).toEqual({ telegramChatId });
    } finally {
      env.BOT_TOKEN = originalBotToken;
      vi.unstubAllGlobals();
    }
  });

  afterAll(async () => {
    if (groupDraftId) await prisma.draft.delete({ where: { id: groupDraftId } });
    await prisma.notificationOutbox.deleteMany({ where: { chatId: telegramChatId } });
    await prisma.telegramDraftLaunch.deleteMany({ where: { token } });
    await prisma.user.deleteMany({ where: { telegramId: String(telegramUserId) } });
  });
});

describe.sequential("Telegram webhook reliability", () => {
  const botToken = "123456789:webhook-test-token";
  const webhookSecret = `webhook-${runId}`;

  it("releases a failed update so Telegram can retry it", async () => {
    const telegramUserId = 8_100_000_101;
    const updateId = 8_200_000_101;
    const originalBotToken = env.BOT_TOKEN;
    const originalWebhookSecret = env.WEBHOOK_SECRET;
    let telegramHealthy = false;
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify(
          telegramHealthy
            ? { ok: true, result: { message_id: 1 } }
            : { ok: false, description: "temporary Telegram failure" },
        ),
        {
          status: telegramHealthy ? 200 : 500,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    env.BOT_TOKEN = botToken;
    env.WEBHOOK_SECRET = webhookSecret;
    vi.stubGlobal("fetch", fetchMock);

    const request = () =>
      app.request("/api/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": webhookSecret,
        },
        body: JSON.stringify({
          update_id: updateId,
          message: {
            chat: { id: telegramUserId, type: "private" },
            from: { id: telegramUserId, first_name: "Retry" },
            text: "/status",
          },
        }),
      });

    try {
      const failed = await request();
      expect(failed.status).toBe(500);
      expect(await prisma.telegramUpdate.findUnique({ where: { updateId: String(updateId) } })).toBeNull();

      telegramHealthy = true;
      const retried = await request();
      expect(retried.status).toBe(200);
      expect(await prisma.telegramUpdate.findUnique({ where: { updateId: String(updateId) } })).not.toBeNull();

      const fetchCallsAfterRetry = fetchMock.mock.calls.length;
      const duplicate = await request();
      expect(duplicate.status).toBe(200);
      await expect(duplicate.json()).resolves.toEqual({ ok: true, duplicate: true });
      expect(fetchMock).toHaveBeenCalledTimes(fetchCallsAfterRetry);
    } finally {
      env.BOT_TOKEN = originalBotToken;
      env.WEBHOOK_SECRET = originalWebhookSecret;
      vi.unstubAllGlobals();
      await prisma.telegramUpdate.deleteMany({ where: { updateId: String(updateId) } });
      await prisma.user.deleteMany({
        where: { telegramId: { in: [String(telegramUserId), `demo:${telegramUserId}`] } },
      });
    }
  });

  it("requires the creator and bot to be group administrators before binding", async () => {
    const telegramUserId = 8_100_000_102;
    const telegramChatId = -1_008_100_000_102;
    const botUserId = 9_900_000_102;
    const deniedUpdateId = 8_200_000_102;
    const acceptedUpdateId = 8_200_000_103;
    const originalBotToken = env.BOT_TOKEN;
    const originalWebhookSecret = env.WEBHOOK_SECRET;
    let userIsAdministrator = false;
    let createdDraftId: string | undefined;
    env.BOT_TOKEN = botToken;
    env.WEBHOOK_SECRET = webhookSecret;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const method = String(input).split("/").at(-1);
        const payload = JSON.parse(String(init?.body ?? "{}")) as { user_id?: number };
        const result =
          method === "getMe"
            ? { id: botUserId }
            : method === "getChat"
              ? { id: telegramChatId, type: "supergroup", title: "Audit Council", username: "audit_council" }
              : method === "getChatMember"
                ? {
                    status:
                      payload.user_id === telegramUserId && !userIsAdministrator
                        ? "member"
                        : "administrator",
                    can_post_messages: true,
                  }
                : { message_id: 1 };
        return new Response(JSON.stringify({ ok: true, result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    try {
      const creator = await prisma.user.create({
        data: { telegramId: String(telegramUserId), displayName: "Telegram Creator" },
      });
      const created = await prisma.draft.create({
        data: {
          slug: `webhook-binding-${runId}`,
          title: `Webhook binding ${runId}`,
          status: "DRAFTING",
          creatorUserId: creator.id,
          playerCount: 3,
          seed: `webhook-binding-${runId}`,
          generatorVersion: "integration-test",
          config: { playerCount: 3, sliceCount: 9, factionCount: 12 },
        },
      });
      createdDraftId = created.id;

      const sendDraftCommand = (updateId: number) =>
        app.request("/api/telegram/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-telegram-bot-api-secret-token": webhookSecret,
          },
          body: JSON.stringify({
            update_id: updateId,
            message: {
              chat: { id: telegramChatId, type: "supergroup", title: "Audit Council" },
              from: { id: telegramUserId, first_name: "Telegram", last_name: "Creator" },
              text: `/draft ${created.slug}`,
            },
          }),
        });

      const denied = await sendDraftCommand(deniedUpdateId);
      expect(denied.status).toBe(200);
      expect(
        await prisma.draft.findUnique({ where: { id: created.id }, select: { telegramChatId: true } }),
      ).toEqual({ telegramChatId: null });

      userIsAdministrator = true;
      const accepted = await sendDraftCommand(acceptedUpdateId);
      expect(accepted.status).toBe(200);
      expect(
        await prisma.draft.findUnique({
          where: { id: created.id },
          select: { telegramChatId: true, telegramChatTitle: true, telegramChatUsername: true },
        }),
      ).toEqual({
        telegramChatId: String(telegramChatId),
        telegramChatTitle: "Audit Council",
        telegramChatUsername: "audit_council",
      });
      expect(
        await prisma.draftEvent.count({ where: { draftId: created.id, type: "CHAT_BOUND" } }),
      ).toBe(1);
    } finally {
      env.BOT_TOKEN = originalBotToken;
      env.WEBHOOK_SECRET = originalWebhookSecret;
      vi.unstubAllGlobals();
      await prisma.telegramUpdate.deleteMany({
        where: { updateId: { in: [String(deniedUpdateId), String(acceptedUpdateId)] } },
      });
      if (createdDraftId) await prisma.draft.deleteMany({ where: { id: createdDraftId } });
      await prisma.user.deleteMany({
        where: { telegramId: { in: [String(telegramUserId), `demo:${telegramUserId}`] } },
      });
    }
  });
});

afterAll(async () => {
  if (draft?.id) await prisma.draft.delete({ where: { id: draft.id } });
  if (managedDraft?.id) await prisma.draft.delete({ where: { id: managedDraft.id } });
  if (legacyDraft?.id) await prisma.draft.delete({ where: { id: legacyDraft.id } });
  await prisma.user.deleteMany({ where: { telegramId: { contains: runId } } });
  await prisma.$disconnect();
});
