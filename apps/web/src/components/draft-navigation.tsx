import { Activity, Map, UsersRound } from "lucide-react";

export type DraftView = "draft" | "map" | "activity";

const navigationItems = [
  { view: "draft", label: "Draft", Icon: UsersRound },
  { view: "map", label: "Map", Icon: Map },
  { view: "activity", label: "Activity", Icon: Activity },
] as const;

export function DraftNavigation({
  view,
  onViewChange,
}: {
  view: DraftView;
  onViewChange: (view: DraftView) => void;
}) {
  function selectView(nextView: DraftView) {
    onViewChange(nextView);
    window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");
  }

  return (
    <nav className="bottom-nav" aria-label="Draft views">
      {navigationItems.map(({ view: itemView, label, Icon }) => (
        <button
          key={itemView}
          type="button"
          className={view === itemView ? "is-active" : undefined}
          aria-current={view === itemView ? "page" : undefined}
          onClick={() => selectView(itemView)}
        >
          <Icon aria-hidden="true" />
          {label}
        </button>
      ))}
    </nav>
  );
}
