import { afterEach, describe, expect, it, vi } from "vitest";

import { bindTelegramViewportCssVars, mountTelegramViewport } from "./telegram-viewport";

type TelegramWebApp = NonNullable<Window["Telegram"]>["WebApp"];

function makeTelegram(overrides: Partial<TelegramWebApp> = {}): TelegramWebApp {
  return {
    initData: "telegram-init-data",
    ready: vi.fn(),
    expand: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

function installBrowserGlobals(style = { setProperty: vi.fn() }) {
  const browser = {
    Telegram: undefined,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
    setTimeout: vi.fn(() => 2),
    clearTimeout: vi.fn(),
    visualViewport: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  };

  vi.stubGlobal("document", { documentElement: { style } });
  vi.stubGlobal("window", browser);
  return { browser, style };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Telegram viewport integration", () => {
  it("binds device and content safe areas to independent CSS variables", () => {
    const style = { setProperty: vi.fn() };
    const telegram = makeTelegram({
      safeAreaInset: { top: 47, right: 2, bottom: 21, left: 3 },
      contentSafeAreaInset: { top: 56, right: 4, bottom: 8, left: 5 },
    });

    bindTelegramViewportCssVars(telegram, style);

    expect(style.setProperty).toHaveBeenCalledWith(
      "--tg-viewport-safe-area-inset-top",
      "47px",
    );
    expect(style.setProperty).toHaveBeenCalledWith(
      "--tg-viewport-content-safe-area-inset-top",
      "56px",
    );
    expect(style.setProperty).toHaveBeenCalledWith(
      "--tg-viewport-safe-area-inset-bottom",
      "21px",
    );
  });

  it("binds CSS before requesting fullscreen", () => {
    const order: string[] = [];
    const { style } = installBrowserGlobals({
      setProperty: vi.fn(() => order.push("bind-css")),
    });
    const telegram = makeTelegram({
      safeAreaInset: { top: 47, right: 0, bottom: 21, left: 0 },
      contentSafeAreaInset: { top: 56, right: 0, bottom: 0, left: 0 },
      isVersionAtLeast: vi.fn(() => true),
      onEvent: vi.fn(),
      offEvent: vi.fn(),
      expand: vi.fn(() => order.push("expand")),
      requestFullscreen: vi.fn(() => {
        order.push("fullscreen");
      }),
    });

    const unmount = mountTelegramViewport(telegram);

    expect(style.setProperty).toHaveBeenCalled();
    expect(order.indexOf("bind-css")).toBeLessThan(order.indexOf("fullscreen"));
    expect(order.indexOf("expand")).toBeLessThan(order.indexOf("fullscreen"));
    unmount();
  });

  it("keeps the expanded view when fullscreen is rejected", async () => {
    installBrowserGlobals();
    const telegram = makeTelegram({
      isVersionAtLeast: vi.fn(() => true),
      onEvent: vi.fn(),
      offEvent: vi.fn(),
      requestFullscreen: vi.fn(() => Promise.reject(new Error("unsupported"))),
    });

    const unmount = mountTelegramViewport(telegram);
    await Promise.resolve();

    expect(telegram.expand).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("is a no-op outside Telegram", () => {
    installBrowserGlobals();
    expect(() => mountTelegramViewport()()).not.toThrow();
  });
});
