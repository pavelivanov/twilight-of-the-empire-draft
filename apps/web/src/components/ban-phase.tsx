import { useState } from "react";
import { toast } from "sonner";
import type { Faction, PublicDraft } from "@imperium/domain";

import { api } from "@/lib/api";
import { factionMeta, techColorHex } from "@/lib/ti4-meta";
import { cn } from "@/lib/utils";

export function banLockedCount(draft: PublicDraft): number {
  return new Set(
    draft.options
      .filter((option) => option.bannedByPlayerId)
      .map((option) => option.bannedByPlayerId as string),
  ).size;
}

export function BanPhaseView({
  draft,
  onDraft,
}: {
  draft: PublicDraft;
  onDraft: (draft: PublicDraft) => void;
}) {
  const [selectedOptionId, setSelectedOptionId] = useState<string>();
  const [busy, setBusy] = useState(false);

  const currentPlayer = draft.players.find((player) => player.isCurrentUser);
  const factionOptions = draft.options
    .filter((option) => option.kind === "FACTION")
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const myBan = currentPlayer
    ? factionOptions.find((option) => option.bannedByPlayerId === currentPlayer.id)
    : undefined;
  const lockedCount = banLockedCount(draft);
  const selected = factionOptions.find((option) => option.id === selectedOptionId);

  async function lockBan() {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await api.ban(draft.slug, selected.id, draft.version);
      onDraft(updated);
      setSelectedOptionId(undefined);
      toast.success(`${selected.label} banned.`);
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ban failed");
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
    } finally {
      setBusy(false);
    }
  }

  function tapFaction(optionId: string) {
    const option = factionOptions.find((candidate) => candidate.id === optionId);
    if (!option) return;
    if (option.bannedByPlayerId) {
      const banner = draft.players.find((player) => player.id === option.bannedByPlayerId);
      toast.info(`${option.label} is already banned${banner ? ` by ${banner.displayName}` : ""}.`);
      return;
    }
    if (!currentPlayer) {
      toast.info("You are watching — only seated players ban.");
      return;
    }
    if (myBan) {
      toast.info(`Your ban is locked: ${myBan.label}.`);
      return;
    }
    setSelectedOptionId((current) => (current === optionId ? undefined : optionId));
  }

  const ctaLabel = !currentPlayer
    ? "Watching the ban phase"
    : myBan
      ? `Ban locked · waiting on ${draft.players.length - lockedCount} more`
      : selected
        ? `Lock ban · ${(selected.payload as unknown as Faction).shortName}`
        : "Select a faction to ban";
  const ctaEnabled = Boolean(currentPlayer && !myBan && selected && !busy);

  return (
    <div style={{ position: "relative", minHeight: "100%" }}>
      <div className="ban-head">
        <div className="ban-kicker">
          <i aria-hidden="true" />
          <span>BAN PHASE</span>
        </div>
        <h2>{myBan ? "Your ban is locked" : selected ? "One ban selected" : "Ban one faction"}</h2>
        <p>Banned factions leave the pool for everyone. Slices are drafted after bans lock.</p>
        <div className="ban-ticks">
          {draft.players.map((player, index) => (
            <i key={player.id} className={cn(index < lockedCount && "is-locked")} />
          ))}
        </div>
        <div className="ban-count">
          {lockedCount} of {draft.players.length} players have locked their ban
        </div>
      </div>

      <div style={{ padding: "12px 16px 96px" }}>
        <div className="ban-grid">
          {factionOptions.map((option) => {
            const faction = option.payload as unknown as Faction;
            const meta = factionMeta[faction.id];
            const isBanned = Boolean(option.bannedByPlayerId);
            const isMine = Boolean(currentPlayer && option.bannedByPlayerId === currentPlayer.id);
            const isSelected = selectedOptionId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={cn("ban-card", isBanned && "is-banned", (isSelected || isMine) && "is-selected")}
                onClick={() => tapFaction(option.id)}
              >
                <span className="ban-card-name">{faction.name}</span>
                <span className="ban-card-sub">
                  <span className="tech-dots">
                    {(meta?.techs ?? []).map((tech, index) => (
                      <i key={index} style={{ background: techColorHex[tech] }} />
                    ))}
                  </span>
                  <em>{isMine ? "YOUR BAN" : isBanned ? "BANNED" : (meta?.tag ?? faction.trait)}</em>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="confirm-dock">
        <button type="button" className="btn-accent" disabled={!ctaEnabled} onClick={() => void lockBan()}>
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}
