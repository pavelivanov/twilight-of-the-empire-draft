import type { PublicOption, Slice } from "@imperium/domain";
import { Atom, Dna, Gauge, Shield } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const techIcon = {
  biotic: Dna,
  warfare: Shield,
  propulsion: Gauge,
  cybernetic: Atom,
} as const;

export function TileImage({
  tileId,
  className,
  onLoad,
}: {
  tileId: number;
  className?: string;
  onLoad?: () => void;
}) {
  if (!tileId) return <span className={cn("tile-placeholder", className)} />;
  return (
    <img
      className={className}
      src={`/assets/tiles/ST_${tileId}.png`}
      alt={`System tile ${tileId}`}
      draggable={false}
      onLoad={onLoad}
    />
  );
}

export function SliceBoard({ tiles, className }: { tiles: number[]; className?: string }) {
  return (
    <div className={cn("slice-board", className)} aria-label={`Slice systems ${tiles.join(", ")}`}>
      {tiles.map((tile, index) => (
        <TileImage key={tile} tileId={tile} className={`slice-system slice-system-${index}`} />
      ))}
    </div>
  );
}

export function SliceMetrics({ slice }: { slice: Slice }) {
  return (
    <div className="slice-metrics">
      <span>
        Optimal
        <strong>{slice.optimalResources}R</strong>
        <strong>{slice.optimalInfluence}I</strong>
      </span>
      <span>
        Raw
        <strong>{slice.resources}R</strong>
        <strong>{slice.influence}I</strong>
      </span>
      <div className="flex flex-wrap gap-1.5">
        {slice.specialties.map((tech, index) => {
          const Icon = techIcon[tech];
          return (
            <Badge key={`${tech}-${index}`} variant="outline" className="border-border/60 bg-background/40">
              <Icon aria-hidden="true" data-icon="inline-start" />
              {tech}
            </Badge>
          );
        })}
        {slice.wormholes.map((wormhole) => (
          <Badge key={wormhole} variant="secondary">
            {wormhole === "alpha" ? "α" : "β"} wormhole
          </Badge>
        ))}
        {slice.legendaryPlanets.map((legendary) => (
          <Badge key={legendary} className="bg-primary/15 text-primary">
            ◆ {legendary}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function SliceCard({
  option,
  selected,
  disabled,
  onSelect,
}: {
  option: PublicOption;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  const slice = option.payload as unknown as Slice;
  return (
    <button
      type="button"
      className={cn("slice-card", selected && "is-selected", disabled && "is-disabled")}
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
    >
      <div className="flex items-start justify-between gap-4 text-left">
        <div>
          <span className="eyebrow">Slice {option.sortOrder + 1}</span>
          <h3>{option.label}</h3>
        </div>
        <Badge variant={option.selectedByPlayerId ? "secondary" : "outline"}>
          {option.selectedByPlayerId ? "Taken" : "Available"}
        </Badge>
      </div>
      <SliceBoard tiles={slice.tiles} />
      <SliceMetrics slice={slice} />
    </button>
  );
}
