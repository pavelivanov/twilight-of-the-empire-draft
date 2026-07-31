import { useLayoutEffect, useRef } from "react";
import { assembleMap, type Faction, type PublicDraft, type PublicOption, type Slice } from "@imperium/domain";
import { Crosshair } from "lucide-react";

import { TileImage } from "@/components/slice-board";
import { Button } from "@/components/ui/button";

const BOARD_WIDTH = 1_120;
const BOARD_HEIGHT = 1_240;
const TILE_WIDTH = 200;
const TILE_HEIGHT = 174;

function selectedOption(
  draft: PublicDraft,
  playerId: string,
  kind: "FACTION" | "SLICE" | "POSITION",
): PublicOption | undefined {
  return draft.options.find((option) => option.kind === kind && option.selectedByPlayerId === playerId);
}

export function MapBoard({ draft }: { draft: PublicDraft }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const centerTileRef = useRef<HTMLDivElement>(null);
  const mapPlayers = draft.players.map((player) => {
    const slice = selectedOption(draft, player.id, "SLICE");
    return {
      id: player.id,
      factionId: selectedOption(draft, player.id, "FACTION")?.key,
      positionId: selectedOption(draft, player.id, "POSITION")?.key,
      sliceTiles: (slice?.payload as unknown as Slice | undefined)?.tiles,
    };
  });
  const players = new Map(draft.players.map((player) => [player.id, player]));
  const tiles = assembleMap(mapPlayers);
  const centerMap = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      left: (viewport.scrollWidth - viewport.clientWidth) / 2,
      top: (viewport.scrollHeight - viewport.clientHeight) / 2,
    });
  };

  useLayoutEffect(() => {
    centerMap();
    const frame = requestAnimationFrame(centerMap);
    const timeout = window.setTimeout(centerMap, 250);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, []);

  return (
    <section className="map-page" aria-label="Assembled game map">
      <div className="map-toolbar">
        <div>
          <span className="eyebrow">Final field preview</span>
          <strong>{draft.status === "COMPLETE" ? "Map locked" : "Live assembly"}</strong>
        </div>
        <div className="map-toolbar-actions">
          <span>Drag in any direction</span>
          <Button type="button" size="sm" variant="outline" onClick={centerMap}>
            <Crosshair data-icon="inline-start" aria-hidden="true" />
            Center
          </Button>
        </div>
      </div>
      <div ref={viewportRef} className="map-viewport">
        <div className="galaxy-board" style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}>
          {tiles.map((tile, index) => {
            const [q, r] = tile.coordinate;
            const player = tile.playerId ? players.get(tile.playerId) : undefined;
            const faction = player
              ? (selectedOption(draft, player.id, "FACTION")?.payload as unknown as Faction | undefined)
              : undefined;
            const left = BOARD_WIDTH / 2 + q * TILE_WIDTH * 0.75;
            const top = BOARD_HEIGHT / 2 + (r + q / 2) * TILE_HEIGHT;
            return (
              <div
                key={`${q},${r}`}
                ref={tile.kind === "center" ? centerTileRef : undefined}
                tabIndex={tile.kind === "center" ? -1 : undefined}
                autoFocus={tile.kind === "center"}
                className={`galaxy-tile is-${tile.kind}`}
                style={{
                  left,
                  top,
                  width: TILE_WIDTH,
                  height: TILE_HEIGHT,
                  "--player-color": player?.color ?? "#d7e87a",
                  "--tile-index": index,
                } as React.CSSProperties}
              >
                {tile.kind === "home" && !tile.tileId ? (
                  <span className="home-system-placeholder">
                    <small>Home system</small>
                    <strong>{faction?.shortName ?? "Unassigned"}</strong>
                  </span>
                ) : (
                  <TileImage tileId={tile.tileId} onLoad={tile.kind === "center" ? centerMap : undefined} />
                )}
                {tile.kind === "home" && player && (
                  <span className="map-player-label">
                    <i style={{ background: player.color }}>{player.displayName.slice(0, 1)}</i>
                    {player.displayName}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
