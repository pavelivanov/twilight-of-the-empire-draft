import type { PublicDraft } from "@imperium/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DraftActivity } from "./draft-activity";

const draft: PublicDraft = {
  id: "draft-1",
  slug: "owner-actions",
  title: "Owner actions",
  status: "DRAFTING",
  version: 4,
  turnCursor: 0,
  totalTurns: 9,
  activePlayerId: "bob",
  creatorUserId: "owner-user",
  currentUserId: "owner-user",
  canManage: true,
  seed: "owner-actions",
  config: {
    playerCount: 3,
    sliceCount: 9,
    factionCount: 9,
    bansPerPlayer: 0,
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
  players: [
    {
      id: "owner",
      displayName: "Alice",
      orderIndex: 0,
      color: "#fff",
      isClaimed: true,
      isCurrentUser: true,
      picks: {},
    },
    {
      id: "bob",
      displayName: "Bob",
      orderIndex: 1,
      color: "#000",
      isClaimed: true,
      isCurrentUser: false,
      picks: {},
    },
    {
      id: "cara",
      displayName: "Cara",
      orderIndex: 2,
      color: "#888",
      isClaimed: true,
      isCurrentUser: false,
      picks: {},
    },
  ],
  options: [],
  events: [
    {
      id: "pick",
      type: "OPTION_SELECTED",
      createdAt: "2026-08-01T10:00:00.000Z",
      playerId: "bob",
      payload: {
        optionLabel: "Faction A",
        optionKind: "FACTION",
        turnIndex: 0,
        performedByCreator: true,
      },
    },
    {
      id: "undo",
      type: "PICK_REVERTED",
      createdAt: "2026-08-01T10:01:00.000Z",
      playerId: "bob",
      payload: {
        optionLabel: "Faction A",
        optionKind: "FACTION",
        turnIndex: 0,
        performedByCreator: true,
      },
    },
  ],
};

describe("DraftActivity", () => {
  it("identifies selections and undos performed by the owner for another player", () => {
    const markup = renderToStaticMarkup(<DraftActivity draft={draft} />);

    expect(markup).toContain("Owner</strong> selected <em>Faction A</em> for <strong>Bob");
    expect(markup).toContain("Owner</strong> undid <em>Faction A</em> for <strong>Bob");
    expect(markup).toContain("OWNER ACTION");
  });
});
