import { describe, expect, it } from "vitest";

import {
  assembleMap,
  blueSystemTiers,
  createDraftSchema,
  createTurnOrder,
  draftConfigSchema,
  generateBalancedSlices,
  generateFactionPool,
  systemCatalog,
} from "./index.js";

describe("draft order", () => {
  it("uses a three-round snake for all eighteen picks", () => {
    expect(createTurnOrder(["a", "b", "c", "d", "e", "f"])).toEqual([
      "a", "b", "c", "d", "e", "f",
      "f", "e", "d", "c", "b", "a",
      "a", "b", "c", "d", "e", "f",
    ]);
  });

  it("scales the three-round snake to the table size", () => {
    expect(createTurnOrder(["a", "b", "c"])).toEqual([
      "a", "b", "c",
      "c", "b", "a",
      "a", "b", "c",
    ]);
  });
});

describe("table sizes", () => {
  it("accepts 3–6 matching players and rejects a mismatched count", () => {
    const config = draftConfigSchema.parse({ playerCount: 3 });
    const input = {
      title: "Three player draft",
      players: ["Alice", "Bob", "Cara"].map((displayName) => ({ displayName })),
      config,
    };

    expect(createDraftSchema.parse(input).players).toHaveLength(3);
    expect(
      createDraftSchema.parse({ ...input, telegramLaunchToken: "00000000-0000-4000-8000-000000000000" })
        .telegramLaunchToken,
    ).toBe("00000000-0000-4000-8000-000000000000");
    expect(() => createDraftSchema.parse({ ...input, telegramLaunchToken: "not-a-token" })).toThrow();
    expect(() => createDraftSchema.parse({ ...input, config: { ...config, playerCount: 4 } })).toThrow();
  });

  it("spaces smaller tables around the six-seat map frame", () => {
    const homes = assembleMap([
      { id: "a", positionId: "speaker" },
      { id: "b", positionId: "second" },
      { id: "c", positionId: "third" },
    ])
      .filter((tile) => tile.kind === "home")
      .map((tile) => tile.coordinate);

    expect(homes).toEqual([[0, -3], [3, 0], [-3, 3]]);
  });
});

describe("balanced generation", () => {
  it("creates deterministic, unique, valid slices", () => {
    const first = generateBalancedSlices("galactic-test");
    const second = generateBalancedSlices("galactic-test");
    expect(second).toEqual(first);
    expect(first).toHaveLength(9);
    expect(new Set(first.flatMap((slice) => slice.tiles)).size).toBe(45);
    for (const slice of first) {
      expect(slice.tiles).toHaveLength(5);
      expect(slice.optimalResources).toBeGreaterThanOrEqual(2.5);
      expect(slice.optimalInfluence).toBeGreaterThanOrEqual(4);
      expect(slice.optimalTotal).toBeGreaterThanOrEqual(9);
      expect(slice.optimalTotal).toBeLessThanOrEqual(13);
    }
  });

  it("keeps the blue catalog in three equally sized tiers", () => {
    expect(blueSystemTiers().map((tier) => tier.length)).toEqual([9, 9, 9]);
    expect(systemCatalog.filter((system) => system.type === "red")).toHaveLength(18);
  });

  it("selects a seeded faction pool without duplicates", () => {
    const config = {
      playerCount: 6,
      sliceCount: 9 as const,
      factionCount: 12,
      bansPerPlayer: 0,
      sets: ["Base Game", "Prophecy of Kings"] as Array<"Base Game" | "Prophecy of Kings">,
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
    };
    const factions = generateFactionPool("faction-test", config);
    expect(factions).toHaveLength(12);
    expect(new Set(factions.map((faction) => faction.id)).size).toBe(12);
  });

  it("rejects unsupported Base Game-only configurations", () => {
    expect(() =>
      draftConfigSchema.parse({
        playerCount: 3,
        sets: ["Base Game"],
      }),
    ).toThrow("Base Game and Prophecy of Kings are both required in v1");
  });
});
