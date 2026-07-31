import { useEffect, useMemo, useState } from "react";
import { Activity, Check, ChevronRight, Map, Radio, Sparkles, UsersRound } from "lucide-react";
import { toast } from "sonner";
import type { Faction, Position, PublicDraft, PublicOption } from "@imperium/domain";

import { Brand } from "@/components/brand";
import { MapBoard } from "@/components/map-board";
import { SliceCard } from "@/components/slice-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, getDemoIdentity, setDemoIdentity } from "@/lib/api";
import { cn } from "@/lib/utils";

type View = "draft" | "map" | "activity";

function OptionButton({
  option,
  selected,
  disabled,
  onClick,
}: {
  option: PublicOption;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const payload = option.payload as unknown as Faction | Position;
  const isFaction = option.kind === "FACTION";
  return (
    <button
      type="button"
      className={cn("option-row", selected && "is-selected", option.selectedByPlayerId && "is-taken")}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
    >
      <span className={isFaction ? "faction-sigil" : "position-sigil"}>
        {isFaction ? (payload as Faction).shortName.slice(0, 2).toUpperCase() : (payload as Position).shortLabel}
      </span>
      <span>
        <strong>{isFaction ? (payload as Faction).shortName : option.label}</strong>
        <small>{isFaction ? (payload as Faction).trait : (payload as Position).description}</small>
      </span>
      {option.selectedByPlayerId ? <Badge variant="secondary">Taken</Badge> : <ChevronRight aria-hidden="true" />}
    </button>
  );
}

export function DraftScreen({
  draft,
  onDraft,
  onShowDrafts,
}: {
  draft: PublicDraft;
  onDraft: (draft: PublicDraft) => void;
  onShowDrafts: () => void;
}) {
  const [view, setView] = useState<View>("draft");
  const [kind, setKind] = useState<"FACTION" | "SLICE" | "POSITION">("FACTION");
  const [selectedOptionId, setSelectedOptionId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const activePlayer = draft.players.find((player) => player.id === draft.activePlayerId);
  const currentPlayer = draft.players.find((player) => player.isCurrentUser);
  const isMyTurn = currentPlayer?.id === activePlayer?.id;
  const options = draft.options.filter((option) => option.kind === kind);
  const selected = draft.options.find((option) => option.id === selectedOptionId);
  const currentPicks = currentPlayer?.picks ?? {};
  const isComplete = draft.status === "COMPLETE";

  const selectionAllowed = useMemo(
    () => isMyTurn && !currentPicks[kind.toLowerCase() as keyof typeof currentPicks],
    [currentPicks, isMyTurn, kind],
  );

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

  async function pick() {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await api.pick(draft.slug, selected.id, draft.version);
      onDraft(updated);
      setSelectedOptionId(undefined);
      toast.success(`${selected.label} locked in`);
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pick failed");
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
    } finally {
      setBusy(false);
    }
  }

  async function previewAs(playerId: string, name: string) {
    const creatorPlayerId = localStorage.getItem("imperium-demo-creator-player");
    setDemoIdentity({
      id: playerId === creatorPlayerId ? "creator" : playerId,
      name,
    });
    onDraft(await api.getDraft(draft.slug));
  }

  return (
    <main className={cn("draft-shell", view === "map" && "map-is-open")}>
      <header className="app-header">
        <Brand compact />
        <div className="app-header-actions">
          <Button variant="ghost" size="sm" onClick={onShowDrafts}>
            My drafts
          </Button>
          <div className="draft-header-meta">
            <span>{draft.title}</span>
            <Badge variant={isComplete ? "default" : "outline"}>
              <Radio aria-hidden="true" />
              {isComplete ? "Complete" : "Live"}
            </Badge>
          </div>
        </div>
      </header>

      {view === "draft" && (
        <div className="draft-content">
          <section className="turn-hero">
            <div>
              <span className="eyebrow">
                {isComplete
                  ? "Draft complete"
                  : `Choice ${Math.min(draft.turnCursor + 1, draft.totalTurns)} of ${draft.totalTurns}`}
              </span>
              <h1>
                {isComplete ? (
                  <>The galaxy is <em>ready.</em></>
                ) : isMyTurn ? (
                  <>Your move, <em>{activePlayer?.displayName}.</em></>
                ) : (
                  <><em>{activePlayer?.displayName}</em> is choosing.</>
                )}
              </h1>
              <p>
                {isComplete
                  ? "Every player has a faction, slice, and table position. Inspect the assembled field."
                  : isMyTurn
                    ? "Select one category you still need. The group bot will notify the table when it is locked."
                    : "Remaining options stay visible while the active player makes their selection."}
              </p>
            </div>
            <div className="turn-progress">
              <strong>{Math.min(draft.turnCursor, draft.totalTurns)}</strong>
              <span>/ {draft.totalTurns} locked</span>
              <i
                style={{ "--progress": `${(draft.turnCursor / draft.totalTurns) * 100}%` } as React.CSSProperties}
              />
            </div>
          </section>

          {!window.Telegram?.WebApp.initData && (
            <div className="demo-rail">
              <span>Local preview as</span>
              {draft.players.map((player) => (
                <button
                  key={player.id}
                  type="button"
                  className={player.isCurrentUser ? "is-active" : ""}
                  onClick={() => previewAs(player.id, player.displayName)}
                >
                  <i style={{ background: player.color }}>{player.displayName.slice(0, 1)}</i>
                  {player.displayName}
                </button>
              ))}
              <small>{getDemoIdentity().name}</small>
            </div>
          )}

          <section className="choice-section">
            <Tabs
              value={kind}
              onValueChange={(value) => {
                setKind(value as typeof kind);
                setSelectedOptionId(undefined);
              }}
            >
              <TabsList variant="line" className="choice-tab-list">
                <TabsTrigger value="FACTION">
                  Factions {currentPicks.faction && <Check aria-hidden="true" />}
                </TabsTrigger>
                <TabsTrigger value="SLICE">
                  Slices {currentPicks.slice && <Check aria-hidden="true" />}
                </TabsTrigger>
                <TabsTrigger value="POSITION">
                  Seats {currentPicks.position && <Check aria-hidden="true" />}
                </TabsTrigger>
              </TabsList>
              {(["FACTION", "SLICE", "POSITION"] as const).map((tabKind) => (
                <TabsContent key={tabKind} value={tabKind}>
                  {tabKind === "SLICE" ? (
                    <div className="slice-carousel draft-slices">
                      {draft.options
                        .filter((option) => option.kind === tabKind)
                        .map((option) => (
                          <SliceCard
                            key={option.id}
                            option={option}
                            selected={selectedOptionId === option.id}
                            disabled={Boolean(option.selectedByPlayerId) || !selectionAllowed || isComplete}
                            onSelect={() => setSelectedOptionId(option.id)}
                          />
                        ))}
                    </div>
                  ) : (
                    <div className={cn("option-grid", tabKind === "POSITION" && "position-grid")}>
                      {draft.options
                        .filter((option) => option.kind === tabKind)
                        .map((option) => (
                          <OptionButton
                            key={option.id}
                            option={option}
                            selected={selectedOptionId === option.id}
                            disabled={Boolean(option.selectedByPlayerId) || !selectionAllowed || isComplete}
                            onClick={() => setSelectedOptionId(option.id)}
                          />
                        ))}
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </section>
        </div>
      )}

      {view === "map" && <MapBoard draft={draft} />}

      {view === "activity" && (
        <section className="activity-page">
          <span className="eyebrow">Immutable history</span>
          <h1>Draft transmission log</h1>
          <div className="activity-list">
            {draft.events.map((event) => {
              const player = draft.players.find((candidate) => candidate.id === event.playerId);
              return (
                <article key={event.id}>
                  <span><Sparkles aria-hidden="true" /></span>
                  <div>
                    <strong>{event.type.replaceAll("_", " ").toLocaleLowerCase()}</strong>
                    <p>
                      {player?.displayName}
                      {event.payload.optionLabel ? ` · ${String(event.payload.optionLabel)}` : ""}
                    </p>
                  </div>
                  <time>{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {view === "draft" && selected && (
        <div className="confirm-dock">
          <span>
            Lock <strong>{selected.label}</strong>?
          </span>
          <Button size="lg" disabled={busy} onClick={pick}>
            Confirm choice
            <ChevronRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        </div>
      )}

      <nav className="bottom-nav" aria-label="Primary">
        <button className={view === "draft" ? "is-active" : ""} onClick={() => setView("draft")}>
          <UsersRound aria-hidden="true" />
          Draft
        </button>
        <button className={view === "map" ? "is-active" : ""} onClick={() => setView("map")}>
          <Map aria-hidden="true" />
          Map
        </button>
        <button className={view === "activity" ? "is-active" : ""} onClick={() => setView("activity")}>
          <Activity aria-hidden="true" />
          Activity
        </button>
      </nav>
    </main>
  );
}
