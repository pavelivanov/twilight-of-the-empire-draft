import { factionCatalog, systemCatalog } from "./catalog.js";
import { seededRandom, shuffle } from "./random.js";
import {
  balanceConfigSchema,
  draftConfigSchema,
  type BalanceConfig,
  type DraftConfig,
  type Faction,
  type Slice,
  type SystemMetrics,
  type SystemTile,
} from "./types.js";

export const GENERATOR_VERSION = "milty-v1";

const sliceNames = [
  "Acheron Line",
  "Ashen Crown",
  "Citadel Drift",
  "Cobalt Reach",
  "Hope's Verge",
  "Luminous March",
  "Mirage Run",
  "Primor Expanse",
  "Verdant Gate",
] as const;

export function metricsForSystems(systems: readonly SystemTile[]): SystemMetrics {
  const metrics: SystemMetrics = {
    resources: 0,
    influence: 0,
    optimalResources: 0,
    optimalInfluence: 0,
    optimalTotal: 0,
    planetCount: 0,
    specialties: [],
    wormholes: [],
    legendaryPlanets: [],
    anomalies: [],
  };

  for (const system of systems) {
    metrics.wormholes.push(...system.wormholes);
    metrics.anomalies.push(...system.anomalies);
    for (const planet of system.planets) {
      metrics.resources += planet.resources;
      metrics.influence += planet.influence;
      metrics.planetCount += 1;
      if (planet.specialty) metrics.specialties.push(planet.specialty);
      if (planet.legendary) metrics.legendaryPlanets.push(planet.name);
      if (planet.resources > planet.influence) {
        metrics.optimalResources += planet.resources;
      } else if (planet.influence > planet.resources) {
        metrics.optimalInfluence += planet.influence;
      } else {
        metrics.optimalResources += planet.resources / 2;
        metrics.optimalInfluence += planet.influence / 2;
      }
    }
  }
  metrics.optimalTotal = metrics.optimalResources + metrics.optimalInfluence;
  return metrics;
}

function blueSystemScore(system: SystemTile): number {
  const metrics = metricsForSystems([system]);
  return (
    Math.max(metrics.optimalResources, metrics.optimalInfluence) +
    Math.floor(Math.min(metrics.optimalResources, metrics.optimalInfluence) / 3) +
    metrics.specialties.length +
    Math.floor(metrics.planetCount / 3) +
    (metrics.legendaryPlanets.length > 0 ? 10 : 0)
  );
}

export function blueSystemTiers(): [SystemTile[], SystemTile[], SystemTile[]] {
  const sorted = systemCatalog
    .filter((system) => system.type === "blue")
    .sort((left, right) => blueSystemScore(left) - blueSystemScore(right) || left.id - right.id);
  const tierSize = sorted.length / 3;
  if (!Number.isInteger(tierSize)) {
    throw new Error("The blue system catalog must divide evenly into three tiers");
  }
  return [
    sorted.slice(0, tierSize),
    sorted.slice(tierSize, tierSize * 2),
    sorted.slice(tierSize * 2),
  ];
}

function buildSlice(systems: SystemTile[], index: number): Slice {
  const ordered = [systems[3]!, systems[0]!, systems[1]!, systems[2]!, systems[4]!];
  return {
    id: `slice-${index + 1}`,
    name: sliceNames[index]!,
    tiles: ordered.map((system) => system.id),
    generatorVersion: GENERATOR_VERSION,
    ...metricsForSystems(ordered),
  };
}

function hasAdjacentAnomalies(slice: Slice): boolean {
  const systems = slice.tiles.map((id) => systemCatalog.find((system) => system.id === id)!);
  const anomalyIndexes = systems
    .map((system, index) => (system.anomalies.length > 0 ? index : -1))
    .filter((index) => index >= 0);
  const adjacency = new Set(["0:1", "0:2", "1:2", "1:3", "2:4", "3:4"]);
  return anomalyIndexes.some((left, index) =>
    anomalyIndexes.slice(index + 1).some((right) => adjacency.has(`${Math.min(left, right)}:${Math.max(left, right)}`)),
  );
}

function isSliceValid(slice: Slice, config: BalanceConfig): boolean {
  const repeatedWormhole = new Set(slice.wormholes).size !== slice.wormholes.length;
  return (
    slice.optimalResources >= config.minimumOptimalResources &&
    slice.optimalInfluence >= config.minimumOptimalInfluence &&
    slice.optimalTotal >= config.minimumOptimalTotal &&
    slice.optimalTotal <= config.maximumOptimalTotal &&
    slice.wormholes.length <= config.maximumWormholesPerSlice &&
    !repeatedWormhole &&
    !hasAdjacentAnomalies(slice)
  );
}

function poolIsValid(slices: Slice[], config: BalanceConfig): boolean {
  const legendary = slices.reduce((total, slice) => total + slice.legendaryPlanets.length, 0);
  const wormholes = slices.flatMap((slice) => slice.wormholes);
  const pairedAlpha = Math.floor(wormholes.filter((type) => type === "alpha").length / 2);
  const pairedBeta = Math.floor(wormholes.filter((type) => type === "beta").length / 2);
  return (
    slices.every((slice) => isSliceValid(slice, config)) &&
    legendary >= config.minimumLegendaryPlanets &&
    pairedAlpha >= config.minimumPairedAlphaWormholes &&
    pairedBeta >= config.minimumPairedBetaWormholes
  );
}

function variance(values: number[]): number {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
}

export function scoreSlicePool(slices: Slice[]): number {
  return (
    variance(slices.map((slice) => slice.optimalTotal)) * 5 +
    variance(slices.map((slice) => slice.optimalResources)) * 2 +
    variance(slices.map((slice) => slice.optimalInfluence)) * 2 +
    variance(slices.map((slice) => slice.planetCount)) +
    variance(slices.map((slice) => slice.specialties.length))
  );
}

export function generateBalancedSlices(seed: string, input?: Partial<BalanceConfig>): Slice[] {
  const config = balanceConfigSchema.parse(input ?? {});
  const random = seededRandom(seed);
  const [low, middle, high] = blueSystemTiers();
  const redSystems = systemCatalog.filter((system) => system.type === "red");
  let best: { slices: Slice[]; score: number } | undefined;

  for (let attempt = 0; attempt < config.attemptBudget; attempt += 1) {
    const lowPool = shuffle(low, random);
    const middlePool = shuffle(middle, random);
    const highPool = shuffle(high, random);
    const redPool = shuffle(redSystems, random);
    const slices = Array.from({ length: 9 }, (_, index) =>
      buildSlice(
        [lowPool[index]!, middlePool[index]!, highPool[index]!, redPool[index * 2]!, redPool[index * 2 + 1]!],
        index,
      ),
    );
    if (!poolIsValid(slices, config)) continue;
    const score = scoreSlicePool(slices);
    if (!best || score < best.score) best = { slices, score };
  }

  if (!best) {
    throw new Error("No balanced slice pool satisfies these constraints; relax the limits and regenerate");
  }
  return best.slices;
}

export function generateFactionPool(seed: string, input: DraftConfig): Faction[] {
  const config = draftConfigSchema.parse(input);
  const available = factionCatalog.filter((faction) => config.sets.includes(faction.set));
  if (available.length < config.factionCount) {
    throw new Error(`Only ${available.length} factions are available for the selected sets`);
  }
  return shuffle(available, seededRandom(`${seed}:factions`))
    .slice(0, config.factionCount)
    .sort((left, right) => left.shortName.localeCompare(right.shortName));
}
