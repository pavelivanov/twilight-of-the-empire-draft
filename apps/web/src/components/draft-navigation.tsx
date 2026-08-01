import { cn } from "@/lib/utils";

export type DraftView = "draft" | "map" | "table" | "activity";

function DraftIcon() {
  return (
    <i
      aria-hidden="true"
      style={{
        width: 15,
        height: 13,
        clipPath: "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)",
        background: "currentColor",
        display: "block",
      }}
    />
  );
}

function MapIcon() {
  const hex = (left: number, top: number, opacity = 1): React.CSSProperties => ({
    position: "absolute",
    left,
    top,
    width: 11,
    height: 9,
    clipPath: "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)",
    background: "currentColor",
    opacity,
  });
  return (
    <i aria-hidden="true" style={{ position: "relative", width: 22, height: 14, display: "block" }}>
      <i style={hex(0, 3, 0.5)} />
      <i style={hex(8, 0)} />
      <i style={hex(11, 6, 0.5)} />
    </i>
  );
}

function TableIcon() {
  const dot = (opacity = 1): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: 4,
    border: "1.5px solid currentColor",
    opacity,
    display: "block",
  });
  return (
    <i aria-hidden="true" style={{ display: "flex", gap: 3, alignItems: "center" }}>
      <i style={dot()} />
      <i style={dot(0.55)} />
    </i>
  );
}

function LogIcon() {
  const line = (width: number, opacity = 1): React.CSSProperties => ({
    width,
    height: 1.6,
    background: "currentColor",
    opacity,
    display: "block",
  });
  return (
    <i aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
      <i style={line(15)} />
      <i style={line(10, 0.6)} />
      <i style={line(13, 0.6)} />
    </i>
  );
}

const navigationItems = [
  { view: "draft", label: "DRAFT", Icon: DraftIcon },
  { view: "map", label: "MAP", Icon: MapIcon },
  { view: "table", label: "TABLE", Icon: TableIcon },
  { view: "activity", label: "LOG", Icon: LogIcon },
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
            <Icon />
          </span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
