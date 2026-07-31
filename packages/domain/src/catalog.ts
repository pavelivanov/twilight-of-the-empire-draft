import type { Faction, Planet, Position, SystemTile } from "./types.js";

const planet = (
  name: string,
  resources: number,
  influence: number,
  specialty?: Planet["specialty"],
  legendary = false,
): Planet => ({ name, resources, influence, specialty, legendary });

const blue = (id: number, planets: Planet[], wormholes: SystemTile["wormholes"] = []): SystemTile => ({
  id,
  type: "blue",
  planets,
  wormholes,
  anomalies: [],
});

const red = (
  id: number,
  anomalies: SystemTile["anomalies"] = [],
  wormholes: SystemTile["wormholes"] = [],
  planets: Planet[] = [],
): SystemTile => ({ id, type: "red", planets, wormholes, anomalies });

export const systemCatalog: readonly SystemTile[] = [
  blue(19, [planet("Wellon", 1, 2, "cybernetic")]),
  blue(20, [planet("Vefut II", 2, 2)]),
  blue(22, [planet("Tar'mann", 1, 1, "biotic")]),
  blue(23, [planet("Saudor", 2, 2)]),
  blue(24, [planet("Mehar Xull", 1, 3, "warfare")]),
  blue(26, [planet("Lodor", 3, 1)], ["alpha"]),
  blue(27, [planet("New Albion", 1, 1, "biotic"), planet("Starpoint", 3, 1)]),
  blue(28, [planet("Tequ'ran", 2, 0), planet("Torkan", 0, 3)]),
  blue(29, [planet("Qucen'n", 1, 2), planet("Rarron", 0, 3)]),
  blue(30, [planet("Mellon", 0, 2), planet("Zohbat", 3, 1)]),
  blue(32, [planet("Dal Bootha", 0, 2), planet("Xxehan", 1, 1)]),
  blue(33, [planet("Corneeq", 1, 2), planet("Resulon", 2, 0)]),
  blue(34, [planet("Centauri", 1, 3), planet("Gral", 1, 1, "propulsion")]),
  blue(35, [planet("Bereg", 3, 1), planet("Lirta IV", 2, 3)]),
  blue(36, [planet("Arnor", 2, 1), planet("Lor", 1, 2)]),
  blue(37, [planet("Arinam", 1, 2), planet("Meer", 0, 4, "warfare")]),
  blue(59, [planet("Archon Vail", 1, 3, "propulsion")]),
  blue(61, [planet("Ang", 2, 0, "warfare")]),
  blue(62, [planet("Sem-Lore", 3, 2, "cybernetic")]),
  blue(63, [planet("Vorhal", 0, 2, "biotic")]),
  blue(65, [planet("Primor", 2, 1, undefined, true)]),
  blue(66, [planet("Hope's End", 3, 0, undefined, true)]),
  blue(69, [planet("Accoen", 2, 3), planet("Jeol Ir", 2, 3)]),
  blue(70, [planet("Kraag", 2, 1), planet("Siig", 0, 2)]),
  blue(72, [planet("Lisis", 2, 2), planet("Velnor", 2, 1, "warfare")]),
  blue(73, [planet("Lisis II", 0, 2, "cybernetic"), planet("Xanhact", 0, 1)]),
  blue(76, [
    planet("Rigel I", 0, 1),
    planet("Rigel II", 1, 2),
    planet("Rigel III", 1, 1, "biotic"),
  ]),
  red(39, [], ["alpha"]),
  red(40, [], ["beta"]),
  red(41, ["gravity-rift"]),
  red(42, ["nebula"]),
  red(43, ["supernova"]),
  red(44, ["asteroid-field"]),
  red(45, ["asteroid-field"]),
  red(46),
  red(47),
  red(48),
  red(49),
  red(50),
  red(67, ["gravity-rift"], [], [planet("Cormund", 2, 0)]),
  red(68, ["nebula"], [], [planet("Everra", 3, 1)]),
  red(77),
  red(78),
  red(79, ["asteroid-field"], ["alpha"]),
  red(80, ["supernova"]),
] as const;

