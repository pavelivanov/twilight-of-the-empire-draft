export {};

declare global {
  type TelegramSafeAreaInset = {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };

  type TelegramWebAppEvent =
    | "activated"
    | "viewportChanged"
    | "safeAreaChanged"
    | "contentSafeAreaChanged"
    | "fullscreenChanged";

  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe?: {
          start_param?: string;
          user?: { id: number; first_name: string; last_name?: string; username?: string };
        };
        platform?: string;
        isFullscreen?: boolean;
        safeAreaInset?: TelegramSafeAreaInset;
        contentSafeAreaInset?: TelegramSafeAreaInset;
        ready(): void;
        expand(): void;
        isVersionAtLeast?(version: string): boolean;
        requestFullscreen?(): void;
        onEvent?(eventType: TelegramWebAppEvent, eventHandler: () => void): void;
        offEvent?(eventType: TelegramWebAppEvent, eventHandler: () => void): void;
        close(): void;
        setHeaderColor?(color: string): void;
        setBackgroundColor?(color: string): void;
        setBottomBarColor?(color: string): void;
        enableClosingConfirmation?(): void;
        disableVerticalSwipes?(): void;
        HapticFeedback?: {
          impactOccurred(style: "light" | "medium" | "heavy"): void;
          notificationOccurred(type: "error" | "success" | "warning"): void;
        };
      };
    };
  }
}
