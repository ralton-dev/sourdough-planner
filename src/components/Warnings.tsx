import type { PlanWarning } from "../lib/types";

export function Warnings({ items }: { items: PlanWarning[] }) {
  if (items.length === 0) return null;
  return (
    <div className="stack" role="status">
      {items.map((w, i) => (
        <div key={`${w.code}-${i}`} className={`callout ${w.level}`}>
          {w.message}
        </div>
      ))}
    </div>
  );
}
