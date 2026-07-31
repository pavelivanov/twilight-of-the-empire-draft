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
  it("creates a deterministic setup draft", async () => {
    const response = await app.request("/api/drafts", {
      method: "POST",
      headers: jsonHeaders(creatorIdentity, "Alice"),
      body: JSON.stringify({
        title: `Lifecycle ${runId}`,
        players: ["Alice", "Bob", "Cara", "Dan", "Eve", "Finn"].map((displayName) => ({ displayName })),
        seed: `lifecycle-${runId}`,
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
    expect(draft.status).toBe("SETUP");
    expect(draft.players).toHaveLength(6);
    expect(draft.options.filter((option) => option.kind === "SLICE")).toHaveLength(9);
  });

  it("claims all five invited player identities", async () => {
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
  });

  it("starts and atomically accepts all eighteen picks", async () => {
    if (!draft) throw new Error("Draft was not created");
    draft = await responseDraft(
      await app.request(`/api/drafts/${draft.slug}/start`, {
        method: "POST",
        headers: jsonHeaders(creatorIdentity, "Alice"),
        body: JSON.stringify({ version: draft.version }),
      }),
    );
    expect(draft.status).toBe("DRAFTING");

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
    expect(draft.events.filter((event) => event.type === "OPTION_SELECTED")).toHaveLength(18);
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
        seed: `managed-${runId}`,
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

  it("removes a claimed player before start and reduces the position pool", async () => {
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

  it("starts once all three remaining seats are claimed", async () => {
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
    managedDraft = await responseDraft(
      await app.request(`/api/drafts/${managedDraft.slug}/start`, {
        method: "POST",
        headers: jsonHeaders(creatorIdentity, "Alice"),
        body: JSON.stringify({ version: managedDraft.version }),
      }),
    );

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
