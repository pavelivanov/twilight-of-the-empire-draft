import { systemCatalog, type Slice, type SystemTile, type TechSpecialty } from "@imperium/domain";

export type TechColor = "g" | "b" | "y" | "r";

export const techColorHex: Record<TechColor, string> = {
  b: "#5b8fd6",
  g: "#57b07a",
  y: "#d7b45a",
  r: "#cf6b57",
};

type FactionMeta = { techs: TechColor[]; tag: string; meta: string };

export const factionMeta: Record<string, FactionMeta> = {
  arborec: { techs: ["r"], tag: "PRODUCTION", meta: "3 commodities · infantry production" },
  letnev: { techs: ["b", "r"], tag: "FLEET", meta: "2 commodities · dreadnought rush" },
  saar: { techs: ["b"], tag: "MOBILE", meta: "3 commodities · space dock fleet" },
  muaat: { techs: ["r"], tag: "WAR SUN", meta: "4 commodities · early war sun" },
  hacan: { techs: ["y", "b"], tag: "TRADE", meta: "6 commodities · trade broker" },
  sol: { techs: ["g", "b"], tag: "GROUND", meta: "4 commodities · infantry swarm" },
  creuss: { techs: ["b"], tag: "WORMHOLES", meta: "4 commodities · delta travel" },
  l1z1x: { techs: ["g", "r"], tag: "INVASION", meta: "2 commodities · dreadnought ground" },
  mentak: { techs: ["y", "r"], tag: "PIRATES", meta: "2 commodities · early aggression" },
  naalu: { techs: ["g", "y"], tag: "INITIATIVE", meta: "3 commodities · always first" },
  nekro: { techs: ["g"], tag: "STEAL TECH", meta: "3 commodities · no research" },
  sardakk: { techs: [], tag: "COMBAT", meta: "3 commodities · +1 on every die" },
  jolnar: { techs: ["g", "b", "y", "r"], tag: "TECH", meta: "4 commodities · four starting techs" },
  winnu: { techs: ["y"], tag: "MECATOL", meta: "3 commodities · straight to the throne" },
  xxcha: { techs: ["y"], tag: "AGENDA", meta: "4 commodities · political control" },
  yin: { techs: ["y"], tag: "SACRIFICE", meta: "2 commodities · suicide squads" },
  yssaril: { techs: ["g"], tag: "ACTION CARDS", meta: "3 commodities · card hoarding" },
  argent: { techs: ["g", "y"], tag: "VOTES", meta: "3 commodities · zeal in agendas" },
  cabal: { techs: ["r"], tag: "CAPTURE", meta: "2 commodities · unit capture" },
  empyrean: { techs: ["b"], tag: "NEBULA", meta: "4 commodities · frontier travel" },
  mahact: { techs: [], tag: "TOKENS", meta: "3 commodities · command theft" },
  naazrokha: { techs: ["g", "r"], tag: "EXPLORE", meta: "3 commodities · relic hunters" },
  nomad: { techs: ["b"], tag: "AGENTS", meta: "4 commodities · three agents" },
  titans: { techs: ["b", "y"], tag: "TERRAFORM", meta: "2 commodities · mobile PDS" },
};

export type PlanetTrait = "cultural" | "hazardous" | "industrial";

