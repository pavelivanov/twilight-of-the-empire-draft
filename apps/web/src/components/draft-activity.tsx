import { Sparkles } from "lucide-react";
import type { PublicDraft } from "@imperium/domain";

export function DraftActivity({ draft }: { draft: PublicDraft }) {
  return (
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
  );
}
