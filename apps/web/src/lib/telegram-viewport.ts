type TelegramWebApp = NonNullable<Window["Telegram"]>["WebApp"];

const viewportEvents: TelegramWebAppEvent[] = [
  "activated",
  "viewportChanged",
  "safeAreaChanged",
  "contentSafeAreaChanged",
  "fullscreenChanged",
];

const insetSides = ["top", "right", "bottom", "left"] as const;

function safeInset(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function bindTelegramViewportCssVars(
  telegram: TelegramWebApp,
  style: Pick<CSSStyleDeclaration, "setProperty"> = document.documentElement.style,
): void {
  for (const side of insetSides) {
    style.setProperty(
      `--tg-viewport-safe-area-inset-${side}`,
      `${safeInset(telegram.safeAreaInset?.[side])}px`,
    );
    style.setProperty(
      `--tg-viewport-content-safe-area-inset-${side}`,
      `${safeInset(telegram.contentSafeAreaInset?.[side])}px`,
    );
  }
}

export function mountTelegramViewport(
  telegram: TelegramWebApp | undefined = window.Telegram?.WebApp,
): () => void {
  if (!telegram) return () => undefined;

  const syncCssVars = () => bindTelegramViewportCssVars(telegram);
  const retainExpandedViewport = () => telegram.expand();

  viewportEvents.forEach((event) => telegram.onEvent?.(event, syncCssVars));
  telegram.onEvent?.("fullscreenFailed", retainExpandedViewport);
  window.addEventListener("resize", syncCssVars);
  window.visualViewport?.addEventListener("resize", syncCssVars);

  // Bind the initial safe-area values before fullscreen can change the viewport.
  syncCssVars();

  telegram.ready();
  telegram.setHeaderColor?.("#0b0e13");
  telegram.setBackgroundColor?.("#0b0e13");
  telegram.setBottomBarColor?.("#0b0e13");
  telegram.enableClosingConfirmation?.();
  telegram.disableVerticalSwipes?.();
  telegram.expand();

  if (telegram.isVersionAtLeast?.("8.0") && telegram.requestFullscreen) {
    try {
      const fullscreenRequest = telegram.requestFullscreen();
      void fullscreenRequest?.catch(retainExpandedViewport);
    } catch {
      retainExpandedViewport();
    }
  }

  const frame = window.requestAnimationFrame(syncCssVars);
  const transitionCheck = window.setTimeout(syncCssVars, 350);

  return () => {
    viewportEvents.forEach((event) => telegram.offEvent?.(event, syncCssVars));
    telegram.offEvent?.("fullscreenFailed", retainExpandedViewport);
    window.removeEventListener("resize", syncCssVars);
    window.visualViewport?.removeEventListener("resize", syncCssVars);
    window.cancelAnimationFrame(frame);
    window.clearTimeout(transitionCheck);
  };
}
