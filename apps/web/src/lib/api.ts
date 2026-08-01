import type { DraftConfig, PublicDraft, PublicDraftSummary } from "@imperium/domain";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export type DemoIdentity = { id: string; name: string };

const demoIdentityKey = "imperium-demo-identity";

export function getDemoIdentity(): DemoIdentity {
  const stored = localStorage.getItem(demoIdentityKey);
  if (stored) return JSON.parse(stored) as DemoIdentity;
  return { id: "creator", name: "Draft creator" };
}

export function setDemoIdentity(identity: DemoIdentity): void {
  localStorage.setItem(demoIdentityKey, JSON.stringify(identity));
}

function authHeaders(): Record<string, string> {
  const initData = window.Telegram?.WebApp.initData;
  if (initData) return { authorization: `tma ${initData}` };
  const identity = getDemoIdentity();
  return {
    "x-demo-user-id": identity.id,
    "x-demo-user-name": identity.name,
  };
}

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...authHeaders(),
      ...init?.headers,
    },
  });
  const body = (await response.json()) as T | { error?: { code?: string; message?: string } };
  if (!response.ok) {
    const error =
      typeof body === "object" && body !== null && "error" in body
        ? (body as { error?: { code?: string; message?: string } }).error
        : undefined;
    throw new ApiClientError(error?.code ?? "REQUEST_FAILED", error?.message ?? "Request failed", response.status);
  }
  return body as T;
}

export type CreateDraftInput = {
  title: string;
  players: Array<{ displayName: string; telegramUsername?: string }>;
  config: DraftConfig;
  seed?: string;
};

export const api = {
  createDraft: (input: CreateDraftInput) =>
    request<PublicDraft>("/api/drafts", { method: "POST", body: JSON.stringify(input) }),
  listDrafts: () => request<PublicDraftSummary[]>("/api/drafts"),
  getDraft: (draftId: string) => request<PublicDraft>(`/api/drafts/${draftId}`),
  deleteDraft: (draftId: string) =>
    request<{ id: string; slug: string }>(`/api/drafts/${draftId}`, { method: "DELETE" }),
  claimPlayer: (draftId: string, playerId: string, version: number) =>
    request<PublicDraft>(`/api/drafts/${draftId}/players/${playerId}/claim`, {
      method: "POST",
      body: JSON.stringify({ version }),
    }),
  unclaimPlayer: (draftId: string, playerId: string, version: number) =>
    request<PublicDraft>(`/api/drafts/${draftId}/players/${playerId}/claim?version=${version}`, {
      method: "DELETE",
    }),
  removePlayer: (draftId: string, playerId: string, version: number) =>
    request<PublicDraft>(`/api/drafts/${draftId}/players/${playerId}?version=${version}`, {
      method: "DELETE",
    }),
  startDraft: (draftId: string, version: number) =>
    request<PublicDraft>(`/api/drafts/${draftId}/start`, {
      method: "POST",
      body: JSON.stringify({ version }),
    }),
  regenerate: (draftId: string, version: number) =>
    request<PublicDraft>(`/api/drafts/${draftId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ version }),
    }),
  pick: (draftId: string, optionId: string, version: number) =>
    request<PublicDraft>(`/api/drafts/${draftId}/picks`, {
      method: "POST",
      body: JSON.stringify({ optionId, version, idempotencyKey: crypto.randomUUID() }),
    }),
  ban: (draftId: string, optionId: string, version: number) =>
    request<PublicDraft>(`/api/drafts/${draftId}/bans`, {
      method: "POST",
      body: JSON.stringify({ optionId, version, idempotencyKey: crypto.randomUUID() }),
    }),
};
