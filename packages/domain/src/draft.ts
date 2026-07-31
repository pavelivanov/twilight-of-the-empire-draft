import type { OptionKind } from "./types.js";

export function createTurnOrder(playerIds: readonly string[]): string[] {
  if (playerIds.length < 2) throw new Error("At least two players are required");
  return [...playerIds, ...[...playerIds].reverse(), ...playerIds];
}

export function activePlayerId(playerIds: readonly string[], turnCursor: number): string | null {
  return createTurnOrder(playerIds)[turnCursor] ?? null;
}

export function lowerOptionKind(kind: OptionKind): Lowercase<OptionKind> {
  return kind.toLowerCase() as Lowercase<OptionKind>;
}
