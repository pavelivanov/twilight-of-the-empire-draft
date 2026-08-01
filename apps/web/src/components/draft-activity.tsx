import { useMemo, useState } from "react";
import type { PublicDraft } from "@imperium/domain";

import { cn } from "@/lib/utils";

type LogFilter = "all" | "picks" | "admin";

type LogRow =
  | { kind: "divider"; id: string; label: string }
  | {
      kind: "entry";
      id: string;
      time: string;
      accent: string;
      who: string;
      verb: string;
      target: string;
      tag: string;
    };

const kindAccent: Record<string, string> = {
  SLICE: "#6fb0e8",
  FACTION: "#cdf05e",
  POSITION: "#e0a94a",
};

const adminLabels: Record<string, string> = {
  DRAFT_CREATED: "created the table",
  PLAYER_CLAIMED: "claimed a seat",
  PLAYER_UNCLAIMED: "left a seat",
  PLAYER_REMOVED: "removed a player",
  POOL_REGENERATED: "regenerated the pool",
  DRAFT_STARTED: "started the draft",
  BAN_PHASE_COMPLETED: "locked the ban phase — drafting begins",
};

export function DraftActivity({ draft }: { draft: PublicDraft }) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const playerCount = Math.max(1, draft.players.length);
  const players = useMemo(() => new Map(draft.players.map((player) => [player.id, player])), [draft.players]);

  const rows = useMemo<LogRow[]>(() => {
    const ascending = [...draft.events].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    let pickIndex = 0;
    const annotated = ascending.map((event) => {
      const isPick = event.type === "OPTION_SELECTED";
      const index = isPick ? pickIndex++ : -1;
      return { event, pickIndex: index, round: isPick ? Math.floor(index / playerCount) + 1 : 0 };
    });
    const filtered = annotated.filter(({ event }) => {
      if (filter === "picks") return event.type === "OPTION_SELECTED";
      if (filter === "admin") return event.type !== "OPTION_SELECTED";
      return true;
    });
    const result: LogRow[] = [];
    let lastRound: number | null = null;
    for (const { event, pickIndex: index, round } of [...filtered].reverse()) {
      if (round !== lastRound) {
        lastRound = round;
        result.push({
          kind: "divider",
          id: `divider-${round}-${event.id}`,
          label: round === 0 ? "SETUP" : `ROUND ${round}`,
        });
      }
      const time = new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const who = event.playerId ? (players.get(event.playerId)?.displayName ?? "Someone") : "Host";
      if (event.type === "OPTION_SELECTED") {
        const optionKind = String(event.payload.optionKind ?? "");
        result.push({
          kind: "entry",
          id: event.id,
          time,
          accent: kindAccent[optionKind] ?? "#6b7480",
          who,
          verb: "took",
          target: String(event.payload.optionLabel ?? ""),
          tag: `${optionKind} · PICK ${index + 1}/${draft.totalTurns}`,
        });
      } else if (event.type === "PLAYER_BANNED") {
        result.push({
          kind: "entry",
          id: event.id,
          time,
          accent: "#cf6b57",
          who,
          verb: "banned",
          target: String(event.payload.optionLabel ?? ""),
          tag: "BAN PHASE",
        });
      } else {
        const subject = event.payload.playerName ? String(event.payload.playerName) : "";
        result.push({
          kind: "entry",
          id: event.id,
          time,
          accent: "#6b7480",
          who,
          verb: adminLabels[event.type] ?? event.type.replaceAll("_", " ").toLowerCase(),
          target: subject === who ? "" : subject,
          tag: "TABLE ACTION",
        });
      }
    }
    return result;
  }, [draft.events, draft.totalTurns, filter, playerCount, players]);

  return (
    <div>
      <div className="log-filters">
        {(
          [
            { id: "all", label: "ALL" },
            { id: "picks", label: "PICKS" },
            { id: "admin", label: "TABLE" },
          ] as const
        ).map((option) => (
          <button
            key={option.id}
            type="button"
            className={cn("filter-chip", filter === option.id && "is-active")}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="log-list">
        {rows.length === 0 && (
          <p style={{ font: "400 12.5px/1.5 var(--font-sans)", color: "var(--muted-foreground)", padding: "16px 2px" }}>
            Nothing in the log yet.
          </p>
        )}
        {rows.map((row) =>
          row.kind === "divider" ? (
            <div key={row.id} className="log-divider">
              <span>{row.label}</span>
              <i />
            </div>
          ) : (
            <div
              key={row.id}
              className="log-entry"
              style={{ "--log-accent": row.accent } as React.CSSProperties}
            >
              <time>{row.time}</time>
              <i />
              <div className="log-entry-main">
                <p>
                  <strong>{row.who}</strong> {row.verb} {row.target && <em>{row.target}</em>}
                </p>
                <small>{row.tag}</small>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
