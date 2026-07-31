import { useState } from "react";
import { Bot, Check, Copy, Dices, Rocket, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import type { PublicDraft } from "@imperium/domain";

import { Brand } from "@/components/brand";
import { SliceCard } from "@/components/slice-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { api, getDemoIdentity, setDemoIdentity } from "@/lib/api";

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
}: {
  draft: PublicDraft;
  onDraft: (draft: PublicDraft) => void;
}) {
  const [busy, setBusy] = useState(false);
  const slices = draft.options.filter((option) => option.kind === "SLICE");
  const claimed = draft.players.filter((player) => player.isClaimed).length;
  const currentIdentity = getDemoIdentity();
  const isTelegram = Boolean(window.Telegram?.WebApp.initData);

  async function copyInvite() {
    await navigator.clipboard.writeText(draftLink(draft));
    toast.success("Draft link copied");
  }

  async function claim(playerId: string, displayName: string) {
    setDemoIdentity({ id: playerId, name: displayName });
    setBusy(true);
    try {
      const updated = await api.claimPlayer(draft.slug, playerId, draft.version);
      onDraft(updated);
      toast.success(`Playing as ${displayName}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already own")) {
        const updated = await api.getDraft(draft.slug);
        onDraft(updated);
      } else {
        toast.error(error instanceof Error ? error.message : "Could not claim player");
      }
    } finally {
      setBusy(false);
    }
  }

  async function returnToCreator() {
    const creatorPlayerId = localStorage.getItem("imperium-demo-creator-player");
    const creatorPlayer = draft.players.find((player) => player.id === creatorPlayerId);
    setDemoIdentity({ id: "creator", name: creatorPlayer?.displayName ?? "Draft creator" });
    onDraft(await api.getDraft(draft.slug));
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
    <main className="lobby-shell">
      <header className="app-header">
        <Brand compact />
        <Badge variant="outline">Setup</Badge>
      </header>
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
              <Button size="lg" disabled={busy || claimed !== 6} onClick={() => mutate("start")}>
                <Rocket data-icon="inline-start" aria-hidden="true" />
                Start draft
              </Button>
            </>
          )}
        </div>
      </section>

      <section className="lobby-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Identity check</span>
            <h2>{claimed} / 6 players claimed</h2>
          </div>
          {!isTelegram && currentIdentity.id !== "creator" && (
            <Button variant="outline" onClick={returnToCreator}>
              Return to creator
            </Button>
          )}
        </div>
        <div className="player-lobby-grid">
          {draft.players.map((player, index) => (
            <article key={player.id} className={player.isCurrentUser ? "is-current" : ""}>
              <span className="player-avatar" style={{ "--player-color": player.color } as React.CSSProperties}>
                {player.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <small>Draft order {index + 1}</small>
                <strong>{player.displayName}</strong>
              </div>
              {player.isClaimed ? (
                <Badge variant="secondary">
                  <Check aria-hidden="true" /> Claimed
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => claim(player.id, player.displayName)}
                >
                  <UserRoundCheck data-icon="inline-start" aria-hidden="true" />
                  {isTelegram ? "Claim my seat" : "Preview & claim"}
                </Button>
              )}
            </article>
          ))}
        </div>
        {claimed !== 6 && draft.canManage && (
          <p className="lobby-note">
            All six players must claim their named seat before the draft starts. In Telegram, each player opens
            the shared Mini App link and taps their own name.
          </p>
        )}
      </section>

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
    </main>
  );
}
