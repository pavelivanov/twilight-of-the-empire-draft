import { useEffect, useRef, useState } from "react";
import { CheckIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { Faction, Position, PublicDraft, PublicOption, PublicPlayer, Slice } from "@imperium/domain";

import { banLockedCount } from "@/components/ban-phase";
import { DraftActivity } from "@/components/draft-activity";
import { MapStage, useMapModel } from "@/components/map-board";
import {
  ManagePanelContent,
  SeatClaimDialog,
  computeOrderRounds,
  computeTurnStatus,
  copyInvite,
  draftLink,
  picksLine,
  playerInitials,
  selectedOptionOf,
  useSeatClaim,
  useTurnOrder,
} from "@/components/room-parts";
import { FactionCard, MarkChips, SeatCard, SliceCard, SliceCluster } from "@/components/slice-board";
import { api } from "@/lib/api";
import { sliceDetails, techIcon, traitIcon } from "@/lib/ti4-meta";
import { cn } from "@/lib/utils";

type Segment = "slices" | "factions" | "seats";

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Escape to close plus a focus trap, so the hand-rolled desktop overlays behave
 * like the Base UI sheets the phone layout uses.
 */
function useOverlayBehavior<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(focusableSelector)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(ref.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !ref.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  return ref;
}

/* ---------- topbar ---------- */

function phaseChip(draft: PublicDraft): { label: string; tone: "" | "is-ban" | "is-done" } {
  const claimed = draft.players.filter((player) => player.isClaimed).length;
  if (draft.status === "SETUP") {
    return { label: `LOBBY · ${claimed}/${draft.players.length} JOINED`, tone: "" };
  }
  if (draft.status === "BANNING") {
    return {
      label: `BAN PHASE · ${banLockedCount(draft)}/${draft.players.length} LOCKED`,
      tone: "is-ban",
    };
  }
  if (draft.status === "COMPLETE" || draft.turnCursor >= draft.totalTurns) {
    return { label: "DRAFT COMPLETE", tone: "is-done" };
  }
  const round = Math.min(3, Math.floor(draft.turnCursor / Math.max(1, draft.players.length)) + 1);
  return {
    label: `ROUND ${round} · PICK ${Math.min(draft.turnCursor + 1, draft.totalTurns)}/${draft.totalTurns}`,
    tone: "",
  };
}

export function DesktopRoomTopbar({
  draft,
  onShowDrafts,
  manageOpen,
  onToggleManage,
}: {
  draft: PublicDraft;
  onShowDrafts: () => void;
  manageOpen: boolean;
  onToggleManage: () => void;
}) {
  const chip = phaseChip(draft);
  const currentPlayer = draft.players.find((player) => player.isCurrentUser);
  const { done, picksByPlayer } = computeTurnStatus(draft, { mapAlwaysVisible: true });
  const showOrderStrip = draft.status === "DRAFTING" && !done;

  return (
    <header className="dk-topbar">
      <button type="button" className="dk-topbar-brand" onClick={onShowDrafts}>
        <i className="brand-hex" aria-hidden="true" />
        <span className="brand-word">IMPERIUM DRAFT</span>
      </button>
      <span className="dk-topbar-divider" aria-hidden="true" />
      <strong className="dk-topbar-title">{draft.title}</strong>
      <span className={cn("dk-phase", chip.tone)}>{chip.label}</span>
      <span style={{ flex: "1 1 auto" }} />
      {showOrderStrip && (
        <div className="dk-order-strip" aria-label="Turn order">
          <small>ORDER</small>
          <div>
            {draft.players.map((player) => {
              const isCurrent = player.id === draft.activePlayerId;
              const donePicks = picksByPlayer.get(player.id) ?? 0;
              return (
                <span
                  key={player.id}
                  className={cn("dk-order-cell", isCurrent && "is-current", donePicks >= 2 && "is-done")}
                >
                  <i />
                  <span>{playerInitials(player.displayName)}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
      <button
        type="button"
        className={cn("dk-host-btn", manageOpen && "is-open")}
        onClick={onToggleManage}
        aria-expanded={manageOpen}
      >
        <i aria-hidden="true" />
        {draft.canManage ? "HOST" : "MENU"}
      </button>
      <span className="dk-avatar" aria-hidden="true">
        {currentPlayer ? playerInitials(currentPlayer.displayName) : "—"}
      </span>
    </header>
  );
}

/* ---------- manage popover ---------- */

export function DesktopManagePopover({
  draft,
  open,
  onClose,
  onDraft,
  onDeleted,
}: {
  draft: PublicDraft;
  open: boolean;
  onClose: () => void;
  onDraft: (draft: PublicDraft) => void;
  onDeleted: () => void;
}) {
  const ref = useOverlayBehavior<HTMLDivElement>(open, onClose);

  if (!open) return null;
  return (
    <div className="dk-popover-layer">
      <button type="button" className="dk-popover-scrim" aria-label="Close menu" onClick={onClose} />
      <div className="dk-popover" role="dialog" aria-modal="true" aria-label="Manage draft" ref={ref}>
        <ManagePanelContent draft={draft} onDraft={onDraft} onDeleted={onDeleted} onClose={onClose} />
      </div>
    </div>
  );
}

/* ---------- lobby ---------- */

export function DesktopLobby({
  draft,
  onDraft,
}: {
  draft: PublicDraft;
  onDraft: (draft: PublicDraft) => void;
}) {
  const [busy, setBusy] = useState(false);
  const { pending, setPending, confirmPending, canClaim, canRelease, currentPlayer, claimableBy } =
    useSeatClaim(draft, onDraft, setBusy);
  const claimed = draft.players.filter((player) => player.isClaimed).length;
  const total = draft.players.length;
  const full = claimed >= total;
  const open = total - claimed;

  async function startDraft() {
    setBusy(true);
    try {
      const updated = await api.startDraft(draft.slug, draft.version);
      onDraft(updated);
      toast.success("Drafting started. Players can still claim their seats.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start drafting");
    } finally {
      setBusy(false);
    }
  }

  function tapSeat(player: PublicPlayer) {
    if (player.isCurrentUser) {
      if (canRelease) setPending({ kind: "release", player });
      else toast.info("This is your seat — it is locked once the draft starts.");
      return;
    }
    if (player.isClaimed) {
      toast.info(`${player.displayName} already claimed this seat.`);
      return;
    }
    if (!canClaim) {
      toast.error("This draft is archived — seats are locked.");
      return;
    }
    if (currentPlayer) {
      toast.info(`You are already seated as ${currentPlayer.displayName}.`);
      return;
    }
    setPending({ kind: "claim", player });
  }

  return (
    <div className="dk-scroll">
      <div className="dk-lobby">
        <div className="dk-lobby-kicker">
          <i className={cn("dk-ping", full && "is-lime")} aria-hidden="true" />
          <span className={cn(full && "is-lime")}>{full ? "EVERYONE IS IN" : "WAITING FOR PLAYERS"}</span>
        </div>
        <h1 className="dk-lobby-title">{draft.title}</h1>
        <p className="dk-lobby-sub">
          {full
            ? "All seats claimed. Start when the table is ready."
            : `${open} ${open === 1 ? "seat is" : "seats are"} still open. Share the link to fill ${open === 1 ? "it" : "them"}.`}
        </p>
        <div className="dk-lobby-ticks" aria-hidden="true">
          {draft.players.map((player, index) => (
            <i key={player.id} className={cn(index < claimed && (full ? "is-lime" : "is-blue"))} />
          ))}
        </div>

        <button type="button" className="dk-invite" onClick={() => void copyInvite(draft)}>
          <span className="dk-invite-main">
            <small>INVITE LINK</small>
            <span>{draftLink(draft)}</span>
          </span>
          <span className="dk-invite-copy">COPY</span>
        </button>

        <div className="dk-lobby-roster-head">
          <span className="mono-label">THE TABLE</span>
          <em>
            {claimed} of {total} seats claimed
          </em>
        </div>
        <div className="dk-roster-grid">
          {draft.players.map((player) => {
            const tag = player.isCurrentUser
              ? "YOU"
              : player.isClaimed
                ? "READY"
                : "WAITING";
            return (
              <button
                key={player.id}
                type="button"
                className={cn("dk-roster-card", !player.isClaimed && "is-open", player.isCurrentUser && "is-me")}
                onClick={() => tapSeat(player)}
              >
                <span className="dk-roster-avatar">{player.isClaimed ? playerInitials(player.displayName) : "—"}</span>
                <span className="dk-roster-main">
                  <strong>{player.displayName}</strong>
                  <small>
                    {player.isCurrentUser
                      ? canRelease
                        ? "Seated · click to leave"
                        : "Seated · this is you"
                      : player.isClaimed
                        ? "Joined via invite link"
                        : claimableBy(player)
                          ? "Click to claim this seat"
                          : "Waiting for its player"}
                  </small>
                </span>
                <span className={cn("dk-roster-tag", (player.isCurrentUser || player.isClaimed) && "is-on")}>{tag}</span>
              </button>
            );
          })}
        </div>

        <div className="dk-lobby-chips">
          {[
            { k: "PLAYERS", v: String(total) },
            { k: "SLICES", v: String(draft.config.sliceCount) },
            { k: "FACTIONS", v: String(draft.config.factionCount) },
            {
              k: "BANS",
              v: draft.config.bansPerPlayer > 0 ? `${draft.config.bansPerPlayer} each` : "Off",
            },
          ].map((chip) => (
            <span key={chip.k} className="dk-chip">
              <small>{chip.k}</small>
              <strong>{chip.v}</strong>
            </span>
          ))}
        </div>

        {draft.canManage ? (
          <>
            <button
              type="button"
              className="btn-accent is-block dk-lobby-start"
              disabled={busy}
              onClick={() => void startDraft()}
            >
              {full ? "Start selections now" : `Start now · ${open} ${open === 1 ? "seat" : "seats"} still open`}
            </button>
            <p className="dk-lobby-note">Players can claim their seats while drafting is running.</p>
          </>
        ) : (
          <>
            <div className="dk-lobby-start is-waiting">Waiting for the host to start</div>
            <p className="dk-lobby-note">Browse the invite around — the host opens the draft.</p>
          </>
        )}
      </div>

      <SeatClaimDialog
        pending={pending}
        busy={busy}
        onOpenChange={(dialogOpen) => {
          if (!dialogOpen && !busy) setPending(undefined);
        }}
        onConfirm={() => void confirmPending()}
      />
    </div>
  );
}

/* ---------- slice drawer ---------- */

function DesktopSliceDrawer({
  draft,
  optionId,
  onClose,
  canTake,
  takeLabel,
  onTake,
}: {
  draft: PublicDraft;
  optionId?: string;
  onClose: () => void;
  canTake: boolean;
  takeLabel: string;
  onTake: () => void;
}) {
  const option = draft.options.find((candidate) => candidate.id === optionId);
  const ref = useOverlayBehavior<HTMLElement>(Boolean(option), onClose);

  if (!option) return null;
  const slice = option.payload as unknown as Slice;
  const details = sliceDetails(slice);
  const owner = option.selectedByPlayerId
    ? draft.players.find((player) => player.id === option.selectedByPlayerId)
    : undefined;

  return (
    <div className="dk-drawer-layer">
      <button type="button" className="dk-drawer-scrim" aria-label="Close slice detail" onClick={onClose} />
      <aside
        className="dk-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Slice ${option.label}`}
        ref={ref}
      >
        <div className="dk-drawer-head">
          <div>
            <div className="mono-label" style={{ marginBottom: 8 }}>
              SLICE {option.sortOrder + 1}
            </div>
            <div className="dk-drawer-title">{option.label}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="state-tag"
              style={{
                border: `1px solid ${owner ? "var(--line-3)" : "var(--green-border)"}`,
                borderRadius: 7,
                padding: "5px 9px",
                fontSize: 9.5,
                color: owner ? "var(--faint)" : "var(--lime)",
              }}
            >
              {owner ? `TAKEN · ${owner.displayName.toUpperCase()}` : "AVAILABLE"}
            </span>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <XIcon aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="dk-drawer-body">
          <div className="dk-drawer-cluster">
            <SliceCluster tiles={slice.tiles} size={82} />
          </div>

          <div className="stat-duo">
            <div className="stat-duo-cols">
              <div className="stat-cell is-hot">
                <small>OPTIMAL SPLIT</small>
                <div className="stat-vals">
                  <span className="pair is-res">
                    <i className="diamond" />
                    <strong>{slice.optimalResources}</strong>
                  </span>
                  <span className="pair is-inf">
                    <i className="round" />
                    <strong>{slice.optimalInfluence}</strong>
                  </span>
                </div>
                <p>Best split if every planet is spent on its stronger side.</p>
              </div>
              <div className="stat-cell">
                <small>TOTAL ON TILES</small>
                <div className="stat-vals">
                  <span className="pair">
                    <i className="diamond" />
                    <strong>{slice.resources}</strong>
                  </span>
                  <span className="pair">
                    <i className="round" />
                    <strong>{slice.influence}</strong>
                  </span>
                </div>
                <p>Raw printed values across all planets in the slice.</p>
              </div>
            </div>
            <div className="stat-duo-marks">
              <MarkChips details={details} large />
            </div>
          </div>

          <div className="mono-label" style={{ margin: "16px 0 9px" }}>
            PLANETS
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {details.planets.map((planet) => (
              <div key={planet.name} className="sheet-planet-row">
                <img className="trait" src={traitIcon(planet.trait)} alt={planet.trait} />
                <strong>{planet.name}</strong>
                {planet.legendary && <span className="lgd-chip">LEGENDARY</span>}
                {planet.specialty && (
                  <span className="tech-pill">
                    <img src={techIcon(planet.specialty)} alt="" />
                    {planet.specialty.toUpperCase()}
                  </span>
                )}
                <i className="hexval is-res is-lg">{planet.resources}</i>
                <i className="hexval is-inf is-lg">{planet.influence}</i>
              </div>
            ))}
          </div>
        </div>

        <div className="dk-drawer-cta">
          <button type="button" className="btn-accent is-block" disabled={!canTake} onClick={onTake}>
            {takeLabel}
          </button>
        </div>
      </aside>
    </div>
  );
}

/* ---------- draft room ---------- */

export type DesktopDraftController = {
  draft: PublicDraft;
  segment: Segment;
  setSegment: (segment: Segment) => void;
  sort: "num" | "opt";
  toggleSort: () => void;
  factionFilter: "all" | "available" | "banned";
  setFactionFilter: (filter: "all" | "available" | "banned") => void;
  sortedSlices: PublicOption[];
  filteredFactions: PublicOption[];
  seatOptions: PublicOption[];
  factionTotal: number;
  availableCount: Record<Segment, number>;
  bannedCount: number;
  boardSlots: Array<{ segment: Segment; kicker: string; pick?: PublicOption }>;
  lockedCount: number;
  boardOwnerLabel: string;
  isComplete: boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onDraft: (draft: PublicDraft) => void;
  playerName: (playerId?: string | null) => string | undefined;
  commitPick: (option: PublicOption) => Promise<void>;
  tapOption: (option: PublicOption) => void;
  selectedOption?: PublicOption;
  clearSelection: () => void;
  selectedOptionId?: string;
  isManagingTurn: boolean;
  activePlayerName?: string;
  sheetSliceId?: string;
  setSheetSliceId: (id?: string) => void;
  sheetOption?: PublicOption;
  sheetCanTake: boolean;
  sheetTakeLabel: string;
};

function slotValue(slot: { pick?: PublicOption }, availableLeft: number): string {
  if (!slot.pick) return `${availableLeft} left`;
  if (slot.pick.kind === "FACTION") return (slot.pick.payload as unknown as Faction).shortName;
  if (slot.pick.kind === "POSITION") {
    return `#${slot.pick.sortOrder + 1} ${(slot.pick.payload as unknown as Position).label}`;
  }
  return slot.pick.label;
}

export function DesktopDraftRoom({ controller }: { controller: DesktopDraftController }) {
  const {
    draft,
    segment,
    setSegment,
    sort,
    toggleSort,
    factionFilter,
    setFactionFilter,
    sortedSlices,
    filteredFactions,
    seatOptions,
    factionTotal,
    availableCount,
    bannedCount,
    boardSlots,
    lockedCount,
    boardOwnerLabel,
    isComplete,
    busy,
    setBusy,
    onDraft,
    playerName,
    commitPick,
    tapOption,
    selectedOption,
    clearSelection,
    selectedOptionId,
    isManagingTurn,
    activePlayerName,
    sheetSliceId,
    setSheetSliceId,
    sheetOption,
    sheetCanTake,
    sheetTakeLabel,
  } = controller;

  const [zoom, setZoom] = useState(1);
  const { pending, setPending, confirmPending, canClaim, canRelease, currentPlayer, claimableBy } =
    useSeatClaim(draft, onDraft, setBusy);
  const turn = computeTurnStatus(draft);
  const order = useTurnOrder(draft);
  const rounds = computeOrderRounds(draft, order);
  const model = useMapModel(draft);
  const activePlayer = draft.players.find((player) => player.id === draft.activePlayerId);

  function tapSeat(player: PublicPlayer) {
    if (player.isCurrentUser) {
      if (canRelease) setPending({ kind: "release", player });
      else toast.info("This is your seat — it is locked once the draft starts.");
      return;
    }
    if (player.isClaimed) {
      toast.info(`${player.displayName} already holds this seat.`);
      return;
    }
    if (!canClaim) {
      toast.error("This draft is archived — seats are locked.");
      return;
    }
    if (currentPlayer) {
      toast.info(`You are already seated as ${currentPlayer.displayName}.`);
      return;
    }
    setPending({ kind: "claim", player });
  }

  const tableRows = [...draft.players]
    .map((player) => {
      const seat = selectedOptionOf(draft, player.id, "POSITION");
      const slice = selectedOptionOf(draft, player.id, "SLICE");
      return {
        player,
        id: player.id,
        seat: seat ? `#${seat.sortOrder + 1}` : "—",
        seatOrder: seat ? seat.sortOrder : Number.MAX_SAFE_INTEGER,
        color: seat && slice ? player.color : undefined,
        name: player.displayName,
        isActive: !turn.done && player.id === draft.activePlayerId,
        claimable: claimableBy(player),
        holdings: player.isClaimed
          ? picksLine(draft, player)
          : `open seat · ${picksLine(draft, player)}`,
      };
    })
    .sort((left, right) => left.seatOrder - right.seatOrder);

  const poolTitle = segment === "slices" ? "Slice pool" : segment === "factions" ? "Factions" : "Seats";
  const poolCount =
    segment === "slices"
      ? `${availableCount.slices} of ${sortedSlices.length} available`
      : segment === "factions"
        ? `${availableCount.factions} available`
        : `${availableCount.seats} open`;

  return (
    <div className="dk-room">
      <section className="dk-left">
        <div className={cn("dk-turncard", (turn.isMyTurn || turn.isManagingTurn) && !turn.done && "is-mine")}>
          <div className="dk-turncard-row">
            <i className="dk-ping is-lime" aria-hidden="true" />
            <span>{turn.kicker}</span>
          </div>
          <p>{turn.sub}</p>
        </div>

        <div className="dk-board">
          <div className="mono-label" style={{ marginBottom: 10 }}>
            {boardOwnerLabel} · {lockedCount} OF 3 LOCKED
          </div>
          <div className="dk-board-slots">
            {boardSlots.map((slot) => {
              const filled = Boolean(slot.pick);
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
                  <span className="board-slot-value">{slotValue(slot, availableCount[slot.segment])}</span>
                  <span className="board-slot-rail" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="dk-order-rounds">
          <div className="mono-label" style={{ marginBottom: 10 }}>
            DRAFT ORDER
          </div>
          {rounds.map((round) => (
            <div key={round.label} className="dk-order-round">
              <small>{round.label}</small>
              {round.picks.map((pick) => (
                <div
                  key={pick.turn}
                  className={cn(
                    "order-pick-row",
                    pick.isCurrent && "is-current",
                    pick.isPast && "is-past",
                    !pick.isCurrent && !pick.isPast && "is-upcoming",
                  )}
                >
                  <small>{pick.turn}</small>
                  <strong>{pick.playerName}</strong>
                  <em>{pick.result}</em>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="dk-center">
        <div className="dk-pool-head">
          <h2>{poolTitle}</h2>
          <span className="dk-pool-count">{poolCount}</span>
          <span style={{ flex: "1 1 auto" }} />
          {segment === "slices" && (
            <div className="dk-pool-tools">
              <span className="dk-legend">
                <i style={{ background: "var(--res)" }} />
                RESOURCES
              </span>
              <span className="dk-legend">
                <i style={{ background: "var(--inf)" }} />
                INFLUENCE
              </span>
              <button type="button" className="sort-toggle" onClick={toggleSort}>
                {sort === "num" ? "SORT: BY NUMBER" : "SORT: STRONGEST"}
              </button>
            </div>
          )}
          {segment === "factions" && (
            <div className="dk-pool-tools">
              {(
                [
                  { id: "all", label: `ALL ${factionTotal}` },
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
          )}
        </div>

        <div className="dk-pool-scroll">
          {segment === "slices" && (
            <div className="dk-pool-grid is-slices">
              {sortedSlices.map((option) => (
                <SliceCard
                  key={option.id}
                  option={option}
                  takenBy={playerName(option.selectedByPlayerId)}
                  selected={sheetSliceId === option.id}
                  onSelect={() => setSheetSliceId(option.id)}
                />
              ))}
            </div>
          )}
          {segment === "factions" && (
            <div className="dk-pool-grid">
              {filteredFactions.map((option) => (
                <FactionCard
                  key={option.id}
                  option={option}
                  takenBy={playerName(option.selectedByPlayerId)}
                  selected={selectedOptionId === option.id}
                  onSelect={() => tapOption(option)}
                />
              ))}
            </div>
          )}
          {segment === "seats" && (
            <div>
              <p className="dk-seat-hint">Seat = position in speaker order for round one. Lower is earlier.</p>
              <div className="dk-pool-grid">
                {seatOptions.map((option) => (
                  <SeatCard
                    key={option.id}
                    option={option}
                    takenBy={playerName(option.selectedByPlayerId)}
                    selected={selectedOptionId === option.id}
                    onSelect={() => tapOption(option)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {selectedOption && (
          <div className="confirm-dock dk-confirm-dock">
            <button type="button" className="btn-ghost-lg" onClick={clearSelection}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-accent"
              disabled={busy}
              onClick={() => void commitPick(selectedOption)}
            >
              {isManagingTurn ? `Take for ${activePlayerName}` : "Take"}{" "}
              {selectedOption.kind === "POSITION" ? selectedOption.label.toLowerCase() : selectedOption.label}
            </button>
          </div>
        )}
      </section>

      <section className="dk-rail">
        <div className="dk-rail-head">
          <div>
            <div className="dk-rail-kicker">{isComplete ? "FINAL MAP" : "LIVE ASSEMBLY"}</div>
            <div className="dk-rail-sub">
              {isComplete
                ? `Draft complete · ${model.placedCount} players seated`
                : `${model.placedCount} of ${draft.players.length} wedges placed`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="icon-btn"
              aria-label="Zoom out"
              onClick={() => setZoom((value) => Math.max(0.7, Math.round((value - 0.15) * 100) / 100))}
            >
              <MinusIcon aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Zoom in"
              onClick={() => setZoom((value) => Math.min(1.5, Math.round((value + 0.15) * 100) / 100))}
            >
              <PlusIcon aria-hidden="true" />
            </button>
          </div>
        </div>
        <MapStage model={model} zoom={zoom} className="dk-rail-map" />

        <div className="dk-rail-scroll">
          <div className="dk-table">
            <div className="dk-table-head">
              <span className="mono-label">THE TABLE</span>
              <em>{model.placedCount}/{draft.players.length} PLACED</em>
            </div>
            {tableRows.map((row) => (
              <button
                key={row.id}
                type="button"
                className={cn(
                  "dk-table-row",
                  row.claimable && "is-claimable",
                  row.player.isCurrentUser && "is-me",
                )}
                disabled={busy}
                onClick={() => tapSeat(row.player)}
              >
                <i style={row.color ? { background: row.color } : undefined} />
                <small>{row.seat}</small>
                <strong className={cn(row.isActive && "is-active")}>{row.name}</strong>
                <em>{row.claimable ? "click to claim this seat" : row.holdings}</em>
              </button>
            ))}
            {!currentPlayer && canClaim && (
              <div className="dk-table-note">Click an open seat above to join this table.</div>
            )}
            {activePlayer && !turn.done && (
              <div className="dk-table-note">{activePlayer.displayName} is picking now.</div>
            )}
          </div>
          <div className="dk-activity">
            <DraftActivity draft={draft} />
          </div>
        </div>
      </section>

      <DesktopSliceDrawer
        draft={draft}
        optionId={sheetSliceId}
        onClose={() => setSheetSliceId(undefined)}
        canTake={sheetCanTake && !busy}
        takeLabel={sheetTakeLabel}
        onTake={() => sheetOption && void commitPick(sheetOption)}
      />

      <SeatClaimDialog
        pending={pending}
        busy={busy}
        onOpenChange={(open) => {
          if (!open && !busy) setPending(undefined);
        }}
        onConfirm={() => void confirmPending()}
      />
    </div>
  );
}
