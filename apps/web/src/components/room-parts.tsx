import { useMemo, useState } from "react";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  createTurnOrder,
  type Faction,
  type Position,
  type PublicDraft,
  type PublicOption,
  type PublicPlayer,
  type Slice,
} from "@imperium/domain";

import { MarkChips, SliceCluster } from "@/components/slice-board";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { api } from "@/lib/api";
import { sliceDetails, techIcon, traitIcon } from "@/lib/ti4-meta";
import { cn } from "@/lib/utils";

/* ---------- helpers ---------- */

export function draftLink(draft: PublicDraft): string {
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  const appShortName = import.meta.env.VITE_TELEGRAM_APP_SHORT_NAME;
  if (botUsername && appShortName) {
    return `https://t.me/${botUsername}/${appShortName}?startapp=${encodeURIComponent(draft.slug)}`;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("draft", draft.slug);
  return url.toString();
}

export function optionFor(draft: PublicDraft, kind: PublicOption["kind"], key?: string) {
  if (!key) return undefined;
  return draft.options.find((option) => option.kind === kind && option.key === key);
}

export function selectedOptionOf(draft: PublicDraft, playerId: string, kind: PublicOption["kind"]) {
  return draft.options.find((option) => option.kind === kind && option.selectedByPlayerId === playerId);
}

export function playerInitials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

export function picksLine(draft: PublicDraft, player: PublicPlayer): string {
  const parts: string[] = [];
  const slice = selectedOptionOf(draft, player.id, "SLICE");
  const faction = selectedOptionOf(draft, player.id, "FACTION");
  const seat = selectedOptionOf(draft, player.id, "POSITION");
  if (slice) parts.push(slice.label);
  if (faction) parts.push((faction.payload as unknown as Faction).shortName);
  if (seat) parts.push(seat.label.toLowerCase());
  return parts.length ? parts.join(" · ") : "nothing drafted yet";
}

export function useTurnOrder(draft: PublicDraft): string[] {
  return useMemo(() => {
    try {
      return createTurnOrder(draft.players.map((player) => player.id));
    } catch {
      return [];
    }
  }, [draft.players]);
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export async function copyInvite(draft: PublicDraft) {
  const copied = await copyText(draftLink(draft));
  if (copied) toast.success("Invite link copied.");
  else toast.error("Could not copy the link.");
}

/* ---------- room chrome ---------- */

export function RoomTopbar({
  title,
  meta,
  onBack,
  onManage,
}: {
  title: string;
  meta: string;
  onBack: () => void;
  onManage: () => void;
}) {
  return (
    <header className="room-topbar">
      <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to drafts">
        <ChevronLeftIcon aria-hidden="true" />
      </button>
      <div className="room-topbar-title">
        <strong>{title}</strong>
        <small>{meta}</small>
      </div>
      <button
        type="button"
        className="icon-btn"
        onClick={onManage}
        aria-label="Manage draft"
        style={{ fontWeight: 600, fontSize: 12, letterSpacing: "0.06em" }}
      >
        <EllipsisIcon aria-hidden="true" />
      </button>
    </header>
  );
}

export function TurnStrip({
  draft,
  onOpenOrder,
}: {
  draft: PublicDraft;
  onOpenOrder: () => void;
}) {
  const order = useTurnOrder(draft);
  const done = draft.status === "COMPLETE" || draft.turnCursor >= draft.totalTurns;
  const activePlayer = draft.players.find((player) => player.id === draft.activePlayerId);
  const currentPlayer = draft.players.find((player) => player.isCurrentUser);
  const isMyTurn = Boolean(currentPlayer && activePlayer && currentPlayer.id === activePlayer.id);
  const isManagingTurn = Boolean(draft.canManage && activePlayer && !isMyTurn);
  const turnPlayer = isManagingTurn ? activePlayer : currentPlayer;

  const need: string[] = [];
  if (turnPlayer) {
    if (!selectedOptionOf(draft, turnPlayer.id, "SLICE")) need.push("slice");
    if (!selectedOptionOf(draft, turnPlayer.id, "FACTION")) need.push("faction");
    if (!selectedOptionOf(draft, turnPlayer.id, "POSITION")) need.push("seat");
  }

  const kicker = done
    ? "DRAFT COMPLETE"
    : isMyTurn
      ? "YOUR TURN"
      : isManagingTurn
        ? `OWNER PICK · FOR ${activePlayer?.displayName.toUpperCase()}`
        : activePlayer
          ? `WAITING ON ${activePlayer.displayName.toUpperCase()}`
          : "WAITING";
  const sub = done
    ? "Every seat is filled — open the map."
    : isMyTurn
      ? need.length === 1
        ? `Last one to take: ${need[0]}`
        : `Take one: ${need.join(" · ")}`
      : isManagingTurn
        ? `Choose for ${activePlayer?.displayName}: ${need.join(" · ")}`
        : activePlayer
          ? `${activePlayer.displayName} is choosing. ${
              currentPlayer
                ? need.length
                  ? `You still need ${need.join(" · ")}.`
                  : "Your board is complete."
                : "Watch the pool move in real time."
            }`
          : "Waiting for the next pick.";

  const picksByPlayer = new Map<string, number>();
  for (const option of draft.options) {
    if (option.selectedByPlayerId) {
      picksByPlayer.set(option.selectedByPlayerId, (picksByPlayer.get(option.selectedByPlayerId) ?? 0) + 1);
    }
  }

  return (
    <section className={cn("turn-strip", (isMyTurn || isManagingTurn) && !done && "is-mine", done && "is-done")}>
      <div className="turn-strip-row">
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <i className="turn-dot" aria-hidden="true" />
          <div style={{ minWidth: 0 }}>
            <div className="turn-kicker">{kicker}</div>
            <div className="turn-sub">{sub}</div>
          </div>
        </div>
        <div className="pick-counter">
          <small>PICK</small>
          <strong>
            {Math.min(draft.turnCursor + (done ? 0 : 1), draft.totalTurns)}/{draft.totalTurns}
          </strong>
        </div>
      </div>

      <button type="button" className="order-strip" onClick={onOpenOrder} aria-label="Show draft order">
        {draft.players.map((player) => {
          const isCurrent = !done && player.id === draft.activePlayerId;
          const donePicks = picksByPlayer.get(player.id) ?? 0;
          return (
            <span key={player.id} className={cn("order-cell", isCurrent && "is-current", donePicks >= 2 && "is-done")}>
              <i />
              <span>{playerInitials(player.displayName)}</span>
            </span>
          );
        })}
        <ChevronRightIcon className="chevron" style={{ marginLeft: 3 }} aria-hidden="true" />
      </button>
      {order.length === 0 ? null : null}
    </section>
  );
}

/* ---------- table view ---------- */

export function TableView({
  draft,
  onDraft,
  busy,
  setBusy,
}: {
  draft: PublicDraft;
  onDraft: (draft: PublicDraft) => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  const [pending, setPending] = useState<{ kind: "claim" | "release"; player: PublicPlayer }>();
  const currentPlayer = draft.players.find((player) => player.isCurrentUser);
  const claimed = draft.players.filter((player) => player.isClaimed).length;
  const canClaim = draft.status !== "ARCHIVED";
  const canRelease =
    draft.turnCursor === 0 &&
    draft.status !== "COMPLETE" &&
    draft.status !== "ARCHIVED" &&
    draft.options.every((option) => !option.selectedByPlayerId && !option.bannedByPlayerId);

  const mySlice = currentPlayer ? selectedOptionOf(draft, currentPlayer.id, "SLICE") : undefined;
  const myFaction = currentPlayer ? selectedOptionOf(draft, currentPlayer.id, "FACTION") : undefined;
  const mySeat = currentPlayer ? selectedOptionOf(draft, currentPlayer.id, "POSITION") : undefined;

  async function confirmPending() {
    if (!pending) return;
    setBusy(true);
    try {
      const updated =
        pending.kind === "claim"
          ? await api.claimPlayer(draft.slug, pending.player.id, draft.version)
          : await api.unclaimPlayer(draft.slug, pending.player.id, draft.version);
      onDraft(updated);
      toast.success(
        pending.kind === "claim"
          ? `You are seated as ${pending.player.displayName}.`
          : `${pending.player.displayName} is open again.`,
      );
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
      setPending(undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Seat update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "14px 16px 24px" }}>
      {currentPlayer ? (
        <section className="identity-card">
          <div className="identity-card-row">
            <span className="identity-avatar">{playerInitials(currentPlayer.displayName)}</span>
            <div className="identity-main">
              <div className="mono-label" style={{ fontSize: 9.5, letterSpacing: "0.14em" }}>
                YOUR IDENTITY
              </div>
              <strong>{currentPlayer.displayName}</strong>
            </div>
            <span className="signed-chip">SIGNED</span>
          </div>
          <div className="my-picks">
            {[
              { kicker: "SLICE", value: mySlice?.label },
              { kicker: "FACTION", value: myFaction ? (myFaction.payload as unknown as Faction).shortName : undefined },
              { kicker: "SEAT", value: mySeat ? `#${mySeat.sortOrder + 1}` : undefined },
            ].map((slot) => (
              <span key={slot.kicker} className={cn("my-pick", slot.value && "is-filled")}>
                <small>{slot.kicker}</small>
                <strong>{slot.value ?? "Open"}</strong>
              </span>
            ))}
          </div>
          {canRelease && (
            <button
              type="button"
              className="identity-leave"
              disabled={busy}
              onClick={() => setPending({ kind: "release", player: currentPlayer })}
            >
              Leave seat
            </button>
          )}
        </section>
      ) : (
        <button
          type="button"
          className="seat-claim-dock"
          onClick={() => {
            const firstOpen = draft.players.find((player) => !player.isClaimed);
            if (!canClaim) toast.error("This draft is archived — seats are locked.");
            else if (!firstOpen) toast.error("Every seat is taken.");
            else toast.info("Tap your name below to claim that seat.");
          }}
        >
          <span style={{ minWidth: 0 }}>
            <strong>Take your seat</strong>
            <small>Tap your name in the table below to claim it.</small>
          </span>
          <ChevronRightIcon className="chevron" style={{ color: "var(--lime)" }} aria-hidden="true" />
        </button>
      )}

      <div className="roster-head">
        <div className="mono-label">
          THE TABLE · {claimed} OF {draft.players.length} CLAIMED
        </div>
        <button type="button" className="roster-link" onClick={() => void copyInvite(draft)}>
          INVITE
          <ArrowRightIcon className="text-action-icon" aria-hidden="true" />
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {draft.players.map((player) => {
          const isPicking = draft.status === "DRAFTING" && player.id === draft.activePlayerId;
          const claimable = canClaim && !player.isClaimed && !currentPlayer;
          const tag = player.isCurrentUser
            ? { label: "YOU", className: "is-lime" }
            : isPicking
              ? { label: "PICKING", className: "is-lime" }
              : player.isClaimed
                ? { label: "READY", className: "" }
                : { label: "OPEN SEAT", className: "is-gold" };
          return (
            <button
              key={player.id}
              type="button"
              className={cn("roster-row", isPicking && "is-current", player.isCurrentUser && "is-me")}
              disabled={busy || !claimable}
              style={!claimable ? { cursor: "default" } : undefined}
              onClick={() => claimable && setPending({ kind: "claim", player })}
            >
              <span className="roster-avatar">{playerInitials(player.displayName)}</span>
              <span className="roster-main">
                <span className="roster-name-row">
                  <strong>{player.displayName}</strong>
                  <span className={cn("tag-chip", tag.className)}>{tag.label}</span>
                </span>
                <span className="roster-picks" style={{ display: "block" }}>
                  {player.isClaimed
                    ? draft.status === "SETUP"
                      ? "seat claimed"
                      : picksLine(draft, player)
                    : draft.status === "ARCHIVED"
                      ? "seat was not claimed"
                      : `tap to claim this seat · ${picksLine(draft, player)}`}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <AlertDialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open && !busy) setPending(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "claim"
                ? `Take ${pending.player.displayName}'s seat?`
                : `Leave ${pending?.player.displayName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "claim"
                ? "This name will represent you for the whole draft."
                : "The seat becomes available for another player to claim."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.kind === "claim" ? "default" : "destructive"}
              disabled={busy}
              onClick={() => void confirmPending()}
            >
              {pending?.kind === "claim" ? "Confirm seat" : "Leave seat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------- slice detail sheet ---------- */

export function SliceSheet({
  draft,
  optionId,
  onOpenChange,
  canTake,
  takeLabel,
  onTake,
}: {
  draft: PublicDraft;
  optionId?: string;
  onOpenChange: (open: boolean) => void;
  canTake: boolean;
  takeLabel: string;
  onTake: () => void;
}) {
  const option = draft.options.find((candidate) => candidate.id === optionId);
  const slice = option?.payload as unknown as Slice | undefined;
  const details = slice ? sliceDetails(slice) : undefined;
  const owner = option?.selectedByPlayerId
    ? draft.players.find((player) => player.id === option.selectedByPlayerId)
    : undefined;

  return (
    <Drawer open={Boolean(option)} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent aria-describedby={undefined}>
        {option && slice && details && (
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="sheet-body">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <div className="mono-label" style={{ marginBottom: 7 }}>
                    SLICE {option.sortOrder + 1}
                  </div>
                  <div style={{ font: "600 24px/1.1 var(--font-serif)", color: "var(--ink)" }}>{option.label}</div>
                </div>
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
              </div>

              <div className="slice-sheet-cluster">
                <SliceCluster tiles={slice.tiles} fluid />
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
              <div style={{ height: 8 }} />
            </div>
            <div className="sheet-cta">
              <button type="button" className="btn-accent is-block" disabled={!canTake} onClick={onTake}>
                {takeLabel}
              </button>
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/* ---------- draft order sheet ---------- */

export function OrderSheet({
  draft,
  open,
  onOpenChange,
}: {
  draft: PublicDraft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const order = useTurnOrder(draft);
  const playerCount = draft.players.length;
  const players = new Map(draft.players.map((player) => [player.id, player]));
  const selectedOptionIds = new Set(
    draft.options.filter((option) => option.selectedByPlayerId).map((option) => option.id),
  );
  const pickEventsByTurn = new Map<number, PublicDraft["events"][number]>();
  let fallbackTurnIndex = 0;
  for (const event of [...draft.events]
    .filter(
      (candidate) =>
        candidate.type === "OPTION_SELECTED" &&
        selectedOptionIds.has(String(candidate.payload.optionId ?? "")),
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    const storedTurnIndex = event.payload.turnIndex;
    const turnIndex =
      typeof storedTurnIndex === "number" && Number.isInteger(storedTurnIndex)
        ? storedTurnIndex
        : fallbackTurnIndex;
    pickEventsByTurn.set(turnIndex, event);
    fallbackTurnIndex = Math.max(fallbackTurnIndex, turnIndex + 1);
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent aria-describedby={undefined}>
        <div className="sheet-body" style={{ paddingBottom: 22 }}>
          <h2 className="sheet-title">Draft order</h2>
          <p className="sheet-sub">
            Snake order, three rounds. Each turn you take exactly one of slice, faction or seat.
          </p>
          {[0, 1, 2].map((round) => (
            <div key={round} className="order-round">
              <small>ROUND {round + 1}</small>
              {order.slice(round * playerCount, (round + 1) * playerCount).map((playerId, index) => {
                const globalIndex = round * playerCount + index;
                const isCurrent = draft.status === "DRAFTING" && globalIndex === draft.turnCursor;
                const isPast = globalIndex < draft.turnCursor;
                const event = pickEventsByTurn.get(globalIndex);
                return (
                  <div
                    key={globalIndex}
                    className={cn(
                      "order-pick-row",
                      isCurrent && "is-current",
                      isPast && "is-past",
                      !isCurrent && !isPast && "is-upcoming",
                    )}
                  >
                    <small>{globalIndex + 1}</small>
                    <strong>{players.get(playerId)?.displayName ?? "—"}</strong>
                    <em>{event ? String(event.payload.optionLabel ?? "") : isCurrent ? "picking now" : "upcoming"}</em>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/* ---------- manage sheet ---------- */

export function ManageSheet({
  draft,
  open,
  onOpenChange,
  onDraft,
  onDeleted,
}: {
  draft: PublicDraft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDraft: (draft: PublicDraft) => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"delete" | "undo" | { removePlayerId: string }>();
  const [removeMode, setRemoveMode] = useState(false);
  const canEditDraft =
    draft.turnCursor === 0 &&
    draft.status !== "COMPLETE" &&
    draft.status !== "ARCHIVED" &&
    draft.options.every((option) => !option.selectedByPlayerId && !option.bannedByPlayerId);
  const canUndo = draft.turnCursor > 0 && (draft.status === "DRAFTING" || draft.status === "COMPLETE");

  async function run(action: () => Promise<PublicDraft>, success: string) {
    setBusy(true);
    try {
      const updated = await action();
      onDraft(updated);
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft() {
    setBusy(true);
    try {
      await api.deleteDraft(draft.slug);
      toast.success(`${draft.title} deleted`);
      onOpenChange(false);
      onDeleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the draft");
    } finally {
      setBusy(false);
    }
  }

  async function requestTelegramGroup() {
    setBusy(true);
    try {
      await api.requestTelegramGroup(draft.slug);
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
      toast.success("Group picker sent to your bot chat. Close the Mini App to choose.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the group picker");
    } finally {
      setBusy(false);
    }
  }

  const removablePlayers = draft.players.filter(() => draft.players.length > 3);
  const pendingRemovePlayer =
    confirming && typeof confirming === "object"
      ? draft.players.find((player) => player.id === confirming.removePlayerId)
      : undefined;

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
        <DrawerContent aria-describedby={undefined}>
          <div className="sheet-body" style={{ paddingBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <h2 className="sheet-title" style={{ margin: 0 }}>
                Manage draft
              </h2>
              {draft.canManage && <span className="signed-chip">HOST</span>}
            </div>
            <p className="sheet-sub">Nothing here is silent — every action is visible to the whole table.</p>

            <div className="manage-group">
              <small>TABLE</small>
              <div className="manage-card">
                <button
                  type="button"
                  className="manage-row is-hot"
                  onClick={() => void copyInvite(draft)}
                >
                  <i />
                  <span className="manage-row-main">
                    <strong>Copy invite link</strong>
                    <small>{draftLink(draft)}</small>
                  </span>
                  <ChevronRightIcon className="chevron" aria-hidden="true" />
                </button>
                {draft.canManage && (
                  <button
                    type="button"
                    className="manage-row"
                    disabled={!canEditDraft || draft.players.length <= 3 || busy}
                    onClick={() => setRemoveMode((value) => !value)}
                  >
                    <i />
                    <span className="manage-row-main">
                      <strong>Remove a player</strong>
                      <small>
                        {canEditDraft
                          ? draft.players.length > 3
                            ? "Available until the first selection is locked."
                            : "A table needs at least three seats."
                          : "Locked — selections have already started."}
                      </small>
                    </span>
                    {removeMode ? (
                      <ChevronDownIcon className="chevron" aria-hidden="true" />
                    ) : (
                      <ChevronRightIcon className="chevron" aria-hidden="true" />
                    )}
                  </button>
                )}
                {removeMode &&
                  canEditDraft &&
                  removablePlayers.map((player) => (
                    <button
                      key={player.id}
                      type="button"
                      className="manage-row is-danger"
                      disabled={busy}
                      onClick={() => setConfirming({ removePlayerId: player.id })}
                    >
                      <i />
                      <span className="manage-row-main">
                        <strong>{player.displayName}</strong>
                        <small>{player.isClaimed ? "seat claimed" : "seat open"}</small>
                      </span>
                      <ChevronRightIcon className="chevron" aria-hidden="true" />
                    </button>
                  ))}
              </div>
            </div>

            {draft.canManage && (
              <div className="manage-group">
                <small>TELEGRAM</small>
                <div className="manage-card">
                  <button
                    type="button"
                    className="manage-row is-hot"
                    disabled={!window.Telegram?.WebApp.initData || busy}
                    onClick={() => void requestTelegramGroup()}
                  >
                    <i />
                    <span className="manage-row-main">
                      <strong>{draft.telegramChannel ? "Change notification group" : "Connect notification group"}</strong>
                      <small>
                        {draft.telegramChannel
                          ? `Posting every action to ${draft.telegramChannel.title}.`
                          : window.Telegram?.WebApp.initData
                            ? "Choose from groups where you are an administrator."
                            : "Open the draft in Telegram to choose a group."}
                      </small>
                    </span>
                    <ChevronRightIcon className="chevron" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}

            {draft.canManage && (
              <div className="manage-group">
                <small>DRAFT</small>
                <div className="manage-card">
                  <button
                    type="button"
                    className="manage-row is-warn"
                    disabled={!canEditDraft || busy}
                    onClick={() =>
                      void run(() => api.regenerate(draft.slug, draft.version), "New balanced pool generated.")
                    }
                  >
                    <i />
                    <span className="manage-row-main">
                      <strong>Regenerate pool</strong>
                      <small>
                        {canEditDraft
                          ? "Reroll all nine slices before the first selection."
                          : "Locked — selections have already started."}
                      </small>
                    </span>
                    <ChevronRightIcon className="chevron" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="manage-row is-warn"
                    disabled={!canUndo || busy}
                    onClick={() => setConfirming("undo")}
                  >
                    <i />
                    <span className="manage-row-main">
                      <strong>Undo last selection</strong>
                      <small>
                        {canUndo
                          ? "Return the option to the pool and reopen that player's turn."
                          : "Available after the first selection."}
                      </small>
                    </span>
                    <ChevronRightIcon className="chevron" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}

            {draft.canManage && (
              <div className="manage-group">
                <small>DANGER</small>
                <div className="manage-card">
                  <button
                    type="button"
                    className="manage-row is-danger"
                    disabled={busy}
                    onClick={() => setConfirming("delete")}
                  >
                    <i />
                    <span className="manage-row-main">
                      <strong>Delete draft</strong>
                      <small>Removes the table and its history for everyone.</small>
                    </span>
                    <ChevronRightIcon className="chevron" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}

            <button type="button" className="btn-quiet" style={{ width: "100%", height: 46 }} onClick={() => onOpenChange(false)}>
              Close
            </button>
          </div>
        </DrawerContent>
      </Drawer>

      <AlertDialog
        open={Boolean(confirming)}
        onOpenChange={(dialogOpen) => {
          if (!dialogOpen && !busy) setConfirming(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === "delete"
                ? `Delete “${draft.title}”?`
                : confirming === "undo"
                  ? "Undo the last selection?"
                  : `Remove ${pendingRemovePlayer?.displayName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "delete"
                ? "This permanently removes the players, the generated pool, all picks and the history."
                : confirming === "undo"
                  ? "The option returns to the pool and the same player gets the turn again. The action stays visible in Activity."
                : pendingRemovePlayer?.isClaimed
                  ? "Their claimed seat and access are removed from the draft."
                  : "Their open seat is removed and the draft order closes around it."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirming === "undo" ? "default" : "destructive"}
              disabled={busy}
              onClick={() => {
                if (confirming === "delete") void deleteDraft();
                else if (confirming === "undo") {
                  void run(
                    () => api.undoLastPick(draft.slug, draft.version),
                    "Last selection undone.",
                  ).then(() => setConfirming(undefined));
                } else if (pendingRemovePlayer) {
                  void run(
                    () => api.removePlayer(draft.slug, pendingRemovePlayer.id, draft.version),
                    `${pendingRemovePlayer.displayName} removed from the table.`,
                  ).then(() => setConfirming(undefined));
                }
              }}
            >
              {confirming === "delete" ? "Delete draft" : confirming === "undo" ? "Undo selection" : "Remove player"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export type { Faction, Position, PublicOption };
