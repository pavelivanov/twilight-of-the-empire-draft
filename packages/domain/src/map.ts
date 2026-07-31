import { homeTileByFaction } from "./catalog.js";

export type MapCoordinate = readonly [q: number, r: number];

export const mapSeatLayouts: ReadonlyArray<{
  home: MapCoordinate;
  systems: readonly MapCoordinate[];
}> = [
  { home: [0, -3], systems: [[1, -3], [0, -2], [-1, -2], [1, -2], [0, -1]] },
  { home: [3, -3], systems: [[3, -2], [2, -2], [2, -3], [2, -1], [1, -1]] },
  { home: [3, 0], systems: [[2, 1], [2, 0], [3, -1], [1, 1], [1, 0]] },
  { home: [0, 3], systems: [[-1, 3], [0, 2], [1, 2], [-1, 2], [0, 1]] },
  { home: [-3, 3], systems: [[-3, 2], [-2, 2], [-2, 3], [-2, 1], [-1, 1]] },
  { home: [-3, 0], systems: [[-2, -1], [-2, 0], [-3, 1], [-1, -1], [-1, 0]] },
] as const;

export const mapTtsCoordinates: readonly MapCoordinate[] = [
  [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0],
  [0, -2], [1, -2], [2, -2], [2, -1], [2, 0], [1, 1],
  [0, 2], [-1, 2], [-2, 2], [-2, 1], [-2, 0], [-1, -1],
  [0, -3], [1, -3], [2, -3], [3, -3], [3, -2], [3, -1],
  [3, 0], [2, 1], [1, 2], [0, 3], [-1, 3], [-2, 3],
  [-3, 3], [-3, 2], [-3, 1], [-3, 0], [-2, -1], [-1, -2],
] as const;

export type MapPlayer = {
  id: string;
  factionId?: string;
  sliceTiles?: number[];
  positionId?: string;
};

export type MapTile = {
  coordinate: MapCoordinate;
  tileId: number;
  kind: "center" | "home" | "system";
  playerId?: string;
};

const key = ([q, r]: MapCoordinate): string => `${q},${r}`;

const seatLayoutIndexes: Readonly<Record<number, readonly number[]>> = {
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};

export function assembleMap(players: readonly MapPlayer[]): MapTile[] {
  const positionOrder = new Map(["speaker", "second", "third", "fourth", "fifth", "sixth"].map((id, i) => [id, i]));
  const bySeat = [...players].sort(
    (left, right) =>
      (positionOrder.get(left.positionId ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (positionOrder.get(right.positionId ?? "") ?? Number.MAX_SAFE_INTEGER),
  );
  const tiles = new Map<string, MapTile>([
    [key([0, 0]), { coordinate: [0, 0], tileId: 18, kind: "center" }],
  ]);
  const layoutIndexes = seatLayoutIndexes[bySeat.length] ?? seatLayoutIndexes[6]!;
  bySeat.forEach((player, seatIndex) => {
    const layout = mapSeatLayouts[layoutIndexes[seatIndex] ?? seatIndex];
    if (!layout) return;
    tiles.set(key(layout.home), {
      coordinate: layout.home,
      tileId: homeTileByFaction[player.factionId ?? ""] ?? 0,
      kind: "home",
      playerId: player.id,
    });
    layout.systems.forEach((coordinate, index) => {
      tiles.set(key(coordinate), {
        coordinate,
        tileId: player.sliceTiles?.[index] ?? 0,
        kind: "system",
        playerId: player.id,
      });
    });
  });
  return [...tiles.values()];
}

export function createTtsMapString(players: readonly MapPlayer[]): string {
  const tiles = new Map(assembleMap(players).map((tile) => [key(tile.coordinate), tile]));
  return mapTtsCoordinates.map((coordinate) => tiles.get(key(coordinate))?.tileId ?? 0).join(" ");
}
