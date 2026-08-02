import { z } from "zod";

export const optionKinds = ["FACTION", "SLICE", "POSITION"] as const;
export type OptionKind = (typeof optionKinds)[number];

export const draftStatuses = ["SETUP", "BANNING", "DRAFTING", "COMPLETE", "ARCHIVED"] as const;
export type DraftStatus = (typeof draftStatuses)[number];

export const techSpecialties = ["biotic", "warfare", "propulsion", "cybernetic"] as const;
export type TechSpecialty = (typeof techSpecialties)[number];

export const wormholeTypes = ["alpha", "beta"] as const;
export type WormholeType = (typeof wormholeTypes)[number];

export type Planet = {
  name: string;
  resources: number;
  influence: number;
  specialty?: TechSpecialty;
  legendary?: boolean;
};

export type SystemTile = {
  id: number;
  type: "blue" | "red";
  planets: Planet[];
  wormholes: WormholeType[];
  anomalies: Array<"asteroid-field" | "gravity-rift" | "nebula" | "supernova">;
};

export type SystemMetrics = {
  resources: number;
  influence: number;
  optimalResources: number;
  optimalInfluence: number;
  optimalTotal: number;
  planetCount: number;
  specialties: TechSpecialty[];
  wormholes: WormholeType[];
  legendaryPlanets: string[];
  anomalies: SystemTile["anomalies"];
};

export type Slice = SystemMetrics & {
  id: string;
  name: string;
  tiles: number[];
  generatorVersion: string;
};

export type Faction = {
  id: string;
  name: string;
  shortName: string;
  trait: string;
  set: "Base Game" | "Prophecy of Kings";
};

export type Position = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
};

export const balanceConfigSchema = z
  .object({
    minimumLegendaryPlanets: z.number().int().min(0).max(2).default(2),
    minimumOptimalInfluence: z.number().min(0).max(10).default(4),
    minimumOptimalResources: z.number().min(0).max(10).default(2.5),
    minimumOptimalTotal: z.number().min(0).max(20).default(9),
    maximumOptimalTotal: z.number().min(0).max(20).default(13),
    maximumWormholesPerSlice: z.number().int().min(0).max(2).default(1),
    minimumPairedAlphaWormholes: z.number().int().min(0).max(4).default(1),
    minimumPairedBetaWormholes: z.number().int().min(0).max(4).default(0),
    attemptBudget: z.number().int().min(100).max(20_000).default(5_000),
  })
  .refine((value) => value.minimumOptimalTotal <= value.maximumOptimalTotal, {
    message: "Minimum optimal total must not exceed maximum optimal total",
    path: ["maximumOptimalTotal"],
  });

export type BalanceConfig = z.infer<typeof balanceConfigSchema>;

export const draftConfigSchema = z.object({
  playerCount: z.number().int().min(3).max(6).default(6),
  sliceCount: z.literal(9).default(9),
  factionCount: z.number().int().min(6).max(24).default(12),
  bansPerPlayer: z.number().int().min(0).max(1).default(0),
  sets: z
    .array(z.enum(["Base Game", "Prophecy of Kings"]))
    .refine(
      (sets) => sets.includes("Base Game") && sets.includes("Prophecy of Kings"),
      "Base Game and Prophecy of Kings are both required in v1",
    )
    .default(["Base Game", "Prophecy of Kings"]),
  balance: balanceConfigSchema.default({
    minimumLegendaryPlanets: 2,
    minimumOptimalInfluence: 4,
    minimumOptimalResources: 2.5,
    minimumOptimalTotal: 9,
    maximumOptimalTotal: 13,
    maximumWormholesPerSlice: 1,
    minimumPairedAlphaWormholes: 1,
    minimumPairedBetaWormholes: 0,
    attemptBudget: 5_000,
  }),
});

export type DraftConfig = z.infer<typeof draftConfigSchema>;

export const createDraftSchema = z.object({
  title: z.string().trim().min(3).max(80),
  players: z
    .array(
      z.object({
        displayName: z.string().trim().min(1).max(48),
        telegramUsername: z
          .string()
          .trim()
          .regex(/^@?[a-zA-Z0-9_]{5,32}$/)
          .optional()
          .transform((value) => value?.replace(/^@/, "")),
      }),
    )
    .min(3)
    .max(6)
    .refine(
      (players) =>
        new Set(players.map((player) => player.displayName.toLocaleLowerCase())).size ===
        players.length,
      "Player names must be unique",
    ),
  config: draftConfigSchema,
  seed: z.string().trim().min(1).max(80).optional(),
  telegramLaunchToken: z.string().uuid().optional(),
}).refine((input) => input.players.length === input.config.playerCount, {
  message: "Player count must match the configured table size",
  path: ["players"],
}).refine(
  (input) =>
    input.config.factionCount - input.config.playerCount * input.config.bansPerPlayer >=
    input.config.playerCount,
  {
    message: "The faction pool must keep at least one faction per player after bans",
    path: ["config", "factionCount"],
  },
);

export const pickSchema = z.object({
  optionId: z.string().min(1),
  version: z.number().int().nonnegative(),
  idempotencyKey: z.string().uuid(),
});

export type PublicPlayer = {
  id: string;
  displayName: string;
  telegramUsername?: string | null;
  orderIndex: number;
  color: string;
  isClaimed: boolean;
  isCurrentUser: boolean;
  picks: Partial<Record<Lowercase<OptionKind>, string>>;
};

export type PublicOption = {
  id: string;
  kind: OptionKind;
  key: string;
  label: string;
  sortOrder: number;
  payload: Record<string, unknown>;
  selectedByPlayerId?: string | null;
  bannedByPlayerId?: string | null;
};

export type PublicDraft = {
  id: string;
  slug: string;
  title: string;
  status: DraftStatus;
  version: number;
  turnCursor: number;
  totalTurns: number;
  activePlayerId?: string | null;
  creatorUserId: string;
  currentUserId?: string | null;
  canManage: boolean;
  telegramChannel?: {
    title: string;
    username?: string | null;
  } | null;
  seed: string;
  config: DraftConfig;
  players: PublicPlayer[];
  options: PublicOption[];
  events: Array<{
    id: string;
    type: string;
    createdAt: string;
    playerId?: string | null;
    payload: Record<string, unknown>;
  }>;
};

export type PublicDraftSummary = {
  id: string;
  slug: string;
  title: string;
  status: DraftStatus;
  playerCount: number;
  claimedPlayerCount: number;
  createdAt: string;
  updatedAt: string;
};
