import { useEffect, useState } from "react";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { DraftStatus, PublicDraft, PublicDraftSummary } from "@imperium/domain";

import { Brand } from "@/components/brand";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

function updatedLabel(updatedAt: string): string {
  const updated = new Date(updatedAt);
  const deltaMinutes = Math.max(0, Math.round((Date.now() - updated.getTime()) / 60_000));
  if (deltaMinutes < 1) return "just now";
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(updated);
}

function completedLabel(updatedAt: string): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(updatedAt));
}

export function isLiveDraftStatus(status: DraftStatus): boolean {
  return status === "SETUP" || status === "BANNING" || status === "DRAFTING";
}

function isArchivedDraftStatus(status: DraftStatus): boolean {
  return status === "COMPLETE" || status === "ARCHIVED";
}

function EmptyState({ onNew }: { onNew: () => void }) {
  const hex = (style: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    clipPath: "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)",
    ...style,
  });
  return (
    <div className="empty-hero">
      <div className="empty-hex-art" aria-hidden="true">
        <i style={hex({ left: 0, top: 0, width: 96, height: 83, background: "#151b23" })} />
        <i style={hex({ left: 3, top: 2.6, width: 90, height: 78, background: "#0b0e13" })} />
        <i style={hex({ left: 34, top: 33, width: 28, height: 24, background: "#232c38" })} />
      </div>
      <h2>No tables yet</h2>
      <p>Create a draft, share the link in your group chat, and the table claims their seats.</p>
      <button type="button" className="btn-accent" onClick={onNew}>
        Create first draft
      </button>
    </div>
  );
}

export function DraftsScreen({
  currentDraft,
  onOpen,
  onNew,
  onReturnCurrent,
}: {
  currentDraft?: PublicDraft;
  onOpen: (slug: string) => Promise<void>;
  onNew: () => void;
  onReturnCurrent: () => void;
  onDeleted: (slug: string) => void;
}) {
  const [drafts, setDrafts] = useState<PublicDraftSummary[]>();
  const [openingSlug, setOpeningSlug] = useState<string>();

  useEffect(() => {
    let active = true;
    api
      .listDrafts()
      .then((items) => active && setDrafts(items))
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : "Could not load drafts");
      });
    return () => {
      active = false;
    };
  }, []);

  async function openDraft(slug: string) {
    setOpeningSlug(slug);
    try {
      await onOpen(slug);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open draft");
    } finally {
      setOpeningSlug(undefined);
    }
  }

  const live = drafts?.filter((draft) => isLiveDraftStatus(draft.status)) ?? [];
  const archive = drafts?.filter((draft) => isArchivedDraftStatus(draft.status)) ?? [];

  const heroSub =
    drafts === undefined
      ? ""
      : live.length === 0
        ? "No live tables right now. Start one and share the link."
        : `${live.length === 1 ? "One table is" : `${live.length} tables are`} live.${
            archive.length ? ` ${archive.length} in the archive.` : ""
          }`;

  return (
    <main className="app-shell">
      <header className="list-topbar">
        <Brand />
        <div className="list-topbar-actions">
          {currentDraft && (
            <button type="button" className="btn-quiet is-sm" onClick={onReturnCurrent}>
              Return to draft
            </button>
          )}
          <button type="button" className="btn-accent is-sm mb-only" onClick={onNew}>
            <PlusIcon aria-hidden="true" />
            New draft
          </button>
        </div>
      </header>

      <div className="list-hero dk-only">
        <div>
          <h1>Your drafts</h1>
          <p>{heroSub}</p>
        </div>
        <button type="button" className="btn-accent" onClick={onNew}>
          <PlusIcon aria-hidden="true" />
          New draft
        </button>
      </div>

      {drafts === undefined ? (
        <div style={{ padding: "16px" }}>
          <Skeleton className="h-24 w-full" style={{ marginBottom: 9 }} />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : drafts.length === 0 ? (
        <EmptyState onNew={onNew} />
      ) : (
        <div style={{ padding: "16px 16px 28px" }}>
          {live.length > 0 && (
            <>
              <div className="mono-label" style={{ marginBottom: 11 }}>
                LIVE TABLES · {live.length}
              </div>
              <div className="list-live-grid">
                {live.map((draft) => {
                  const isSetup = draft.status === "SETUP";
                  const isBanning = draft.status === "BANNING";
                  const isCurrent = currentDraft?.slug === draft.slug;
                  const color = isSetup ? "var(--blue)" : isBanning ? "var(--orange)" : "var(--lime)";
                  const percent = isSetup
                    ? (draft.claimedPlayerCount / Math.max(1, draft.playerCount)) * 100
                    : 100;
                  return (
                    <button
                      key={draft.id}
                      type="button"
                      className={cn("live-card", (isCurrent || !isSetup) && "is-hot")}
                      style={{ "--status-color": color } as React.CSSProperties}
                      disabled={Boolean(openingSlug)}
                      onClick={() => openDraft(draft.slug)}
                    >
                      <span style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ flex: "1 1 auto", minWidth: 0, display: "block" }}>
                          <span className="live-card-status">
                            <i />
                            <span>{isSetup ? "Gathering seats" : isBanning ? "Ban phase live" : "Drafting live"}</span>
                          </span>
                          <h3>{draft.title}</h3>
                          <span className="live-card-meta">
                            {draft.playerCount} players · {updatedLabel(draft.updatedAt)}
                          </span>
                        </span>
                        <ChevronRightIcon className="chevron" style={{ marginTop: 12 }} aria-hidden="true" />
                      </span>
                      <span className="live-card-progress">
                        <span className="progress-rail">
                          <span className="progress-fill" style={{ width: `${percent}%`, display: "block" }} />
                        </span>
                        <em>
                          {isBanning ? "Bans in progress" : `${draft.claimedPlayerCount}/${draft.playerCount} seats`}
                        </em>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {archive.length > 0 && (
            <>
              <div className="mono-label" style={{ margin: "22px 0 11px" }}>
                ARCHIVE · {archive.length}
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {archive.map((draft) => (
                  <button
                    key={draft.id}
                    type="button"
                    className="archive-row"
                    disabled={Boolean(openingSlug)}
                    onClick={() => openDraft(draft.slug)}
                  >
                    <span style={{ display: "block", minWidth: 0 }}>
                      <strong>{draft.title}</strong>
                      <small>
                        completed {completedLabel(draft.updatedAt)} · {draft.playerCount} players
                      </small>
                    </span>
                    <ChevronRightIcon className="chevron" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </>
          )}

          {live.length === 0 && archive.length > 0 && null}
        </div>
      )}
    </main>
  );
}
