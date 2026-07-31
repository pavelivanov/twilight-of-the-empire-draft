import { useState, type FormEvent } from "react";
import { Check, ChevronRight, Dices, Users } from "lucide-react";
import { toast } from "sonner";
import type { DraftConfig, PublicDraft } from "@imperium/domain";

import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, setDemoIdentity } from "@/lib/api";

const initialPlayers = ["", "", "", "", "", ""];

export function SetupScreen({
  onCreated,
  onCancel,
}: {
  onCreated: (draft: PublicDraft) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("Friday Night Imperium");
  const [players, setPlayers] = useState(initialPlayers);
  const [playerCount, setPlayerCount] = useState(6);
  const [factionCount, setFactionCount] = useState("12");
  const [submitting, setSubmitting] = useState(false);
  const activePlayers = players.slice(0, playerCount);
  const validationError = (() => {
    if (title.trim().length < 3) return "Give the draft a title.";
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
    if (step === 1) {
      setStep(2);
      return;
    }
    setSubmitting(true);
    try {
      setDemoIdentity({ id: "creator", name: activePlayers[0]! });
      const config: DraftConfig = {
        playerCount,
        sliceCount: 9,
        factionCount: Number(factionCount),
        sets: ["Base Game", "Prophecy of Kings"],
        balance: {
          minimumLegendaryPlanets: 2,
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
        title,
        players: activePlayers.map((displayName) => ({ displayName })),
        config,
      });
      const creatorPlayer = draft.players.find((player) => player.isCurrentUser);
      if (creatorPlayer) localStorage.setItem("imperium-demo-creator-player", creatorPlayer.id);
      toast.success("Balanced pool generated");
      onCreated(draft);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the draft");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="setup-shell">
      <header className="setup-header">
        <Brand />
        <div className="setup-header-actions">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            My drafts
          </Button>
          <span className="step-indicator">0{step} / 02</span>
        </div>
      </header>
      <form className="setup-layout" onSubmit={submit}>
        <section className="setup-intro">
          <span className="eyebrow">New {playerCount}-player draft</span>
          <h1>
            Assemble the table.
            <br />
            <em>Let the galaxy decide.</em>
          </h1>
          <p>
            Choose 3–6 players, name the table, and generate a reproducible balanced Milty pool.
            Everyone claims their Telegram identity before the first pick.
          </p>
          <div className="setup-steps" aria-label="Setup progress">
            <span className={step >= 1 ? "is-active" : ""}>
              <i>{step > 1 ? <Check aria-hidden="true" /> : "1"}</i>
              Table
            </span>
            <span className={step >= 2 ? "is-active" : ""}>
              <i>2</i>
              Rules
            </span>
          </div>
        </section>

        <div className="setup-form-panel">
          {step === 1 ? (
            <FieldGroup>
              <Field>
                <FieldLabel>Table size</FieldLabel>
                <ToggleGroup
                  value={[String(playerCount)]}
                  onValueChange={(value) => value[0] && setPlayerCount(Number(value[0]))}
                  variant="outline"
                  spacing={0}
                  className="w-full"
                  aria-label="Number of players"
                >
                  {[3, 4, 5, 6].map((count) => (
                    <ToggleGroupItem key={count} value={String(count)} className="h-10 flex-1">
                      {count}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <FieldDescription>You can remove seats in the lobby later, down to three players.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="draft-title">Draft name</FieldLabel>
                <Input
                  id="draft-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Friday Night Imperium"
                  autoComplete="off"
                />
                <FieldDescription>This appears in the group bot messages.</FieldDescription>
              </Field>
              <FieldSet>
                <FieldLegend variant="label">Players</FieldLegend>
                <FieldDescription>Player one is you. Draft order is randomized on creation.</FieldDescription>
                <div className="player-input-grid">
                  {activePlayers.map((player, index) => (
                    <Field key={index}>
                      <FieldLabel htmlFor={`player-${index}`}>Player {index + 1}</FieldLabel>
                      <div className="player-input">
                        <span>{index + 1}</span>
                        <Input
                          id={`player-${index}`}
                          value={player}
                          onChange={(event) =>
                            setPlayers((current) =>
                              current.map((value, playerIndex) =>
                                playerIndex === index ? event.target.value : value,
                              ),
                            )
                          }
                          placeholder={index === 0 ? "Your name" : "Player name"}
                          autoComplete="off"
                        />
                      </div>
                    </Field>
                  ))}
                </div>
              </FieldSet>
              {validationError && activePlayers.every(Boolean) && <FieldError>{validationError}</FieldError>}
            </FieldGroup>
          ) : (
            <FieldGroup>
              <FieldSet>
                <FieldLegend>Galaxy catalog</FieldLegend>
                <FieldDescription>
                  Base Game systems are always included. Prophecy of Kings adds factions and legendary planets.
                </FieldDescription>
                <FieldLabel className="choice-field">
                  <Checkbox
                    checked
                    disabled
                  />
                  <span>
                    <strong>Prophecy of Kings</strong>
                    <small>Required in v1 · legendary systems and seven additional factions</small>
                  </span>
                </FieldLabel>
              </FieldSet>
              <Field>
                <FieldLabel>Faction pool</FieldLabel>
                <ToggleGroup
                  value={[factionCount]}
                  onValueChange={(value) => value[0] && setFactionCount(value[0])}
                  variant="outline"
                  spacing={0}
                  className="w-full"
                >
                  {["9", "12", "15", "18"].map((count) => (
                    <ToggleGroupItem key={count} value={count} className="h-10 flex-1">
                      {count}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <FieldDescription>
                  More factions create more strategic choice; slices stay at nine for every table size.
                </FieldDescription>
              </Field>
              <div className="balance-brief">
                <div>
                  <Dices aria-hidden="true" />
                  <span>
                    <strong>Seeded & reproducible</strong>
                    Every generated pool can be audited or regenerated.
                  </span>
                </div>
                <div>
                  <Users aria-hidden="true" />
                  <span>
                    <strong>Tier-balanced slices</strong>
                    One low, one mid, one high blue system plus two red systems.
                  </span>
                </div>
              </div>
            </FieldGroup>
          )}

          <div className="setup-actions">
            {step === 2 && (
              <Button type="button" variant="ghost" size="lg" onClick={() => setStep(1)}>
                Back
              </Button>
            )}
            <Button type="submit" size="lg" disabled={submitting} className="ml-auto min-w-40">
              {step === 1 ? "Configure rules" : submitting ? "Balancing…" : "Generate draft"}
              <ChevronRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </form>
    </main>
  );
}
