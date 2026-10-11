import { useState } from "react";
import { feedPlan } from "../lib/feed";
import { fmtDayTime, fmtG } from "../lib/format";
import { NumberField } from "./NumberField";

interface Props {
  readyBy: Date;
  hours: number;
  /** The starter the plan needs, whole grams; 0 when it needs none yet. */
  targetGrams: number;
}

const RATIOS: Record<string, [number, number, number]> = {
  "1:1:1": [1, 1, 1],
  "1:2:2": [1, 2, 2],
  "1:3:3": [1, 3, 3],
  "1:5:5": [1, 5, 5],
};

/** What to feed for: the starter the plan needs plus 30 g to keep back; 300 g if it needs none. */
const feedFor = (grams: number) => (grams ? grams + 30 : 300);

/** How much to feed to have the starter the plan needs, and when. */
export function FeedHelper({ readyBy, hours, targetGrams }: Props) {
  const [target, setTarget] = useState<number>(feedFor(targetGrams));
  const [seen, setSeen] = useState(targetGrams);
  const [ratio, setRatio] = useState("1:2:2");

  // Follow the plan when the starter it needs changes (another item, another dough), as
  // NumberField follows its value; a figure the baker typed is theirs and stays.
  if (targetGrams !== seen) {
    setSeen(targetGrams);
    if (target === feedFor(seen)) setTarget(feedFor(targetGrams));
  }

  const f = feedPlan(target, RATIOS[ratio] ?? [1, 1, 1]);
  return (
    <div className="callout info stack no-print" style={{ marginBottom: 10 }}>
      <strong>Feed helper</strong>
      <div className="fields">
        <NumberField
          label="Starter wanted at peak"
          value={target}
          onChange={(v) => setTarget(v ?? 0)}
          unit="g"
          min={10}
          max={5000}
          hint={targetGrams ? `Plan needs ${fmtG(targetGrams)}; keep some back` : undefined}
        />
        <div className="field">
          <label htmlFor="feed-ratio">Ratio seed : flour : water</label>
          <select id="feed-ratio" value={ratio} onChange={(e) => setRatio(e.target.value)}>
            {Object.keys(RATIOS).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="num">
        Mix <strong>{fmtG(f.seed)}</strong> seed + <strong>{fmtG(f.flour)}</strong> flour +{" "}
        <strong>{fmtG(f.water)}</strong> water. About {Math.round(hours * 10) / 10} h to peak, ready
        by <strong>{fmtDayTime(readyBy)}</strong>.
      </div>
    </div>
  );
}
