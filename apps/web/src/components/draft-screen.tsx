import { useEffect, useMemo, useState } from "react";
import { CheckIcon } from "lucide-react";
import { toast } from "sonner";
import type { Faction, Position, PublicDraft, PublicOption } from "@imperium/domain";

import { BanPhaseView, banLockedCount } from "@/components/ban-phase";
import { DraftActivity } from "@/components/draft-activity";
import { DraftNavigation, type DraftView } from "@/components/draft-navigation";
import { MapBoard } from "@/components/map-board";
import {
  ManageSheet,
  OrderSheet,
  RoomTopbar,
  SliceSheet,
  TableView,
  TurnStrip,
  selectedOptionOf,
} from "@/components/room-parts";
import { SliceCard } from "@/components/slice-board";
import { api, getDemoIdentity, setDemoIdentity } from "@/lib/api";
import { factionMeta, techColorHex } from "@/lib/ti4-meta";
import { cn } from "@/lib/utils";

type Segment = "slices" | "factions" | "seats";

const segmentToKind: Record<Segment, PublicOption["kind"]> = {
  slices: "SLICE",
  factions: "FACTION",
  seats: "POSITION",
};

export function DraftScreen({
  draft,
  onDraft,
  onShowDrafts,
  view,
  onViewChange,
}: {
  draft: PublicDraft;
  onDraft: (draft: PublicDraft) => void;
  onShowDrafts: () => void;
  view: DraftView;
  onViewChange: (view: DraftView) => void;
}) {
  const [segment, setSegment] = useState<Segment>("slices");
  const [selectedOptionId, setSelectedOptionId] = useState<string>();
  const [sheetSliceId, setSheetSliceId] = useState<string>();
  const [orderOpen, setOrderOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [sort, setSort] = useState<"num" | "opt">("num");
  const [factionFilter, setFactionFilter] = useState<"all" | "available" | "banned">("all");
  const [busy, setBusy] = useState(false);

  const isBanning = draft.status === "BANNING";
  const isComplete = draft.status === "COMPLETE" || draft.turnCursor >= draft.totalTurns;
  const activePlayer = draft.players.find((player) => player.id === draft.activePlayerId);
  const currentPlayer = draft.players.find((player) => player.isCurrentUser);
  const isMyTurn = Boolean(currentPlayer && activePlayer && currentPlayer.id === activePlayer.id);
  const isManagingTurn = Boolean(draft.canManage && activePlayer && !isMyTurn);
  const canSelect = Boolean(isMyTurn || isManagingTurn);
  const boardPlayer = isManagingTurn ? activePlayer : currentPlayer;

  const boardSlice = boardPlayer ? selectedOptionOf(draft, boardPlayer.id, "SLICE") : undefined;
  const boardFaction = boardPlayer ? selectedOptionOf(draft, boardPlayer.id, "FACTION") : undefined;
  const boardSeat = boardPlayer ? selectedOptionOf(draft, boardPlayer.id, "POSITION") : undefined;
  const boardPickBySegment: Record<Segment, PublicOption | undefined> = {
    slices: boardSlice,
    factions: boardFaction,
    seats: boardSeat,
  };

  useEffect(() => {
    setSelectedOptionId(undefined);
  }, [segment, view, draft.version]);

  const roundNumber = Math.min(3, Math.floor(draft.turnCursor / Math.max(1, draft.players.length)) + 1);
  const headerMeta = isBanning
    ? `BAN PHASE · ${banLockedCount(draft)} OF ${draft.players.length} LOCKED`
    : isComplete
      ? "DRAFT COMPLETE"
      : `ROUND ${roundNumber} · PICK ${Math.min(draft.turnCursor + 1, draft.totalTurns)}/${draft.totalTurns}`;

  const options = useMemo(() => {
    const byKind = (kind: PublicOption["kind"]) =>
      draft.options.filter((option) => option.kind === kind).sort((a, b) => a.sortOrder - b.sortOrder);
    return { SLICE: byKind("SLICE"), FACTION: byKind("FACTION"), POSITION: byKind("POSITION") };
  }, [draft.options]);

  const availableCount: Record<Segment, number> = {
    slices: options.SLICE.filter((option) => !option.selectedByPlayerId).length,
    factions: options.FACTION.filter((option) => !option.selectedByPlayerId && !option.bannedByPlayerId).length,
    seats: options.POSITION.filter((option) => !option.selectedByPlayerId).length,
  };
  const bannedCount = options.FACTION.filter((option) => option.bannedByPlayerId).length;

  const playerName = (playerId?: string | null) =>
    draft.players.find((player) => player.id === playerId)?.displayName;

  function guardPick(option: PublicOption): string | null {
    if (isComplete) return "The draft is complete.";
    if (option.bannedByPlayerId) return `${option.label} was banned before the draft.`;
    if (option.selectedByPlayerId) return `${option.label} is already taken by ${playerName(option.selectedByPlayerId)}.`;
    if (!canSelect) {
      if (!currentPlayer) return "You are watching — claim a seat to pick.";
      return `Not your turn — ${activePlayer?.displayName ?? "someone"} is picking.`;
    }
    const kindKey = option.kind === "SLICE" ? "slices" : option.kind === "FACTION" ? "factions" : "seats";
    if (boardPickBySegment[kindKey as Segment]) {
      return option.kind === "SLICE"
        ? `${boardPlayer?.displayName ?? "This player"} already holds a slice.`
        : option.kind === "FACTION"
          ? `${boardPlayer?.displayName ?? "This player"} already holds a faction this draft.`
          : `${boardPlayer?.displayName ?? "This player"} already holds a seat.`;
    }
    return null;
  }

  async function commitPick(option: PublicOption) {
    setBusy(true);
    try {
      const updated = await api.pick(draft.slug, option.id, draft.version);
      onDraft(updated);
      setSelectedOptionId(undefined);
      setSheetSliceId(undefined);
      toast.success(
        isManagingTurn
          ? `${option.label} selected for ${activePlayer?.displayName ?? "the active player"}.`
          : `You took ${option.label}.`,
      );
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pick failed");
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
    } finally {
      setBusy(false);
    }
  }

  function tapOption(option: PublicOption) {
    const problem = guardPick(option);
    if (problem) {
      toast.info(problem);
      return;
    }
    setSelectedOptionId((current) => (current === option.id ? undefined : option.id));
  }

  const selectedOption = draft.options.find((option) => option.id === selectedOptionId);

  const sheetOption = draft.options.find((option) => option.id === sheetSliceId);
  const sheetGuard = sheetOption ? guardPick(sheetOption) : null;
  const sheetTakeLabel = sheetOption
    ? sheetOption.selectedByPlayerId
      ? `Taken by ${playerName(sheetOption.selectedByPlayerId)}`
      : sheetGuard === null
        ? isManagingTurn
          ? `Take for ${activePlayer?.displayName ?? "active player"}`
          : "Take this slice"
        : boardSlice
          ? `${boardPlayer?.displayName ?? "This player"} already holds a slice`
          : !canSelect
            ? `Waiting on ${activePlayer?.displayName ?? "the table"}`
            : "Unavailable"
    : "";

  const sortedSlices = useMemo(() => {
    const list = [...options.SLICE];
    if (sort === "opt") {
      list.sort((a, b) => {
        const left = a.payload as { optimalTotal?: number };
        const right = b.payload as { optimalTotal?: number };
        return (right.optimalTotal ?? 0) - (left.optimalTotal ?? 0);
      });
    }
    return list;
  }, [options.SLICE, sort]);

  const filteredFactions = options.FACTION.filter((option) => {
    if (factionFilter === "available") return !option.selectedByPlayerId && !option.bannedByPlayerId;
    if (factionFilter === "banned") return Boolean(option.bannedByPlayerId);
    return true;
  });

  async function previewAs(playerId: string, name: string) {
    const creatorPlayerId = localStorage.getItem("imperium-demo-creator-player");
    setDemoIdentity({ id: playerId === creatorPlayerId ? "creator" : playerId, name });
    onDraft(await api.getDraft(draft.slug));
  }

  const boardSlots: Array<{ segment: Segment; kicker: string; pick?: PublicOption }> = [
    { segment: "slices", kicker: "SLICE", pick: boardSlice },
    { segment: "factions", kicker: "FACTION", pick: boardFaction },
    { segment: "seats", kicker: "SEAT", pick: boardSeat },
  ];
  const lockedCount = boardSlots.filter((slot) => slot.pick).length;

  return (
    <main className="room-shell">
      <RoomTopbar title={draft.title} meta={headerMeta} onBack={onShowDrafts} onManage={() => setManageOpen(true)} />

      {!window.Telegram?.WebApp.initData && (
        <div className="demo-rail">
          <span>Preview as</span>
          {draft.players.map((player) => (
            <button
              key={player.id}
              type="button"
              className={player.isCurrentUser ? "is-active" : ""}
              onClick={() => void previewAs(player.id, player.displayName)}
            >
              {player.displayName}
            </button>
          ))}
          <span style={{ marginLeft: "auto" }}>{getDemoIdentity().name}</span>
        </div>
      )}

      <div className="room-body" key={isBanning ? "ban" : view}>
        {isBanning ? (
          <BanPhaseView draft={draft} onDraft={onDraft} />
        ) : (
          <>
        {view === "draft" && (
          <>
            <TurnStrip draft={draft} onOpenOrder={() => setOrderOpen(true)} />

            <div className="board-row">
              <div className="mono-label" style={{ marginBottom: 8 }}>
                {isManagingTurn ? `${activePlayer?.displayName.toUpperCase()}'S BOARD` : "YOUR BOARD"} · {lockedCount} OF 3 LOCKED
              </div>
              <div className="board-slots">
                {boardSlots.map((slot) => {
                  const filled = Boolean(slot.pick);
                  const value = slot.pick
                    ? slot.pick.kind === "FACTION"
                      ? (slot.pick.payload as unknown as Faction).shortName
                      : slot.pick.kind === "POSITION"
                        ? `#${slot.pick.sortOrder + 1} ${(slot.pick.payload as unknown as Position).label}`
                        : slot.pick.label
                    : `${availableCount[slot.segment]} left`;
                  return (
                    <button
                      key={slot.segment}
                      type="button"
                      className={cn("board-slot", filled && "is-filled", segment === slot.segment && "is-active")}
                      onClick={() => setSegment(slot.segment)}
                    >
                      <span className="board-slot-head">
                        <small>{slot.kicker}</small>
                        {filled && (
                          <em>
                            <CheckIcon aria-hidden="true" />
                          </em>
                        )}
                      </span>
                      <span className="board-slot-value">{value}</span>
                      <span className="board-slot-rail" />
                    </button>
                  );
                })}
              </div>
            </div>

            {segment === "slices" && (
              <div style={{ padding: "10px 16px 96px" }}>
                <div className="slice-legend">
                  <span>
                    <i style={{ background: "var(--res)" }} />
                    RESOURCES
                  </span>
                  <span>
                    <i style={{ background: "var(--inf)" }} />
                    INFLUENCE
                  </span>
                  <button
                    type="button"
                    className="sort-toggle"
                    onClick={() => setSort((value) => (value === "num" ? "opt" : "num"))}
                  >
                    {sort === "num" ? "SORT: BY NUMBER" : "SORT: STRONGEST"}
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {sortedSlices.map((option) => (
                    <SliceCard
                      key={option.id}
                      option={option}
                      takenBy={playerName(option.selectedByPlayerId)}
                      selected={selectedOptionId === option.id}
                      onSelect={() => setSheetSliceId(option.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {segment === "factions" && (
              <div style={{ padding: "10px 16px 96px" }}>
                <div style={{ display: "flex", gap: 6, paddingBottom: 11 }}>
                  {(
                    [
                      { id: "all", label: `ALL ${options.FACTION.length}` },
                      { id: "available", label: `AVAILABLE ${availableCount.factions}` },
                      { id: "banned", label: bannedCount ? `BANNED ${bannedCount}` : "BANNED" },
                    ] as const
                  ).map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      className={cn("filter-chip", factionFilter === chip.id && "is-active")}
                      onClick={() => setFactionFilter(chip.id)}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {filteredFactions.map((option) => {
                    const faction = option.payload as unknown as Faction;
                    const meta = factionMeta[faction.id];
                    const taken = Boolean(option.selectedByPlayerId);
                    const banned = Boolean(option.bannedByPlayerId);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={cn(
                          "faction-card",
                          (taken || banned) && "is-dim",
                          selectedOptionId === option.id && "is-selected",
                        )}
                        onClick={() => tapOption(option)}
                      >
                        <span className="crest">{faction.shortName.slice(0, 2).toUpperCase()}</span>
                        <span className="faction-card-main">
                          <strong className={cn(banned && "is-struck")}>{faction.name}</strong>
                          <span className="faction-card-sub">
                            <span className="tech-dots">
                              {(meta?.techs ?? []).map((tech, index) => (
                                <i key={index} style={{ background: techColorHex[tech] }} />
                              ))}
                            </span>
                            <em>{meta?.meta ?? faction.trait}</em>
                          </span>
                        </span>
                        <span
                          className={cn(
                            "state-tag",
                            banned ? "state-banned" : taken ? "state-taken" : "state-available",
                          )}
                        >
                          {banned ? "BANNED" : taken ? playerName(option.selectedByPlayerId)?.toUpperCase() : "AVAILABLE"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {segment === "seats" && (
              <div style={{ padding: "10px 16px 96px" }}>
                <p
                  style={{
                    margin: 0,
                    font: "400 11.5px/1.45 var(--font-sans)",
                    color: "#78818d",
                    padding: "0 2px 12px",
                  }}
                >
                  Seat = position in speaker order for round one. Lower is earlier.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {options.POSITION.map((option) => {
                    const position = option.payload as unknown as Position;
                    const taken = Boolean(option.selectedByPlayerId);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={cn("seat-card", taken && "is-dim", selectedOptionId === option.id && "is-selected")}
                        onClick={() => tapOption(option)}
                      >
                        <span className="seat-num">{option.sortOrder + 1}</span>
                        <span className="seat-card-main">
                          <strong>{position.label}</strong>
                          <small>{position.description}</small>
                        </span>
                        <span className={cn("state-tag", taken ? "state-taken" : "state-available")}>
                          {taken ? playerName(option.selectedByPlayerId)?.toUpperCase() : "AVAILABLE"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {view === "map" && <MapBoard draft={draft} />}
        {view === "table" && <TableView draft={draft} onDraft={onDraft} busy={busy} setBusy={setBusy} />}
        {view === "activity" && <DraftActivity draft={draft} />}

        {view === "draft" && selectedOption && (
          <div className="confirm-dock">
            <button type="button" className="btn-ghost-lg" onClick={() => setSelectedOptionId(undefined)}>
              Cancel
            </button>
            <button type="button" className="btn-accent" disabled={busy} onClick={() => void commitPick(selectedOption)}>
              {isManagingTurn ? `Take for ${activePlayer?.displayName}` : "Take"}{" "}
              {selectedOption.kind === "POSITION" ? selectedOption.label.toLowerCase() : selectedOption.label}
            </button>
          </div>
        )}
          </>
        )}
      </div>

      {!isBanning && <DraftNavigation view={view} onViewChange={onViewChange} />}

      <SliceSheet
        draft={draft}
        optionId={sheetSliceId}
        onOpenChange={(open) => !open && setSheetSliceId(undefined)}
        canTake={Boolean(sheetOption) && sheetGuard === null && !busy}
        takeLabel={sheetTakeLabel}
        onTake={() => sheetOption && void commitPick(sheetOption)}
      />
      <OrderSheet draft={draft} open={orderOpen} onOpenChange={setOrderOpen} />
      <ManageSheet
        draft={draft}
        open={manageOpen}
        onOpenChange={setManageOpen}
        onDraft={onDraft}
        onDeleted={onShowDrafts}
      />
    </main>
  );
}
