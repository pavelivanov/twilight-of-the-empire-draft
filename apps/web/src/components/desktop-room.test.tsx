import type { PublicDraft, PublicPlayer } from "@imperium/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DesktopLobby, DesktopRoomTopbar } from "./desktop-room";

function player(index: number, displayName: string, claimed: boolean): PublicPlayer {
  return {
    id: `player-${index}`,
    displayName,
    orderIndex: index,
    color: "#cdf05e",
    isClaimed: claimed,
    isCurrentUser: false,
    picks: {},
  };
}

const draft: PublicDraft = {
  id: "draft-1",
  slug: "friday-table",
  title: "Friday Table",
  status: "SETUP",
  version: 3,
  turnCursor: 0,
  totalTurns: 9,
  activePlayerId: null,
  creatorUserId: "creator",
  currentUserId: "creator",
  canManage: true,
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
  players: [player(0, "Pasha", true), player(1, "Dima", true), player(2, "Anna", false)],
  options: [],
  events: [],
};

beforeAll(() => {
  // The lobby renders the invite link, which reads window.location.
  Object.assign(globalThis, { window: { location: { href: "http://localhost:5174/" } } });
});

describe("DesktopLobby", () => {
  it("counts claimed seats and keeps the open seat claimable", () => {
    const markup = renderToStaticMarkup(<DesktopLobby draft={draft} onDraft={vi.fn()} />);

    expect(markup).toContain("2 of 3 seats claimed");
    expect(markup).toContain("1 seat is still open");
    expect(markup).toContain("Click to claim this seat");
    expect(markup).toContain("dk-roster-card is-open");
  });

  it("lets the host start before every seat is claimed", () => {
    const markup = renderToStaticMarkup(<DesktopLobby draft={draft} onDraft={vi.fn()} />);

    expect(markup).toContain("Start now · 1 seat still open");
  });

  it("shows a full table as ready to start", () => {
    const full: PublicDraft = {
      ...draft,
      players: draft.players.map((seat) => ({ ...seat, isClaimed: true })),
    };
    const markup = renderToStaticMarkup(<DesktopLobby draft={full} onDraft={vi.fn()} />);

    expect(markup).toContain("EVERYONE IS IN");
    expect(markup).toContain("Start selections now");
  });

  it("tells a guest that the host opens the draft", () => {
    const guestView: PublicDraft = { ...draft, canManage: false };
    const markup = renderToStaticMarkup(<DesktopLobby draft={guestView} onDraft={vi.fn()} />);

    expect(markup).toContain("Waiting for the host to start");
    expect(markup).not.toContain("Start selections now");
  });
});

describe("DesktopLobby seat claiming", () => {
  it("offers to release the seat you already hold before the draft starts", () => {
    const seated: PublicDraft = {
      ...draft,
      players: draft.players.map((seat, index) =>
        index === 0 ? { ...seat, isCurrentUser: true } : seat,
      ),
    };
    const markup = renderToStaticMarkup(<DesktopLobby draft={seated} onDraft={vi.fn()} />);

    expect(markup).toContain("Seated · click to leave");
  });

  it("stops offering open seats once you are seated", () => {
    const seated: PublicDraft = {
      ...draft,
      players: draft.players.map((seat, index) =>
        index === 0 ? { ...seat, isCurrentUser: true } : seat,
      ),
    };
    const markup = renderToStaticMarkup(<DesktopLobby draft={seated} onDraft={vi.fn()} />);

    expect(markup).toContain("Waiting for its player");
    expect(markup).not.toContain("Click to claim this seat");
  });
});

describe("DesktopRoomTopbar", () => {
  it("labels the lobby phase with the claimed seat count", () => {
    const markup = renderToStaticMarkup(
      <DesktopRoomTopbar draft={draft} onShowDrafts={vi.fn()} manageOpen={false} onToggleManage={vi.fn()} />,
    );

    expect(markup).toContain("LOBBY · 2/3 JOINED");
  });

  it("shows the round and pick counter while drafting", () => {
    const drafting: PublicDraft = {
      ...draft,
      status: "DRAFTING",
      turnCursor: 4,
      activePlayerId: "player-1",
    };
    const markup = renderToStaticMarkup(
      <DesktopRoomTopbar draft={drafting} onShowDrafts={vi.fn()} manageOpen={false} onToggleManage={vi.fn()} />,
    );

    expect(markup).toContain("ROUND 2 · PICK 5/9");
    expect(markup).toContain("dk-order-strip");
  });
});
