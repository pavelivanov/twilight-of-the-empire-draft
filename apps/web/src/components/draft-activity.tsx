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
      beneficiary?: string;
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
    let draftCursor = 0;
    const annotated = ascending.map((event) => {
      const isSelection = event.type === "OPTION_SELECTED" || event.type === "PICK_REVERTED";
      if (!isSelection) return { event, turnIndex: -1, round: 0 };
      const storedTurnIndex = event.payload.turnIndex;
      const turnIndex =
        typeof storedTurnIndex === "number" && Number.isInteger(storedTurnIndex)
          ? storedTurnIndex
          : event.type === "PICK_REVERTED"
            ? Math.max(0, draftCursor - 1)
            : draftCursor;
      draftCursor = event.type === "PICK_REVERTED" ? turnIndex : turnIndex + 1;
      return { event, turnIndex, round: Math.floor(turnIndex / playerCount) + 1 };
    });
    const filtered = annotated.filter(({ event }) => {
      const isSelection = event.type === "OPTION_SELECTED" || event.type === "PICK_REVERTED";
      if (filter === "picks") return isSelection;
      if (filter === "admin") return !isSelection;
      return true;
    });
    const result: LogRow[] = [];
    let lastRound: number | null = null;
    for (const { event, turnIndex, round } of [...filtered].reverse()) {
      if (round !== lastRound) {
        lastRound = round;
        result.push({
          kind: "divider",
          id: `divider-${round}-${event.id}`,
          label: round === 0 ? "SETUP" : `ROUND ${round}`,
        });
      }
      const time = new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const playerName = event.playerId ? (players.get(event.playerId)?.displayName ?? "Someone") : undefined;
      if (event.type === "OPTION_SELECTED") {
        const optionKind = String(event.payload.optionKind ?? "");
        const performedByCreator = event.payload.performedByCreator === true;
        result.push({
          kind: "entry",
          id: event.id,
          time,
          accent: kindAccent[optionKind] ?? "#6b7480",
          who: performedByCreator ? "Owner" : (playerName ?? "Someone"),
          verb: performedByCreator ? "selected" : "took",
          target: String(event.payload.optionLabel ?? ""),
          beneficiary: performedByCreator ? playerName : undefined,
          tag: `${optionKind} · PICK ${turnIndex + 1}/${draft.totalTurns}${performedByCreator ? " · OWNER ACTION" : ""}`,
        });
      } else if (event.type === "PICK_REVERTED") {
        const optionKind = String(event.payload.optionKind ?? "");
        result.push({
          kind: "entry",
          id: event.id,
          time,
          accent: kindAccent[optionKind] ?? "#6b7480",
          who: "Owner",
          verb: "undid",
          target: String(event.payload.optionLabel ?? ""),
          beneficiary: playerName,
          tag: `PICK ${turnIndex + 1}/${draft.totalTurns} · OWNER ACTION`,
        });
      } else if (event.type === "PLAYER_BANNED") {
        const performedByCreator = event.payload.performedByCreator === true;
        result.push({
          kind: "entry",
          id: event.id,
          time,
          accent: "#cf6b57",
          who: performedByCreator ? "Owner" : (playerName ?? "Someone"),
          verb: "banned",
          target: String(event.payload.optionLabel ?? ""),
          beneficiary: performedByCreator ? playerName : undefined,
          tag: `BAN PHASE${performedByCreator ? " · OWNER ACTION" : ""}`,
        });
      } else {
        const subject = event.payload.playerName ? String(event.payload.playerName) : "";
        const automaticStart = event.type === "DRAFT_STARTED" && event.payload.automatic === true;
        const who = automaticStart ? "Draft" : (playerName ?? "Host");
        result.push({
          kind: "entry",
          id: event.id,
          time,
          accent: "#6b7480",
          who,
          verb: automaticStart
            ? "started automatically"
            : (adminLabels[event.type] ?? event.type.replaceAll("_", " ").toLowerCase()),
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
                  {row.beneficiary && (
                    <>
                      {" "}for <strong>{row.beneficiary}</strong>
                    </>
                  )}
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
