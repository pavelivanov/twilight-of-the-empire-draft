import type { PublicDraft } from "@imperium/domain";

const preferenceKey = "imperium-browser-notifications";

export type BrowserNotificationState = "unsupported" | "blocked" | "off" | "on";

export function getBrowserNotificationState(): BrowserNotificationState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return Notification.permission === "granted" && localStorage.getItem(preferenceKey) === "on" ? "on" : "off";
}

export async function enableBrowserNotifications(): Promise<BrowserNotificationState> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission === "granted") localStorage.setItem(preferenceKey, "on");
  return getBrowserNotificationState();
}

export function disableBrowserNotifications(): BrowserNotificationState {
  if (typeof localStorage !== "undefined") localStorage.removeItem(preferenceKey);
  return getBrowserNotificationState();
}

function eventMessage(draft: PublicDraft): string {
  const event = draft.events[0];
  if (!event) return "The draft changed.";
  const player = String(event.payload.playerName ?? "A player");
  const option = String(event.payload.optionLabel ?? "an option");
  switch (event.type) {
    case "OPTION_SELECTED":
      return `${player} selected ${option}.`;
    case "PLAYER_BANNED":
      return `${player} banned ${option}.`;
    case "PLAYER_CLAIMED":
      return `${player} claimed a seat.`;
    case "PLAYER_UNCLAIMED":
      return `${player} released their seat.`;
    case "PLAYER_REMOVED":
      return `${player} was removed from the table.`;
    case "POOL_REGENERATED":
      return "The host regenerated the option pool.";
    case "PICK_REVERTED":
      return `The host returned ${option} to the pool.`;
    case "BAN_PHASE_COMPLETED":
      return "The ban phase is complete. Drafting begins.";
    case "DRAFT_COMPLETED":
      return "The draft is complete.";
    default:
      return "The draft changed.";
  }
}

export function notifyBrowserOfDraftUpdate(previous: PublicDraft | undefined, draft: PublicDraft): void {
  if (
    !previous ||
    previous.id !== draft.id ||
    previous.version === draft.version ||
    window.Telegram?.WebApp.initData ||
    document.visibilityState === "visible" ||
    getBrowserNotificationState() !== "on"
  ) {
    return;
  }
  const currentPlayer = draft.players.find((player) => player.isCurrentUser);
  const becameMyTurn =
    draft.status === "DRAFTING" &&
    currentPlayer?.id === draft.activePlayerId &&
    previous.activePlayerId !== draft.activePlayerId;
  const notification = new Notification(
    becameMyTurn ? `Your turn · ${draft.title}` : draft.title,
    { body: becameMyTurn ? "Choose a slice, faction, or seat." : eventMessage(draft), tag: `draft-${draft.id}` },
  );
  notification.onclick = () => {
    notification.close();
    window.focus();
    const url = new URL(window.location.href);
    url.searchParams.set("draft", draft.slug);
    window.location.assign(url);
  };
}
