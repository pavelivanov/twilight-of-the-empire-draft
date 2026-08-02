import { HexagonIcon, ListIcon, MapIcon, UsersRoundIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type DraftView = "draft" | "map" | "table" | "activity";

const navigationItems = [
  { view: "draft", label: "DRAFT", Icon: HexagonIcon },
  { view: "map", label: "MAP", Icon: MapIcon },
  { view: "table", label: "TABLE", Icon: UsersRoundIcon },
  { view: "activity", label: "LOG", Icon: ListIcon },
] as const;

const completedNavigationItems = navigationItems.filter(
  ({ view }) => view === "map" || view === "activity",
);

export function resolveDraftView(view: DraftView, completed: boolean): DraftView {
  return completed && view !== "activity" ? "map" : view;
}

export function DraftNavigation({
  view,
  onViewChange,
  completed = false,
}: {
  view: DraftView;
  onViewChange: (view: DraftView) => void;
  completed?: boolean;
}) {
  const items = completed ? completedNavigationItems : navigationItems;
  const activeView = resolveDraftView(view, completed);

  function selectView(nextView: DraftView) {
    onViewChange(nextView);
    window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");
  }

  return (
    <nav className="tabbar" aria-label="Draft views">
      {items.map(({ view: itemView, label, Icon }) => (
        <button
          key={itemView}
          type="button"
          className={cn("tabbar-item", activeView === itemView && "is-active")}
          aria-current={activeView === itemView ? "page" : undefined}
          onClick={() => selectView(itemView)}
        >
          <span className="tabbar-icon">
            <Icon aria-hidden="true" />
          </span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
