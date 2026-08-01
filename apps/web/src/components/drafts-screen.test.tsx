import type { PublicDraft } from "@imperium/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DraftsScreen, isLiveDraftStatus } from "./drafts-screen";

const currentDraft: PublicDraft = {
  id: "draft-1",
  slug: "friday-table",
  title: "Friday Table",
  status: "BANNING",
  version: 2,
  turnCursor: 0,
  totalTurns: 9,
  activePlayerId: null,
  creatorUserId: "creator",
  currentUserId: "guest",
  canManage: false,
  seed: "test-seed",
  config: {
    playerCount: 3,
    sliceCount: 9,
    factionCount: 9,
    bansPerPlayer: 1,
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
  players: [],
  options: [],
  events: [],
};

describe("DraftsScreen", () => {
  it("keeps the ban phase in the live lifecycle", () => {
    expect(isLiveDraftStatus("BANNING")).toBe(true);
  });

  it("lets an invitee return to the draft that is already open", () => {
    const markup = renderToStaticMarkup(
      <DraftsScreen
        currentDraft={currentDraft}
        onOpen={vi.fn()}
        onNew={vi.fn()}
        onReturnCurrent={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    expect(markup).toContain("Return to draft");
  });
});
