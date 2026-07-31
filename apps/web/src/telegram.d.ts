export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe?: {
          start_param?: string;
          user?: { id: number; first_name: string; last_name?: string; username?: string };
        };
        platform?: string;
        ready(): void;
        expand(): void;
        close(): void;
        setHeaderColor?(color: string): void;
        setBackgroundColor?(color: string): void;
        setBottomBarColor?(color: string): void;
        enableClosingConfirmation?(): void;
        HapticFeedback?: {
          impactOccurred(style: "light" | "medium" | "heavy"): void;
          notificationOccurred(type: "error" | "success" | "warning"): void;
        };
      };
    };
  }
}
