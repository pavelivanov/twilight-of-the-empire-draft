import { afterAll, describe, expect, it } from "vitest";
import type { PublicDraft } from "@imperium/domain";

import { app } from "./app.js";
import { prisma } from "./prisma.js";

const runId = crypto.randomUUID();
const creatorIdentity = `integration-creator-${runId}`;
let draft: PublicDraft | undefined;
let creatorPlayerId: string;
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

afterAll(async () => {
  if (draft?.id) await prisma.draft.delete({ where: { id: draft.id } });
  await prisma.user.deleteMany({ where: { telegramId: { contains: runId } } });
  await prisma.$disconnect();
});
