import { useEffect, useState } from "react";
import { Bot, Copy, Dices, Rocket } from "lucide-react";
import { toast } from "sonner";
import type { PublicDraft } from "@imperium/domain";

import { Brand } from "@/components/brand";
import { DraftActivity } from "@/components/draft-activity";
import { DraftNavigation, type DraftView } from "@/components/draft-navigation";
import { MapBoard } from "@/components/map-board";
import { SeatClaimFlow } from "@/components/seat-claim-flow";
import { SliceCard } from "@/components/slice-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

function draftLink(draft: PublicDraft): string {
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  const appShortName = import.meta.env.VITE_TELEGRAM_APP_SHORT_NAME;
  if (botUsername && appShortName) {
    return `https://t.me/${botUsername}/${appShortName}?startapp=${encodeURIComponent(draft.slug)}`;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("draft", draft.slug);
  return url.toString();
}

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
  const [busy, setBusy] = useState(false);
  const slices = draft.options.filter((option) => option.kind === "SLICE");
  const claimed = draft.players.filter((player) => player.isClaimed).length;
  const playerCount = draft.players.length;
  const currentPlayer = draft.players.find((player) => player.isCurrentUser);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

  async function copyInvite() {
    await navigator.clipboard.writeText(draftLink(draft));
    toast.success("Draft link copied");
  }

  async function mutate(action: "start" | "regenerate") {
    setBusy(true);
    try {
      const updated =
        action === "start"
          ? await api.startDraft(draft.slug, draft.version)
          : await api.regenerate(draft.slug, draft.version);
      onDraft(updated);
      toast.success(action === "start" ? "Draft started" : "New balanced pool generated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className={cn(
        "lobby-shell",
        view === "map" && "map-is-open",
        !currentPlayer && "has-seat-claim-dock",
      )}
    >
      <header className="app-header">
        <Brand compact />
        <div className="app-header-actions">
          <Button variant="ghost" size="sm" onClick={onShowDrafts}>
            My drafts
          </Button>
          <Badge variant="outline">Setup</Badge>
        </div>
      </header>
      {view === "draft" && (
        <>
          <section className="lobby-hero">
            <div>
              <span className="eyebrow">Draft room · {draft.slug}</span>
              <h1>{draft.title}</h1>
              <p>Pool generated. Invite the table, claim each identity, then freeze the options and begin.</p>
            </div>
            <div className="lobby-actions">
              <Button variant="outline" size="lg" onClick={copyInvite}>
                <Copy data-icon="inline-start" aria-hidden="true" />
                Copy invite
              </Button>
              {draft.canManage && (
                <>
                  <Button variant="ghost" size="lg" disabled={busy} onClick={() => mutate("regenerate")}>
                    <Dices data-icon="inline-start" aria-hidden="true" />
                    Regenerate
                  </Button>
                  <Button size="lg" disabled={busy || claimed !== playerCount} onClick={() => mutate("start")}>
                    <Rocket data-icon="inline-start" aria-hidden="true" />
                    Start draft
                  </Button>
                </>
              )}
            </div>
          </section>

          <SeatClaimFlow draft={draft} onDraft={onDraft} showSummary />

          <Separator />

          <section className="lobby-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Balanced pool</span>
                <h2>Nine slices, ready to inspect</h2>
              </div>
              <div className="bot-status">
                <Bot aria-hidden="true" />
                <span>Use <strong>/draft {draft.slug}</strong> in the players group</span>
              </div>
            </div>
            <div className="slice-carousel">
              {slices.map((option) => (
                <SliceCard key={option.id} option={option} />
              ))}
            </div>
          </section>
        </>
      )}

      {view === "map" && <MapBoard draft={draft} />}

      {view === "activity" && <DraftActivity draft={draft} />}

      {view !== "draft" ? <SeatClaimFlow draft={draft} onDraft={onDraft} showSummary={false} /> : null}

      <DraftNavigation view={view} onViewChange={onViewChange} />
    </main>
  );
}
