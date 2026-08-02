import { useMemo, useState } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { mapSeatLayouts, type PublicDraft, type Slice } from "@imperium/domain";

import { selectedOptionOf } from "@/components/room-parts";
import { tileArt } from "@/lib/ti4-meta";
import { cn } from "@/lib/utils";

const TILE_WIDTH = 50;
const TILE_HEIGHT = 43.3;

const seatLayoutIndexes: Readonly<Record<number, readonly number[]>> = {
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};

type Cell = { q: number; r: number; ring: number; left: number; top: number };

function gridCells(): Cell[] {
  const cells: Cell[] = [];
  for (let q = -3; q <= 3; q++) {
    for (let r = -3; r <= 3; r++) {
      const s = -q - r;
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
      if (ring > 3) continue;
      cells.push({
        q,
        r,
        ring,
        left: q * TILE_WIDTH * 0.75 + TILE_WIDTH * 0.75 * 3,
        top: (r + q / 2) * TILE_HEIGHT + TILE_HEIGHT * 3,
      });
    }
  }
  return cells;
}

const BOARD_WIDTH = TILE_WIDTH * 0.75 * 6 + TILE_WIDTH;
const BOARD_HEIGHT = TILE_HEIGHT * 7;

type WedgeTile = {
  color?: string;
  tileId?: number;
  home?: boolean;
  seatNumber?: number;
  playerName?: string;
};

export type MapModel = {
  wedgeByCoordinate: Map<string, WedgeTile>;
  placedCount: number;
  legend: Array<{
    id: string;
    n: string;
    color?: string;
    player: string;
    slice: string;
    open: boolean;
  }>;
};

export function useMapModel(draft: PublicDraft): MapModel {
  return useMemo(() => {
    const byCoordinate = new Map<string, WedgeTile>();
    const layoutIndexes =
      seatLayoutIndexes[draft.players.length] ?? seatLayoutIndexes[6]!;
    const seatOptions = draft.options
      .filter((option) => option.kind === "POSITION")
      .sort((left, right) => left.sortOrder - right.sortOrder);

    let placed = 0;
    const legendRows = seatOptions.map((option, seatIndex) => {
      const owner = option.selectedByPlayerId
        ? draft.players.find((player) => player.id === option.selectedByPlayerId)
        : undefined;
      const sliceOption = owner ? selectedOptionOf(draft, owner.id, "SLICE") : undefined;
      const slice = sliceOption?.payload as unknown as Slice | undefined;
      const layout = mapSeatLayouts[layoutIndexes[seatIndex] ?? seatIndex];
      const isPlaced = Boolean(owner && slice);
      if (isPlaced) placed += 1;
      if (layout) {
        byCoordinate.set(`${layout.home[0]},${layout.home[1]}`, {
          color: isPlaced ? owner!.color : undefined,
          home: true,
          seatNumber: option.sortOrder + 1,
          playerName: owner?.displayName,
        });
        layout.systems.forEach(([q, r], index) => {
          byCoordinate.set(`${q},${r}`, {
            color: isPlaced ? owner!.color : undefined,
            tileId: isPlaced ? slice!.tiles[index] : undefined,
          });
        });
      }
      return {
        id: option.id,
        n: `#${option.sortOrder + 1}`,
        color: isPlaced ? owner!.color : undefined,
        player: owner?.displayName ?? "Open seat",
        slice: sliceOption ? sliceOption.label : owner ? "slice pending" : "—",
        open: !owner,
      };
    });
    return { wedgeByCoordinate: byCoordinate, placedCount: placed, legend: legendRows };
  }, [draft]);
}

export function MapStage({
  model,
  zoom,
  className,
}: {
  model: MapModel;
  zoom: number;
  className?: string;
}) {
  const cells = useMemo(gridCells, []);
  return (
    <div className={cn("map-stage", className)}>
      <div className="map-scaler" style={{ "--map-zoom": zoom } as React.CSSProperties}>
        <div className="map-board" style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}>
          {cells.map((cell) => {
            const isCenter = cell.ring === 0;
            const wedge = model.wedgeByCoordinate.get(`${cell.q},${cell.r}`);
            const hasArt = isCenter || Boolean(wedge?.tileId);
            const fill = isCenter ? "#4a4535" : (wedge?.color ?? "#1a2028");
            return (
              <span
                key={`${cell.q},${cell.r}`}
                className="map-hex"
                style={{ left: cell.left, top: cell.top, width: TILE_WIDTH, height: TILE_HEIGHT }}
              >
                <i className="map-hex-fill" style={{ background: fill }} />
                <span className="map-hex-inner">
                  {hasArt && <img src={tileArt(isCenter ? 18 : wedge!.tileId!)} alt="" draggable={false} />}
                  {wedge?.home && (
                    <>
                      <span
                        className="map-hex-label"
                        style={wedge.color ? { color: wedge.color } : undefined}
                      >
                        {wedge.playerName ?? `SEAT ${wedge.seatNumber}`}
                      </span>
                      <span className="map-hex-val" style={wedge.color ? { color: wedge.color } : undefined}>
                        {wedge.playerName ? `#${wedge.seatNumber}` : "—"}
                      </span>
                    </>
                  )}
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function MapBoard({ draft }: { draft: PublicDraft }) {
  const [zoom, setZoom] = useState(1.2);
  const isComplete = draft.status === "COMPLETE" || draft.turnCursor >= draft.totalTurns;
  const model = useMapModel(draft);
  const { placedCount, legend } = model;

  return (
    <div>
      <div className="map-toolbar">
        <div>
          <div className="map-toolbar-kicker">{isComplete ? "FINAL MAP" : "LIVE ASSEMBLY"}</div>
          <div className="map-toolbar-sub">
            {isComplete
              ? `Draft complete · ${placedCount} players seated`
              : `${placedCount} of ${draft.players.length} wedges placed`}
          </div>
        </div>
        <div className="map-toolbar-actions">
          <button
            type="button"
            className="icon-btn is-lg"
            aria-label="Zoom out"
            onClick={() => setZoom((value) => Math.max(0.8, Math.round((value - 0.2) * 10) / 10))}
          >
            <MinusIcon aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn is-lg"
            aria-label="Zoom in"
            onClick={() => setZoom((value) => Math.min(2, Math.round((value + 0.2) * 10) / 10))}
          >
            <PlusIcon aria-hidden="true" />
          </button>
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <MapStage model={model} zoom={zoom} />
        <button type="button" className="map-center-btn" onClick={() => setZoom(1.2)}>
          CENTER
        </button>
      </div>

      <div className="map-legend">
        <div className="mono-label" style={{ marginBottom: 10 }}>
          {isComplete
            ? `FINAL SEATING · ${placedCount} PLAYERS`
            : `SEATING · ${placedCount}/${draft.players.length} PLACED`}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {legend.map((row) => (
            <div key={row.id} className={cn("map-legend-row", row.open && "is-open")}>
              <i style={row.color ? { background: row.color } : undefined} />
              <small>{row.n}</small>
              <strong>{row.player}</strong>
              <em>{row.slice}</em>
            </div>
          ))}
        </div>
        {!isComplete && (
          <div className="hint-callout" style={{ marginTop: 14 }}>
            <i aria-hidden="true" />
            <p>Unclaimed wedges stay dim until their slice and seat are both taken.</p>
          </div>
        )}
      </div>
    </div>
  );
}
