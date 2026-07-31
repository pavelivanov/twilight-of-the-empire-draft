import { Orbit } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="brand-mark">
        <Orbit aria-hidden="true" />
      </span>
      <div>
        <strong className="block font-mono text-[0.72rem] tracking-[0.22em] text-foreground uppercase">
          Imperium Draft
        </strong>
        {!compact && (
          <span className="block text-[0.62rem] tracking-[0.1em] text-muted-foreground uppercase">
            Telegram Milty service
          </span>
        )}
      </div>
    </div>
  );
}
