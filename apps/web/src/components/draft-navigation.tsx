import { HexagonIcon, ListIcon, MapIcon, UsersRoundIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type DraftView = "draft" | "map" | "table" | "activity";

const navigationItems = [
  { view: "draft", label: "DRAFT", Icon: HexagonIcon },
  { view: "map", label: "MAP", Icon: MapIcon },
  { view: "table", label: "TABLE", Icon: UsersRoundIcon },
  { view: "activity", label: "LOG", Icon: ListIcon },
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
    <nav className="tabbar" aria-label="Draft views">
      {navigationItems.map(({ view: itemView, label, Icon }) => (
        <button
          key={itemView}
          type="button"
          className={cn("tabbar-item", view === itemView && "is-active")}
          aria-current={view === itemView ? "page" : undefined}
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
