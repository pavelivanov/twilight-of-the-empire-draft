import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { DraftConfig, PublicDraft } from "@imperium/domain";

import { api, setDemoIdentity } from "@/lib/api";
import { cn } from "@/lib/utils";

const initialPlayers = ["", "", "", "", "", ""];

export function SetupScreen({
  onCreated,
  onCancel,
}: {
  onCreated: (draft: PublicDraft) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("Friday Night Imperium");
  const [players, setPlayers] = useState(initialPlayers);
  const [playerCount, setPlayerCount] = useState(6);
  const [factionCount, setFactionCount] = useState(12);
  const [pokEnabled, setPokEnabled] = useState(true);
  const [bansEnabled, setBansEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const activePlayers = players.slice(0, playerCount);
  const minimumFactionCount = bansEnabled ? playerCount * 2 : playerCount;

  function ensureFactionCount(nextMinimum: number) {
    setFactionCount((current) => {
      if (current >= nextMinimum) return current;
      return [9, 12, 15, 18].find((count) => count >= nextMinimum) ?? 18;
    });
  }

  const validationError = (() => {
    if (title.trim().length < 3) return "Give the table a name.";
    if (activePlayers.some((player) => !player.trim())) return `Name all ${playerCount} players.`;
    if (new Set(activePlayers.map((player) => player.trim().toLocaleLowerCase())).size !== playerCount) {
      return "Player names must be unique.";
    }
    return null;
  })();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSubmitting(true);
    try {
      setDemoIdentity({ id: "creator", name: activePlayers[0]!.trim() });
      const config: DraftConfig = {
        playerCount,
        sliceCount: 9,
        factionCount,
        bansPerPlayer: bansEnabled ? 1 : 0,
        sets: pokEnabled ? ["Base Game", "Prophecy of Kings"] : ["Base Game"],
        balance: {
          minimumLegendaryPlanets: pokEnabled ? 2 : 0,
          minimumOptimalInfluence: 4,
          minimumOptimalResources: 2.5,
          minimumOptimalTotal: 9,
          maximumOptimalTotal: 13,
          maximumWormholesPerSlice: 1,
          minimumPairedAlphaWormholes: 1,
          minimumPairedBetaWormholes: 0,
          attemptBudget: 5_000,
        },
      };
      const draft = await api.createDraft({
        title: title.trim(),
        players: activePlayers.map((displayName) => ({ displayName: displayName.trim() })),
        config,
      });
      const creatorPlayer = draft.players.find((player) => player.isCurrentUser);
      if (creatorPlayer) localStorage.setItem("imperium-demo-creator-player", creatorPlayer.id);
      toast.success("Pool generated · 9 slices");
      onCreated(draft);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the draft");
    } finally {
      setSubmitting(false);
    }
  }

  const factionPool = pokEnabled ? 24 : 17;

  return (
    <main className="room-shell">
      <header className="room-topbar">
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: "none",
            border: "none",
            padding: "0 8px 0 0",
            font: "400 13px/1 var(--font-sans)",
            color: "var(--dim)",
            height: 32,
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          ‹ Drafts
        </button>
        <div className="mono-label" style={{ color: "#e6e3da", letterSpacing: "0.13em", fontSize: 11 }}>
          NEW DRAFT
        </div>
        <div style={{ width: 44 }} />
      </header>

      <form className="setup-scroll" onSubmit={submit}>
        <h1 className="serif-title" style={{ margin: "0 0 16px" }}>
          Table setup
        </h1>

        <div className="field-card">
          <div className="mono-label" style={{ marginBottom: 8, fontSize: 9.5, letterSpacing: "0.14em" }}>
            TABLE NAME
          </div>
          <input
            className="naked-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Friday Night Imperium"
            autoComplete="off"
          />
        </div>

        <div className="field-card">
          <div className="field-card-head">
            <div className="mono-label" style={{ fontSize: 9.5, letterSpacing: "0.14em" }}>
              PLAYERS
            </div>
            <em>9 slices generated</em>
          </div>
          <div className="count-grid">
            {[3, 4, 5, 6].map((count) => (
              <button
                key={count}
                type="button"
                className={cn("count-chip", count === playerCount && "is-active")}
                onClick={() => {
                  setPlayerCount(count);
                  if (bansEnabled) ensureFactionCount(count * 2);
                }}
              >
                {count}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            {activePlayers.map((player, index) => (
              <div key={index} className="player-name-row">
                <span>{index + 1}</span>
                <input
                  className="naked-input is-sm"
                  style={{ borderBottom: "none", padding: 0 }}
                  value={player}
                  onChange={(event) =>
                    setPlayers((current) =>
                      current.map((value, playerIndex) => (playerIndex === index ? event.target.value : value)),
                    )
                  }
                  placeholder={index === 0 ? "Your name" : "Player name"}
                  autoComplete="off"
                />
              </div>
            ))}
          </div>
          <div style={{ font: "400 11.5px/1.4 var(--font-sans)", color: "var(--muted-foreground)", marginTop: 6 }}>
            Player one is you. Everyone claims their seat from the invite link.
          </div>
        </div>

        <div className="field-card" style={{ paddingBottom: 4 }}>
          <div className="field-card-head">
            <div className="mono-label" style={{ fontSize: 9.5, letterSpacing: "0.14em" }}>
              EXPANSIONS
            </div>
            <em>{factionPool} factions in pool</em>
          </div>
          <div>
            <div className="check-row is-on is-locked">
              <span className="check-box">✓</span>
              <span className="check-row-main">
                <strong>Base Game</strong>
                <small>The original 17 factions and system tiles.</small>
              </span>
              <em>ALWAYS ON</em>
            </div>
            <button
              type="button"
              className={cn("check-row", pokEnabled && "is-on")}
              onClick={() => setPokEnabled((value) => !value)}
            >
              <span className="check-box">{pokEnabled ? "✓" : ""}</span>
              <span className="check-row-main">
                <strong>Prophecy of Kings</strong>
                <small>Official expansion — 7 factions, legendary planets, new anomalies.</small>
              </span>
            </button>
          </div>
        </div>

        <div className="field-card">
          <div className="field-card-head">
            <div className="mono-label" style={{ fontSize: 9.5, letterSpacing: "0.14em" }}>
              FACTION POOL
            </div>
            <em>{factionCount} drafted from {factionPool}</em>
          </div>
          <div className="count-grid">
            {[9, 12, 15, 18].map((count) => {
              const tooSmall = count < minimumFactionCount;
              return (
                <button
                  key={count}
                  type="button"
                  className={cn("count-chip", count === factionCount && "is-active")}
                  style={tooSmall ? { opacity: 0.35 } : undefined}
                  onClick={() => {
                    if (tooSmall) {
                      toast.info(`With bans on, ${playerCount} players need at least ${minimumFactionCount} factions.`);
                      return;
                    }
                    setFactionCount(count);
                  }}
                >
                  {count}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field-card" style={{ padding: 0, overflow: "hidden" }}>
          <button
            type="button"
            onClick={() => {
              setBansEnabled((value) => {
                const next = !value;
                if (next) ensureFactionCount(playerCount * 2);
                return next;
              });
            }}
            style={{
              width: "100%",
              textAlign: "left",
              background: "none",
              border: "none",
              padding: "13px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <div style={{ font: "500 14px/1.2 var(--font-sans)", color: "var(--foreground)", marginBottom: 3 }}>
                Ban phase
              </div>
              <div style={{ font: "400 11.5px/1.35 var(--font-sans)", color: "var(--muted-foreground)" }}>
                Each player bans one faction before drafting
              </div>
            </div>
            <div
              style={{
                font: "500 12px/1 var(--font-mono)",
                color: bansEnabled ? "var(--lime)" : "var(--faint)",
                whiteSpace: "nowrap",
              }}
            >
              {bansEnabled ? "On · 1 each" : "Off"} ›
            </div>
          </button>
          {[
            { label: "Draft order", hint: "Snake, three rounds — slice, faction and seat each", value: "Snake" },
            { label: "Slices", hint: "Nine balanced slices for every table size", value: "9 · Milty" },
            { label: "Map", hint: "Standard field with Mecatol Rex at the centre", value: "Standard" },
          ].map((row) => (
            <div
              key={row.label}
              style={{
                padding: "13px 14px",
                borderTop: "1px solid var(--line-2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div style={{ font: "500 14px/1.2 var(--font-sans)", color: "var(--foreground)", marginBottom: 3 }}>
                  {row.label}
                </div>
                <div style={{ font: "400 11.5px/1.35 var(--font-sans)", color: "var(--muted-foreground)" }}>
                  {row.hint}
                </div>
              </div>
              <div style={{ font: "500 12px/1 var(--font-mono)", color: "var(--lime)", whiteSpace: "nowrap" }}>
                {row.value}
              </div>
            </div>
          ))}
        </div>

        <div className="hint-callout" style={{ margin: "10px 0 18px" }}>
          <i aria-hidden="true" />
          <p>
            Slices are balanced on optimal resources and influence. You can regenerate the pool until the draft
            starts.
          </p>
        </div>

        <button type="submit" className="btn-accent is-block" disabled={submitting}>
          {submitting ? "Balancing…" : "Generate pool"}
        </button>
        <div style={{ height: 20 }} />
      </form>
    </main>
  );
}
