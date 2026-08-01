import { useState } from "react";
import { Check, ChevronRight, LogOut, Trash2, UserRoundCheck, UsersRound } from "lucide-react";
import { toast } from "sonner";
import type { PublicDraft, PublicPlayer } from "@imperium/domain";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type PendingAction = {
  kind: "claim" | "release" | "remove";
  player: PublicPlayer;
};

function actionCopy(action: PendingAction) {
  if (action.kind === "claim") {
    return {
      title: `Take ${action.player.displayName}'s seat?`,
      description: "This name will represent you for the draft. You can unsign before the draft begins.",
      confirm: "Confirm seat",
    };
  }
  if (action.kind === "release") {
    return {
      title: `Unsign from ${action.player.displayName}?`,
      description: "The seat will become available for another player to claim.",
      confirm: "Unsign",
    };
  }
  return {
    title: `Remove ${action.player.displayName}?`,
    description: action.player.isClaimed
      ? "Their claimed seat and access will be removed from the draft."
      : "Their open seat will be removed and the draft order will close around it.",
    confirm: "Remove player",
  };
}

export function SeatClaimFlow({
  draft,
  onDraft,
  showSummary,
}: {
  draft: PublicDraft;
  onDraft: (draft: PublicDraft) => void;
  showSummary: boolean;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [busy, setBusy] = useState(false);
  const currentPlayer = draft.players.find((player) => player.isCurrentUser);
  const claimedCount = draft.players.filter((player) => player.isClaimed).length;
  const copy = pendingAction ? actionCopy(pendingAction) : undefined;

  function requestAction(kind: PendingAction["kind"], player: PublicPlayer) {
    setDrawerOpen(false);
    setPendingAction({ kind, player });
  }

  async function confirmAction() {
    if (!pendingAction) return;
    setBusy(true);
    try {
      let updated: PublicDraft;
      if (pendingAction.kind === "claim") {
        updated = await api.claimPlayer(draft.slug, pendingAction.player.id, draft.version);
        toast.success(`Signed in as ${pendingAction.player.displayName}`);
      } else if (pendingAction.kind === "release") {
        updated = await api.unclaimPlayer(draft.slug, pendingAction.player.id, draft.version);
        toast.success(`${pendingAction.player.displayName} is available again`);
      } else {
        updated = await api.removePlayer(draft.slug, pendingAction.player.id, draft.version);
        toast.success(`${pendingAction.player.displayName} removed from the table`);
      }
      onDraft(updated);
      setPendingAction(undefined);
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Seat update failed");
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {showSummary && currentPlayer ? (
        <section className="seat-summary" aria-labelledby="your-seat-title">
          <div className="seat-summary-identity">
            <span className="player-avatar" style={{ "--player-color": currentPlayer.color } as React.CSSProperties}>
              {currentPlayer.displayName.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <span className="eyebrow">Your seat</span>
              <h2 id="your-seat-title">{currentPlayer.displayName}</h2>
            </div>
            <Badge variant="secondary">
              <Check aria-hidden="true" /> Signed
            </Badge>
          </div>
          <div className="seat-summary-actions">
            <Button variant="outline" onClick={() => setDrawerOpen(true)}>
              <UsersRound data-icon="inline-start" aria-hidden="true" />
              View all seats
            </Button>
            <Button variant="ghost" onClick={() => requestAction("release", currentPlayer)}>
              <LogOut data-icon="inline-start" aria-hidden="true" />
              Unsign
            </Button>
          </div>
        </section>
      ) : null}

      {!currentPlayer ? (
        <button type="button" className="seat-claim-dock" onClick={() => setDrawerOpen(true)}>
          <span>
            <UserRoundCheck aria-hidden="true" />
            <span>
              <strong>Take your seat</strong>
              <small>Choose your name to join the table</small>
            </span>
          </span>
          <ChevronRight aria-hidden="true" />
        </button>
      ) : null}

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} showSwipeHandle>
        <DrawerContent className="seat-drawer">
          <DrawerHeader>
            <span className="eyebrow">Identity check</span>
            <DrawerTitle>Choose your seat</DrawerTitle>
            <DrawerDescription>
              {claimedCount} of {draft.players.length} seats signed. Taken seats cannot be selected.
            </DrawerDescription>
          </DrawerHeader>
          <ScrollArea className="seat-drawer-scroll">
            <div className="seat-picker-list">
              {draft.players.map((player, index) => {
                const isYours = player.isCurrentUser;
                const isUnavailable = Boolean(currentPlayer) || player.isClaimed || busy;
                return (
                  <div key={player.id} className={cn("seat-picker-row", isYours && "is-yours")}>
                    <button
                      type="button"
                      className="seat-picker-choice"
                      disabled={isUnavailable}
                      onClick={() => requestAction("claim", player)}
                    >
                      <span className="player-avatar" style={{ "--player-color": player.color } as React.CSSProperties}>
                        {player.displayName.slice(0, 1).toUpperCase()}
                      </span>
                      <span>
                        <small>Draft order {index + 1}</small>
                        <strong>{player.displayName}</strong>
                        {player.telegramUsername ? <i>@{player.telegramUsername}</i> : null}
                      </span>
                      <Badge variant={isYours ? "default" : player.isClaimed ? "secondary" : "outline"}>
                        {isYours ? "Yours" : player.isClaimed ? "Taken" : player.telegramUsername ? "Reserved" : "Available"}
                      </Badge>
                    </button>
                    {draft.canManage && draft.players.length > 3 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        aria-label={`Remove ${player.displayName}`}
                        onClick={() => requestAction("remove", player)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          <DrawerFooter>
            <DrawerClose render={<Button variant="outline" />}>Close</DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <AlertDialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingAction(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              {pendingAction?.kind === "claim" ? (
                <UserRoundCheck aria-hidden="true" />
              ) : pendingAction?.kind === "remove" ? (
                <Trash2 aria-hidden="true" />
              ) : (
                <LogOut aria-hidden="true" />
              )}
            </AlertDialogMedia>
            <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
            <AlertDialogDescription>{copy?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={pendingAction?.kind === "claim" ? "default" : "destructive"}
              disabled={busy}
              onClick={confirmAction}
            >
              {copy?.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
