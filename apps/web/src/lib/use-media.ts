import { useSyncExternalStore } from "react";

const DESKTOP_QUERY = "(min-width: 1100px)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

/**
 * True on wide viewports where the desktop layout applies. The Telegram Mini
 * App webview never reaches this width, so TMA always keeps the phone layout.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
