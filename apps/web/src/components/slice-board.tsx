import type { PublicOption, Slice } from "@imperium/domain";

import {
  clusterLayout,
  sliceDetails,
  techIcon,
  tileArt,
  traitIcon,
  wormholeIcon,
  type SliceDetails,
} from "@/lib/ti4-meta";
import { cn } from "@/lib/utils";

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
      src={tileArt(tileId)}
      alt={`System tile ${tileId}`}
      draggable={false}
      onLoad={onLoad}
    />
  );
}

export function SliceCluster({
  tiles,
  size = 46,
  fluid = false,
}: {
  tiles: number[];
  size?: number;
  fluid?: boolean;
}) {
  const layout = clusterLayout(fluid ? 1 : size);
  const tileStyle = (index: number): React.CSSProperties => {
    const position = layout.positions[index];
    if (!fluid) {
      return {
        left: position?.[0],
        top: position?.[1],
        width: layout.tileWidth,
        height: layout.tileHeight,
      };
    }
    return {
      left: `${((position?.[0] ?? 0) / layout.width) * 100}%`,
      top: `${((position?.[1] ?? 0) / layout.height) * 100}%`,
      width: `${(layout.tileWidth / layout.width) * 100}%`,
      height: `${(layout.tileHeight / layout.height) * 100}%`,
    };
  };
  return (
    <div
      className={cn("slice-cluster", fluid && "is-fluid")}
      style={
        fluid
          ? { width: "100%", aspectRatio: `${layout.width} / ${layout.height}` }
          : { width: layout.width, height: layout.height }
      }
      aria-label={`Slice systems ${tiles.join(", ")}`}
    >
      <span
        className="home-hex"
        style={{
          ...tileStyle(0),
          fontSize: fluid ? "clamp(10px, 4vw, 18px)" : Math.max(7, Math.round(size * 0.16)),
        }}
      >
        HOME
      </span>
      {tiles.map((tileId, index) => (
        <img
          key={`${tileId}-${index}`}
          src={tileArt(tileId)}
          alt={`System ${tileId}`}
          draggable={false}
          style={tileStyle(index + 1)}
        />
      ))}
    </div>
  );
}

export function MarkChips({ details, large }: { details: SliceDetails; large?: boolean }) {
  return (
    <>
      {details.specialties.map((specialty) => (
        <span key={specialty} className="mark-chip">
          <img src={techIcon(specialty)} alt="" style={large ? { width: 15, height: 15 } : undefined} />
          {specialty.toUpperCase()}
        </span>
      ))}
      {details.wormholes.map((wormhole) => (
        <span key={wormhole} className="mark-chip">
          <img src={wormholeIcon(wormhole)} alt="" style={large ? { width: 15, height: 15 } : undefined} />
          WORMHOLE
        </span>
      ))}
      {details.legendaryPlanets.length > 0 && <span className="mark-chip is-gold">LEGENDARY</span>}
      {details.anomalies.map((anomaly) => (
        <span key={anomaly} className="mark-chip">
          {anomaly}
        </span>
      ))}
    </>
  );
}

export function SliceCard({
  option,
  takenBy,
  selected,
  onSelect,
}: {
  option: PublicOption;
  takenBy?: string;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const slice = option.payload as unknown as Slice;
  const details = sliceDetails(slice);
  const taken = Boolean(option.selectedByPlayerId);
  return (
    <button
      type="button"
      className={cn("slice-card", taken && "is-taken", selected && "is-selected")}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="slice-card-head">
        <span className="slice-card-name">
          <small>S{option.sortOrder + 1}</small>
          <strong>{option.label}</strong>
        </span>
        <span className={cn("state-tag", taken ? "state-taken" : "state-available")}>
          {taken ? (takenBy ?? "Taken").toUpperCase() : "AVAILABLE"}
        </span>
      </span>

      <span className="slice-card-body">
        <SliceCluster tiles={slice.tiles} size={46} />

        <span className="slice-facts">
          <span className="opt-row">
            <small>OPTIMAL</small>
            <span className="pair">
              <i className="hexval is-res">{slice.optimalResources}</i>
              <i className="hexval is-inf">{slice.optimalInfluence}</i>
            </span>
            <em>
              tot {slice.resources} / {slice.influence}
            </em>
          </span>

          <span className="planet-rows">
            {details.planets.map((planet) => (
              <span key={planet.name} className="planet-row">
                <i className="hexval is-res is-sm">{planet.resources}</i>
                <i className="hexval is-inf is-sm">{planet.influence}</i>
                <img className="trait" src={traitIcon(planet.trait)} alt={planet.trait} />
                <span>{planet.name}</span>
                {planet.specialty && <img className="tech" src={techIcon(planet.specialty)} alt={planet.specialty} />}
                {planet.legendary && <em className="lgd-chip">LGD</em>}
              </span>
            ))}
          </span>

          <span className="mark-chips">
            <MarkChips details={details} />
          </span>
        </span>
      </span>
    </button>
  );
}
