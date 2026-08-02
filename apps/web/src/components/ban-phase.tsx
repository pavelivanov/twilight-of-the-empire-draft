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
  const nextUnlockedPlayer = draft.players.find(
    (player) => !factionOptions.some((option) => option.bannedByPlayerId === player.id),
  );
  const banPlayer = draft.canManage ? nextUnlockedPlayer : currentPlayer;
  const playerBan = banPlayer
    ? factionOptions.find((option) => option.bannedByPlayerId === banPlayer.id)
    : undefined;
  const isManagingBan = Boolean(draft.canManage && banPlayer && banPlayer.id !== currentPlayer?.id);
  const lockedCount = banLockedCount(draft);
  const selected = factionOptions.find((option) => option.id === selectedOptionId);

  async function lockBan() {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await api.ban(
        draft.slug,
        selected.id,
        draft.version,
        draft.canManage ? banPlayer?.id : undefined,
      );
      onDraft(updated);
      setSelectedOptionId(undefined);
      toast.success(
        isManagingBan
          ? `${selected.label} banned for ${banPlayer?.displayName ?? "the player"}.`
          : `${selected.label} banned.`,
      );
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
    if (!banPlayer) {
      toast.info("You are watching — only seated players ban.");
      return;
    }
    if (playerBan) {
      toast.info(`${banPlayer.displayName}'s ban is locked: ${playerBan.label}.`);
      return;
    }
    setSelectedOptionId((current) => (current === optionId ? undefined : optionId));
  }

  const ctaLabel = !banPlayer
    ? "Watching the ban phase"
    : playerBan
      ? `Ban locked · waiting on ${draft.players.length - lockedCount} more`
      : selected
        ? isManagingBan
          ? `Lock for ${banPlayer.displayName} · ${(selected.payload as unknown as Faction).shortName}`
          : `Lock ban · ${(selected.payload as unknown as Faction).shortName}`
        : isManagingBan
          ? `Select a ban for ${banPlayer.displayName}`
          : "Select a faction to ban";
  const ctaEnabled = Boolean(banPlayer && !playerBan && selected && !busy);

  return (
    <div className="ban-layout">
      <div className="ban-rail">
      <div className="ban-head">
        <div className="ban-kicker">
          <i aria-hidden="true" />
          <span>BAN PHASE</span>
        </div>
        <h2>
          {playerBan
            ? `${banPlayer?.displayName}'s ban is locked`
            : selected
              ? isManagingBan
                ? `Ban selected for ${banPlayer?.displayName}`
                : "One ban selected"
              : isManagingBan
                ? `Choose a ban for ${banPlayer?.displayName}`
                : "Ban one faction"}
        </h2>
        <p>
          {isManagingBan
            ? "As owner, you can lock this player's ban and keep the table moving."
            : "Banned factions leave the pool for everyone. Slices are drafted after bans lock."}
        </p>
        <div className="ban-ticks">
          {draft.players.map((player, index) => (
            <i key={player.id} className={cn(index < lockedCount && "is-locked")} />
          ))}
        </div>
        <div className="ban-count">
          {lockedCount} of {draft.players.length} players have locked their ban
        </div>
      </div>

      <div className="confirm-dock ban-dock">
        <button type="button" className="btn-accent" disabled={!ctaEnabled} onClick={() => void lockBan()}>
          {ctaLabel}
        </button>
      </div>
      </div>

      <div className="ban-pool">
        <div className="ban-grid">
          {factionOptions.map((option) => {
            const faction = option.payload as unknown as Faction;
            const meta = factionMeta[faction.id];
            const isBanned = Boolean(option.bannedByPlayerId);
            const isTargetBan = Boolean(banPlayer && option.bannedByPlayerId === banPlayer.id);
            const isSelected = selectedOptionId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={cn("ban-card", isBanned && "is-banned", (isSelected || isTargetBan) && "is-selected")}
                onClick={() => tapFaction(option.id)}
              >
                <span className="ban-card-name">{faction.name}</span>
                <span className="ban-card-sub">
                  <span className="tech-dots">
                    {(meta?.techs ?? []).map((tech, index) => (
                      <i key={index} style={{ background: techColorHex[tech] }} />
                    ))}
                  </span>
                  <em>
                    {isTargetBan
                      ? isManagingBan
                        ? `${banPlayer?.displayName.toUpperCase()}'S BAN`
                        : "YOUR BAN"
                      : isBanned
                        ? "BANNED"
                        : (meta?.tag ?? faction.trait)}
                  </em>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