export const factionCatalog: readonly Faction[] = [
  { id: "arborec", name: "The Arborec", shortName: "Arborec", trait: "Growth", set: "Base Game" },
  { id: "letnev", name: "The Barony of Letnev", shortName: "Letnev", trait: "Armada", set: "Base Game" },
  { id: "saar", name: "The Clan of Saar", shortName: "Saar", trait: "Nomadic", set: "Base Game" },
  { id: "muaat", name: "The Embers of Muaat", shortName: "Muaat", trait: "War Sun", set: "Base Game" },
  { id: "hacan", name: "The Emirates of Hacan", shortName: "Hacan", trait: "Trade", set: "Base Game" },
  { id: "sol", name: "The Federation of Sol", shortName: "Sol", trait: "Expansion", set: "Base Game" },
  { id: "creuss", name: "The Ghosts of Creuss", shortName: "Creuss", trait: "Mobility", set: "Base Game" },
  { id: "l1z1x", name: "The L1Z1X Mindnet", shortName: "L1Z1X", trait: "Conquest", set: "Base Game" },
  { id: "mentak", name: "The Mentak Coalition", shortName: "Mentak", trait: "Pillage", set: "Base Game" },
  { id: "naalu", name: "The Naalu Collective", shortName: "Naalu", trait: "Foresight", set: "Base Game" },
  { id: "nekro", name: "The Nekro Virus", shortName: "Nekro", trait: "Assimilation", set: "Base Game" },
  { id: "sardakk", name: "Sardakk N'orr", shortName: "Sardakk", trait: "Combat", set: "Base Game" },
  { id: "jolnar", name: "The Universities of Jol-Nar", shortName: "Jol-Nar", trait: "Research", set: "Base Game" },
  { id: "winnu", name: "The Winnu", shortName: "Winnu", trait: "Imperium", set: "Base Game" },
  { id: "xxcha", name: "The Xxcha Kingdom", shortName: "Xxcha", trait: "Diplomacy", set: "Base Game" },
  { id: "yin", name: "The Yin Brotherhood", shortName: "Yin", trait: "Devotion", set: "Base Game" },
  { id: "yssaril", name: "The Yssaril Tribes", shortName: "Yssaril", trait: "Subterfuge", set: "Base Game" },
  { id: "argent", name: "The Argent Flight", shortName: "Argent", trait: "Control", set: "Prophecy of Kings" },
  { id: "cabal", name: "The Vuil'Raith Cabal", shortName: "Cabal", trait: "Capture", set: "Prophecy of Kings" },
  { id: "empyrean", name: "The Empyrean", shortName: "Empyrean", trait: "Exploration", set: "Prophecy of Kings" },
  { id: "mahact", name: "The Mahact Gene-Sorcerers", shortName: "Mahact", trait: "Command", set: "Prophecy of Kings" },
  { id: "naazrokha", name: "The Naaz-Rokha Alliance", shortName: "Naaz-Rokha", trait: "Relics", set: "Prophecy of Kings" },
  { id: "nomad", name: "The Nomad", shortName: "Nomad", trait: "Agents", set: "Prophecy of Kings" },
  { id: "titans", name: "The Titans of Ul", shortName: "Titans", trait: "Awaken", set: "Prophecy of Kings" },
] as const;

export const positionCatalog: readonly Position[] = [
  { id: "speaker", label: "Speaker", shortLabel: "S", description: "First strategy card pick" },
  { id: "second", label: "2nd position", shortLabel: "2", description: "Clockwise from speaker" },
  { id: "third", label: "3rd position", shortLabel: "3", description: "Third clockwise from speaker" },
  { id: "fourth", label: "4th position", shortLabel: "4", description: "Fourth clockwise from speaker" },
  { id: "fifth", label: "5th position", shortLabel: "5", description: "Fifth clockwise from speaker" },
  { id: "sixth", label: "6th position", shortLabel: "6", description: "Sixth clockwise from speaker" },
] as const;

export const playerColors = ["#71d9ff", "#ffb45e", "#b49cff", "#69d8a7", "#ff8299", "#e5dd69"] as const;

export const homeTileByFaction: Readonly<Record<string, number>> = {
  sol: 1,
  mentak: 2,
  l1z1x: 6,
  nekro: 8,
  yssaril: 15,
  hacan: 16,
};