export const planetTraits: Record<string, PlanetTrait> = {
  Wellon: "industrial",
  "Vefut II": "hazardous",
  "Tar'mann": "industrial",
  Saudor: "industrial",
  "Mehar Xull": "hazardous",
  Lodor: "cultural",
  "New Albion": "industrial",
  Starpoint: "hazardous",
  "Tequ'ran": "hazardous",
  Torkan: "cultural",
  "Qucen'n": "cultural",
  Rarron: "cultural",
  Mellon: "cultural",
  Zohbat: "hazardous",
  "Dal Bootha": "cultural",
  Xxehan: "cultural",
  Corneeq: "cultural",
  Resulon: "cultural",
  Centauri: "cultural",
  Gral: "industrial",
  Bereg: "hazardous",
  "Lirta IV": "hazardous",
  Arnor: "industrial",
  Lor: "industrial",
  Arinam: "industrial",
  Meer: "hazardous",
  "Archon Vail": "hazardous",
  Ang: "industrial",
  "Sem-Lore": "cultural",
  Vorhal: "industrial",
  Primor: "cultural",
  "Hope's End": "hazardous",
  Cormund: "hazardous",
  Everra: "cultural",
  Accoen: "industrial",
  "Jeol Ir": "industrial",
  Kraag: "hazardous",
  Siig: "hazardous",
  Lisis: "industrial",
  Velnor: "industrial",
  "Lisis II": "cultural",
  Cealdri: "cultural",
  Xanhact: "hazardous",
  "Rigel I": "hazardous",
  "Rigel II": "industrial",
  "Rigel III": "industrial",
};

export const traitIcon = (trait: PlanetTrait): string => `/assets/icons/trait-${trait}.png`;
export const techIcon = (specialty: TechSpecialty): string => `/assets/icons/tech-${specialty}.png`;
export const wormholeIcon = (wormhole: "alpha" | "beta"): string => `/assets/icons/wh-${wormhole}.png`;
export const tileArt = (tileId: number): string => `/assets/tiles/ST_${tileId}.png`;

const systemById = new Map<number, SystemTile>(systemCatalog.map((tile) => [tile.id, tile]));

export type SlicePlanet = {
  name: string;
  resources: number;
  influence: number;
  trait: PlanetTrait;
  specialty?: TechSpecialty;
  legendary: boolean;
};

export type SliceDetails = {
  planets: SlicePlanet[];
  specialties: TechSpecialty[];
  wormholes: Array<"alpha" | "beta">;
  anomalies: string[];
  legendaryPlanets: string[];
};

const anomalyLabels: Record<string, string> = {
  "asteroid-field": "ASTEROID FIELD",
  "gravity-rift": "GRAVITY RIFT",
  nebula: "NEBULA",
  supernova: "SUPERNOVA",
};

export function sliceDetails(slice: Slice): SliceDetails {
  const planets: SlicePlanet[] = [];
  const specialties: TechSpecialty[] = [];
  const wormholes: Array<"alpha" | "beta"> = [];
  const anomalies: string[] = [];
  const legendaryPlanets: string[] = [];
  for (const tileId of slice.tiles) {
    const tile = systemById.get(tileId);
    if (!tile) continue;
    for (const wormhole of tile.wormholes) {
      if (!wormholes.includes(wormhole)) wormholes.push(wormhole);
    }
    for (const anomaly of tile.anomalies) {
      const label = anomalyLabels[anomaly] ?? anomaly.toUpperCase();
      if (!anomalies.includes(label)) anomalies.push(label);
    }
    for (const planet of tile.planets) {
      planets.push({
        name: planet.name,
        resources: planet.resources,
        influence: planet.influence,
        trait: planetTraits[planet.name] ?? "industrial",
        specialty: planet.specialty,
        legendary: Boolean(planet.legendary),
      });
      if (planet.specialty && !specialties.includes(planet.specialty)) specialties.push(planet.specialty);
      if (planet.legendary) legendaryPlanets.push(planet.name);
    }
  }
  return { planets, specialties, wormholes, anomalies, legendaryPlanets };
}

/** Flat-top hex geometry for a five-tile milty slice + home system. */
export function clusterLayout(size: number) {
  const width = size;
  const height = size * 0.866;
  const dx = width * 0.75;
  const positions: Array<[number, number]> = [
    [dx, height * 2],
    [dx, height],
    [dx, 0],
    [0, height * 1.5],
    [0, height * 0.5],
    [dx * 2, height * 1.5],
  ];
  return {
    positions,
    tileWidth: width,
    tileHeight: height,
    width: dx * 2 + width,
    height: height * 3,
  };
}
