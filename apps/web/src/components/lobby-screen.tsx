import { useState } from "react";
import { toast } from "sonner";
import type { PublicDraft } from "@imperium/domain";

import { DraftActivity } from "@/components/draft-activity";
import { DraftNavigation, type DraftView } from "@/components/draft-navigation";
import { MapBoard } from "@/components/map-board";
import { ManageSheet, RoomTopbar, TableView } from "@/components/room-parts";
import { SliceCard } from "@/components/slice-board";
import { SliceSheet } from "@/components/room-parts";
import { api, getDemoIdentity, setDemoIdentity } from "@/lib/api";

export function LobbyScreen({
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
  const [manageOpen, setManageOpen] = useState(false);
  const [sheetSliceId, setSheetSliceId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const claimed = draft.players.filter((player) => player.isClaimed).length;
  const slices = draft.options
    .filter((option) => option.kind === "SLICE")
    .sort((left, right) => left.sortOrder - right.sortOrder);

  async function startDraft() {
    setBusy(true);
    try {
      const updated = await api.startDraft(draft.slug, draft.version);
      onDraft(updated);
      onViewChange("draft");
      toast.success("Drafting started. Players can still claim their seats.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start drafting");
    } finally {
      setBusy(false);
    }
  }

  async function previewAs(playerId: string, name: string) {
    const creatorPlayerId = localStorage.getItem("imperium-demo-creator-player");
    setDemoIdentity({ id: playerId === creatorPlayerId ? "creator" : playerId, name });
    onDraft(await api.getDraft(draft.slug));
  }

  return (
    <main className="room-shell">
      <RoomTopbar
        title={draft.title}
        meta={`SETUP · ${claimed}/${draft.players.length} SEATS CLAIMED`}
        onBack={onShowDrafts}
        onManage={() => setManageOpen(true)}
      />

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

      <div className="room-body" key={view}>
        {view === "table" && (
          <>
            <TableView draft={draft} onDraft={onDraft} busy={busy} setBusy={setBusy} />
            {draft.canManage && (
              <div style={{ padding: "0 16px 24px" }}>
                <button
                  type="button"
                  className="btn-accent is-block"
                  disabled={busy}
                  onClick={() => void startDraft()}
                >
                  Start selections now
                </button>
                <p
                  style={{
                    margin: "8px 0 0",
                    color: "var(--soft)",
                    font: "400 11.5px/1.45 var(--font-sans)",
                    textAlign: "center",
                  }}
                >
                  Players can claim their seats while drafting is running.
                </p>
              </div>
            )}
          </>
        )}

        {view === "draft" && (
          <div style={{ padding: "12px 16px 24px" }}>
            <div className="mono-label" style={{ marginBottom: 4 }}>
              GENERATED POOL · {slices.length} SLICES
            </div>
            <p style={{ margin: "0 0 12px", font: "400 12px/1.45 var(--font-sans)", color: "var(--soft)" }}>
              Browse the slices before the draft starts.{" "}
              {draft.canManage ? "Regenerate from the ··· menu if the pool looks off." : "The host can still regenerate."}
            </p>
            <div className="slice-legend">
              <span>
                <i style={{ background: "var(--res)" }} />
                RESOURCES
              </span>
              <span>
                <i style={{ background: "var(--inf)" }} />
                INFLUENCE
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {slices.map((option) => (
                <SliceCard key={option.id} option={option} onSelect={() => setSheetSliceId(option.id)} />
              ))}
            </div>
          </div>
        )}

        {view === "map" && <MapBoard draft={draft} />}
        {view === "activity" && <DraftActivity draft={draft} />}
      </div>

      <DraftNavigation view={view} onViewChange={onViewChange} />

      <SliceSheet
        draft={draft}
        optionId={sheetSliceId}
        onOpenChange={(open) => !open && setSheetSliceId(undefined)}
        canTake={false}
        takeLabel="Drafting has not started"
        onTake={() => undefined}
      />
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
